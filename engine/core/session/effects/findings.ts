import type { Result } from "../../../api/errors";
import type { Session } from "../../../api/facade";
import type { RunRecord } from "../../../model/detection";
import { findingMarks } from "../../../model/findingMarks";
import type { Finding, FindingChange, Hit } from "../../../model/findings";
import { isPageIndex } from "../../../model/geometry";
import { markedAgain } from "../../../model/marks";
import type { DocumentId } from "../../../model/project";
import { resolve } from "../../../model/resolver";
import { readsAt } from "../../../model/textAnchor";
import type { SessionChange } from "../changes";
import type { SessionView } from "../gate";
import { storedTexts, type ReadingSource } from "./readings";

/** What a findings review uses: the Session's state, gate and project's stored page texts, and how changes land. */
interface FindingsHost {
  readonly source: ReadingSource;
  view(): SessionView | undefined;
  allowed(command: "findings" | "confirmFindings" | "closeFindings" | "dismissNotice", document?: DocumentId): Result<SessionView>;
  dispatch(change: SessionChange): void;
  /** Dispatches a change to the project record, which saves it. */
  change(change: SessionChange): void;
}

/** The findings review's part that the Session's other effects call: a run that ended, and records that changed a document's marks. */
export interface FindingsReview {
  /** Opens a findings review on what `record`'s run found, or leaves a notice when there is nothing to offer. */
  ended(document: DocumentId, record: RunRecord, hits: readonly Hit[]): void;
  /** Resolves again each open findings review whose document's marks `change` changed from outside the panel. */
  landed(change: SessionChange): void;
  /** Resolves once no confirm is under way. */
  settled(): Promise<unknown>;
}

type Confirmed = Awaited<ReturnType<Session["findings"]["confirm"]>>;

const done: Result<void> = { ok: true, value: undefined };
const noFindings: Result<never> = { ok: false, error: { code: "no-findings" } };
const unknownFinding: Result<never> = { ok: false, error: { code: "unknown-finding" } };
const dropped: Result<never> = { ok: false, error: { code: "findings-dropped" } };
const closed: Result<never> = { ok: false, error: { code: "session-closed" } };

const documentIn = (view: SessionView, document: DocumentId) => view.parts.record.present.project.documents.find(({ id }) => id === document);

/** The findings of `hits` in `document` as `view` holds it: against its marks that are not lost, and its rejected values. */
function findingsIn(view: SessionView, document: DocumentId, hits: readonly Hit[], changes: ReadonlyMap<string, FindingChange>): readonly Finding[] {
  const record = documentIn(view, document);
  const lost = new Set(view.parts.documents.get(document)?.lost);
  const marks = record?.marks.filter(({ id }) => !lost.has(id)) ?? [];
  return resolve({ hits, marks, rejected: record?.rejected ?? [], changes });
}

/** The documents whose marks `change` changed from outside a findings review: an approval that spread marks in, and marks placed again. */
function marksChangedBy(change: SessionChange): readonly DocumentId[] {
  switch (change.type) {
    case "approved":
      return change.changedDocuments;
    case "documentPrepared":
    case "reanchored":
      return [change.document];
    default:
      return [];
  }
}

/**
 * A document's findings review, behind the gate: ticking its findings, confirming it into marks and
 * rejected values, and closing it. Picking candidates and moving edges come with slice R3, and
 * stored notices with slice R2; until then those commands refuse.
 */
export function findingsOf({ source, allowed, view, dispatch, change }: FindingsHost): Session["findings"] & FindingsReview {
  let underWay: Promise<unknown> = Promise.resolve();

  const refused = (command: Parameters<FindingsHost["allowed"]>[0], document: DocumentId): Result<never> => {
    const at = allowed(command, document);
    return at.ok ? noFindings : at;
  };

  /** Runs the resolver on `document`'s open findings review; one with no findings left ends by itself. */
  function resolveAgain(document: DocumentId) {
    const now = view();
    const open = now?.parts.findings.get(document);
    if (now === undefined || open === undefined) return;
    const findings = findingsIn(now, document, open.hits, open.changes);
    dispatch(findings.length === 0 ? { type: "findingsClosed", document } : { type: "findingsResolved", document, findings });
  }

  /** A text-changed confirm: nothing is marked, and the findings review is dropped with a notice. */
  function drop(document: DocumentId): Result<never> {
    dispatch({ type: "findingsNotApplied", document });
    dispatch({ type: "findingsClosed", document });
    dispatch({ type: "noticeSet", document, notice: { kind: "dropped", reason: "text-changed" } });
    return dropped;
  }

  /**
   * Confirm's steps 2 to 4 (Technical Plan, section 4), once `findingsApplying` began the
   * operation: tests every hit against the stored page texts, builds one mark per place of each
   * ticked finding, and lands them with the rejected values. Every way out ends the operation.
   */
  async function marking(document: DocumentId): Promise<Confirmed> {
    const before = view();
    const record = before && documentIn(before, document);
    const texts = record === undefined ? noFindings : await storedTexts(source, record);
    const now = view();
    if (now === undefined) return closed;
    const open = now.parts.findings.get(document);
    const latest = documentIn(now, document);
    if (!texts.ok || open === undefined || latest === undefined) {
      dispatch({ type: "findingsNotApplied", document });
      if (!texts.ok && texts.error.code === "busy-updating") source.unavailable();
      return texts.ok ? noFindings : texts;
    }
    const pages = new Map(texts.value.flatMap((text, index) => (isPageIndex(index) ? [[index, text] as const] : [])));
    const marks = open.hits.every((hit) => readsAt(pages, hit)) ? findingMarks(pages, open.findings, latest.marks) : undefined;
    if (marks === undefined) return drop(document);
    const lostIds = new Set(now.parts.documents.get(document)?.lost);
    const lost = latest.marks.filter(({ id }) => lostIds.has(id));
    const replaces = [...new Set(marks.flatMap(({ target }) => markedAgain(lost, target)))];
    const rejected = open.findings.flatMap(({ key, ticked }) => (ticked ? [] : [key]));
    const values = open.findings.length - rejected.length;
    change({ type: "findingsApplied", document, values, marks, replaces, rejected });
    return { ok: true, value: { values, marks: marks.length } };
  }

  return {
    setTicked(document, key, ticked) {
      const at = allowed("findings", document);
      if (!at.ok) return at;
      if (!at.value.parts.findings.get(document)?.findings.some((finding) => finding.key === key)) return unknownFinding;
      dispatch({ type: "findingChanged", document, key, change: { ticked } });
      resolveAgain(document);
      return done;
    },
    choose: (document) => refused("findings", document),
    setEdges: (document) => refused("findings", document),
    confirm(document) {
      const at = allowed("confirmFindings", document);
      if (!at.ok) return Promise.resolve(at);
      dispatch({ type: "findingsApplying", document });
      const confirmed = marking(document).catch((error: unknown) => {
        // A fault in building the marks still ends the operation, with nothing marked.
        dispatch({ type: "findingsNotApplied", document });
        throw error;
      });
      // Closing waits for the confirm to land, not for it to succeed.
      underWay = confirmed.catch(() => undefined);
      return confirmed;
    },
    close(document) {
      const at = allowed("closeFindings", document);
      if (!at.ok) return Promise.resolve(at);
      dispatch({ type: "findingsClosed", document });
      return Promise.resolve(done);
    },
    dismissNotice: (document) => refused("dismissNotice", document),
    settled: () => underWay,
    ended(document, { run, notSearched, ended }, hits) {
      const now = view();
      // A run the Session's closing stopped loses its hits, as a reload does.
      if (now === undefined || now.parts.operation.closing) return;
      const changes = new Map<string, FindingChange>();
      const findings = findingsIn(now, document, hits, changes);
      if (findings.length > 0) dispatch({ type: "findingsOpened", document, run, hits, notSearched, changes, findings });
      // A run that failed says why instead (slice W2).
      else if (ended !== "failed") dispatch({ type: "noticeSet", document, notice: { kind: "nothing-found", notSearched } });
    },
    landed(change) {
      for (const document of marksChangedBy(change)) resolveAgain(document);
    },
  };
}
