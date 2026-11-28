import type { Result } from "../../../api/errors";
import type { Session } from "../../../api/facade";
import type { DocumentId } from "../../../model/project";
import type { SessionChange } from "../changes";
import type { SessionView } from "../gate";
import type { ReadingSource } from "./readings";

/** What a findings review uses: the Session's state and gate, its project's stored page texts, and how changes land. */
interface FindingsHost {
  readonly source: ReadingSource;
  view(): SessionView | undefined;
  allowed(command: "findings" | "confirmFindings" | "closeFindings" | "dismissNotice", document?: DocumentId): Result<SessionView>;
  dispatch(change: SessionChange, ...effects: (() => void)[]): void;
  /** Dispatches a change to the project record, which saves it. */
  change(change: SessionChange): void;
}

const noFindings: Result<never> = { ok: false, error: { code: "no-findings" } };

/** A document's findings review, behind the gate. No run ends with hits yet, so none is ever open. */
export function findingsOf({ allowed }: FindingsHost): Session["findings"] {
  const refused = (command: Parameters<FindingsHost["allowed"]>[0], document: DocumentId): Result<never> => {
    const at = allowed(command, document);
    return at.ok ? noFindings : at;
  };
  return {
    setTicked: (document) => refused("findings", document),
    choose: (document) => refused("findings", document),
    setEdges: (document) => refused("findings", document),
    confirm: (document) => Promise.resolve(refused("confirmFindings", document)),
    close: (document) => Promise.resolve(refused("closeFindings", document)),
    dismissNotice: (document) => refused("dismissNotice", document),
  };
}
