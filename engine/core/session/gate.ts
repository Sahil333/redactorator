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
 * hooks worked out, landed through `interim`; `approve` is `approval.plan`, and `confirm` its
 * `confirm` and `cancel`; `addDocuments` runs in the app until step 6d, and the gate only fills `can`
 * for it; `query` is the queries, and Back to editing.
 */
type SessionCommand =
  | "add"
  | "mark"
  | "history"
  | "markDownloaded"
  | "change"
  | "open"
  | "apply"
  | "approve"
  | "confirm"
  | "addDocuments"
  | "query"
  | "close";

/** Refused while the PDF worker is starting or stopped. */
const needsWorker = new Set<SessionCommand>(["history", "apply", "approve"]);
/** Refused while an apply runs. */
const waitsForApply = new Set<SessionCommand>(["history", "open", "apply", "approve", "addDocuments"]);
/**
 * Refused while approval plans or its heads-up is open: every command that changes the project
 * record, and every other operation, so the plan always lands on the record it was made from.
 */
const waitsForApproval = new Set<SessionCommand>(["add", "mark", "history", "markDownloaded", "change", "apply", "approve", "addDocuments"]);

/** Why `command` is refused while approval works out what spreads, or waits for its heads-up. */
function approving({ operation }: SessionView["parts"]["operation"], command: SessionCommand): ErrorCode | undefined {
  if (command === "confirm") return operation === "confirming" ? undefined : "no-plan";
  if (operation !== "planning" && operation !== "confirming") return undefined;
  if (command === "addDocuments") return "add-while-approving";
  // Another document can be opened behind the heads-up, as before.
  return waitsForApproval.has(command) || (command === "open" && operation === "planning") ? "busy-approving" : undefined;
}

/** Why `command` is refused now, or undefined when it may run. `document`: the document it acts on. */
export function gate({ worker, parts }: SessionView, command: SessionCommand, document?: DocumentId): ErrorCode | undefined {
  if (parts.operation.closing) return "session-closed";
  if (document !== undefined && !parts.record.present.project.documents.some(({ id }) => id === document)) return "unknown-document";
  const approval = approving(parts.operation, command);
  if (approval !== undefined) return approval;
  if (waitsForApply.has(command) && parts.operation.operation === "applying") return "busy-applying";
  if (needsWorker.has(command) && (worker.status === "starting" || worker.status === "stopped")) return "worker-not-ready";
  if (command === "addDocuments" && worker.status === "stopped") return "worker-not-ready";
  // A mark needs only the page text the Session holds: it is taken during an apply, whose output
  // it leaves out of date, and once the worker has stopped, so a mark being typed is kept.
  if (command === "add" && worker.status === "starting") return "worker-not-ready";
  if (command === "apply" && parts.viewer.handle === undefined) return "stale-handle";
  return undefined;
}
