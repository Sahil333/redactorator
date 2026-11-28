import type { Result } from "../../../api/errors";
import type { Session } from "../../../api/facade";
import type { RunRecord } from "../../../model/detection";
import type { Finding, FindingChange, Hit } from "../../../model/findings";
import type { DocumentId } from "../../../model/project";
import { resolve } from "../../../model/resolver";
import type { SessionChange } from "../changes";
import type { SessionView } from "../gate";

/** What a findings review uses: the Session's state and gate, and how changes land. */
interface FindingsHost {
  view(): SessionView | undefined;
  allowed(command: "findings" | "confirmFindings" | "closeFindings" | "dismissNotice", document?: DocumentId): Result<SessionView>;
  dispatch(change: SessionChange): void;
}

/** The findings review's part that the Session's other effects call: a run that ended, and records that changed a document's marks. */
export interface FindingsReview {
  /** Opens a findings review on what `record`'s run found, or leaves a notice when there is nothing to offer. */
  ended(document: DocumentId, record: RunRecord, hits: readonly Hit[]): void;
  /** Resolves again each open findings review whose document's marks `change` changed from outside the panel. */
  landed(change: SessionChange): void;
}

const noFindings: Result<never> = { ok: false, error: { code: "no-findings" } };

/** The findings of `hits` in `document` as `view` holds it: against its marks that are not lost, and its rejected values. */
function findingsIn(view: SessionView, document: DocumentId, hits: readonly Hit[], changes: ReadonlyMap<string, FindingChange>): readonly Finding[] {
  const record = view.parts.record.present.project.documents.find(({ id }) => id === document);
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

/** A document's findings review, behind the gate. Ticking, confirming and closing come with the findings panel; until then those commands refuse. */
export function findingsOf({ allowed, view, dispatch }: FindingsHost): Session["findings"] & FindingsReview {
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

  return {
    setTicked: (document) => refused("findings", document),
    choose: (document) => refused("findings", document),
    setEdges: (document) => refused("findings", document),
    confirm: (document) => Promise.resolve(refused("confirmFindings", document)),
    close: (document) => Promise.resolve(refused("closeFindings", document)),
    dismissNotice: (document) => refused("dismissNotice", document),
    ended(document, { run, notSearched, ended }, hits) {
      const now = view();
      // A run the Session's closing stopped loses its hits, as a reload does.
      if (now === undefined || now.parts.operation.closing) return;
      const changes = new Map<string, FindingChange>();
      const findings = findingsIn(now, document, hits, changes);
      if (findings.length > 0) dispatch({ type: "findingsOpened", document, run, hits, ended, notSearched, changes, findings });
      else dispatch({ type: "noticeSet", document, notice: { kind: "nothing-found", ended, notSearched } });
    },
    landed(change) {
      for (const document of marksChangedBy(change)) resolveAgain(document);
    },
  };
}
