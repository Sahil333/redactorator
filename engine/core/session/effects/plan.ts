import type { Result } from "../../../api/errors";
import type { Session } from "../../../api/facade";
import type { ApprovalPlan } from "../../../api/state";
import type { RemovalKind } from "../../../model/document";
import type { DocumentId, Project } from "../../../model/project";
import { approve, changed, keysToFind, type Approval } from "../../../model/spread";
import type { PdfClient } from "../../pdf-client/client";
import type { SessionChange } from "../changes";
import type { SessionView } from "../gate";
import { documentReadings, findPlaces, type ReadingSource } from "./readings";

/** What approving uses: the Session's state and gate, its project's readings and the PDF worker, and how changes land. */
interface ApprovalHost {
  readonly source: ReadingSource & { readonly client: Pick<PdfClient, "match"> };
  view(): SessionView | undefined;
  allowed(command: "approve" | "confirm", document?: DocumentId): Result<SessionView>;
  dispatch(change: SessionChange, ...effects: (() => void)[]): void;
  /** Dispatches a change to the project record, which saves it. */
  change(change: SessionChange): void;
}

type Planned = Awaited<ReturnType<Session["approval"]["plan"]>>;

const failed: Result<never> = { ok: false, error: { code: "approval-failed" } };
const noPlan: Result<never> = { ok: false, error: { code: "no-plan" } };

/** The approval landing: the record it makes, and the documents it changed, the approved one first. */
const approved = ({ here, changes }: ApprovalPlan, project: Project): SessionChange => ({
  type: "approved",
  project,
  changedDocuments: [here, ...changes].map(({ document }) => document),
});

/**
 * Approving a document: working out what spreads (the readings of every document, where the PDF
 * worker finds the values, then `approve`), landing it at once or after the heads-up, and
 * cancelling. The heads-up waits when the approval changes other places, or when preparing the
 * document removed kinds of content no earlier approval of it listed. The gate takes no change to
 * the record while approval plans or waits, so an approval always lands on the record it was
 * worked out from; finding another means a command got past the gate, and nothing is approved.
 * `settled` resolves once no plan is being worked out.
 */
export function approvalOf({ source, view, allowed, dispatch, change }: ApprovalHost): Session["approval"] & { settled(): Promise<unknown> } {
  let plans = 0;
  let underWay: Promise<unknown> = Promise.resolve();

  async function work(from: Project, document: DocumentId, removed: readonly RemovalKind[]): Promise<Approval | undefined> {
    const readings = await documentReadings(source, from.documents);
    const searched = [...readings].map(([id, { texts }]) => ({ id, texts }));
    const places = await findPlaces(source.client, keysToFind(from, document), searched);
    return approve(from, document, readings, places, removed);
  }

  async function run(from: Project, document: DocumentId, removed: readonly RemovalKind[], planId: number): Promise<Planned> {
    const approval = await work(from, document, removed).catch(() => undefined);
    if (approval === undefined || view()?.parts.record.present.project !== from) {
      dispatch({ type: "approvalFailed" });
      return failed;
    }
    const plan: ApprovalPlan = { planId, document, changes: approval.changes, here: approval.here, removed: approval.removed, unmarkedFindings: 0 };
    if (plan.changes.length > 0 || changed(plan.here) || plan.removed.length > 0) {
      dispatch({ type: "planned", plan, from, project: approval.project });
      return { ok: true, value: { landed: false, plan } };
    }
    change(approved(plan, approval.project));
    return { ok: true, value: { landed: true } };
  }

  /** The plan waiting for its heads-up, if `planId` names it. */
  function waiting(planId: number): Result<NonNullable<SessionView["parts"]["approval"]>> {
    const at = allowed("confirm");
    if (!at.ok) return at;
    const { approval } = at.value.parts;
    return approval?.plan.planId === planId ? { ok: true, value: approval } : noPlan;
  }

  return {
    plan(document) {
      const at = allowed("approve", document);
      if (!at.ok) return Promise.resolve(at);
      const from = at.value.parts.record.present.project;
      const removed = at.value.parts.documents.get(document)?.removed ?? [];
      const planId = ++plans;
      const planned = new Promise<Planned>((resolve) => dispatch({ type: "planning", document }, () => resolve(run(from, document, removed, planId))));
      underWay = planned;
      return planned;
    },
    confirm(planId) {
      const plan = waiting(planId);
      if (!plan.ok) return Promise.resolve(plan);
      if (view()?.parts.record.present.project !== plan.value.from) {
        dispatch({ type: "approvalFailed" });
        return Promise.resolve(failed);
      }
      change(approved(plan.value.plan, plan.value.project));
      return Promise.resolve({ ok: true, value: undefined });
    },
    cancel(planId) {
      const plan = waiting(planId);
      if (!plan.ok) return plan;
      dispatch({ type: "approvalCancelled" });
      return { ok: true, value: undefined };
    },
    settled: () => underWay,
  };
}
