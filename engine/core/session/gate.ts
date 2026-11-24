import type { ErrorCode } from "../../api/errors";
import type { EngineState } from "../../api/state";
import type { DocumentId, Settings } from "../../model/project";
import type { SessionParts } from "./slices";

/** What the Session's gate and selectors read: the PDF worker's status, the settings and the open Session's state. */
export interface SessionView {
  readonly worker: EngineState["worker"];
  readonly settings: Settings;
  readonly parts: SessionParts;
}

/**
 * The Session's commands, by what the gate asks of each. `add` is `marks.add`; `mark` is the other
 * mark commands and `labelling.link`; `history` is undo and redo; `change` is a change the app's
 * hooks worked out, landed through `interim`; `approve` and `addDocuments` run in the app until
 * steps 6c and 6d, and the gate only fills `can` for them; `query` is the queries, and Back to editing.
 */
type SessionCommand = "add" | "mark" | "history" | "markDownloaded" | "change" | "open" | "apply" | "approve" | "addDocuments" | "query" | "close";

/** Refused while the PDF worker is starting or stopped; `add` is taken during an apply, whose output it leaves out of date. */
const needsWorker = new Set<SessionCommand>(["add", "history", "apply", "approve"]);
/** Refused while an apply runs. */
const waitsForApply = new Set<SessionCommand>(["history", "open", "apply", "approve", "addDocuments"]);

/** Why `command` is refused now, or undefined when it may run. `document`: the document it acts on. */
export function gate({ worker, parts }: SessionView, command: SessionCommand, document?: DocumentId): ErrorCode | undefined {
  if (parts.operation.closing) return "session-closed";
  if (document !== undefined && !parts.record.present.project.documents.some(({ id }) => id === document)) return "unknown-document";
  if (waitsForApply.has(command) && parts.operation.operation === "applying") return "busy-applying";
  if (needsWorker.has(command) && (worker.status === "starting" || worker.status === "stopped")) return "worker-not-ready";
  if (command === "addDocuments" && worker.status === "stopped") return "worker-not-ready";
  if (command === "apply" && parts.viewer.handle === undefined) return "stale-handle";
  return undefined;
}
