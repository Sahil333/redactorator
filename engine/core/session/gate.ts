import type { ErrorCode } from "../../api/errors";
import type { EngineState, SessionState } from "../../api/state";
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
 * mark commands and `labelling.link`; `history` is undo and redo; `approve` is `approval.plan`, and
 * `confirm` its `confirm` and `cancel`; `addDocuments` is `documents.add`; `query` is the queries,
 * and Back to editing.
 */
type SessionCommand = "add" | "mark" | "history" | "markDownloaded" | "open" | "apply" | "approve" | "confirm" | "addDocuments" | "query" | "close";

/** Refused while the PDF worker is starting or stopped. */
const needsWorker = new Set<SessionCommand>(["history", "apply", "approve"]);
/** Refused while an apply runs, or documents are being added, with the code each gives; `documents.add` has its own codes. */
const oneOperation = new Set<SessionCommand>(["history", "open", "apply", "approve"]);
const busy: Partial<Record<SessionState["operation"], ErrorCode>> = { applying: "busy-applying", adding: "busy-adding" };
/** Why `documents.add` is refused while another operation runs; the app tells the user the first two codes. */
const addRefused: Partial<Record<SessionState["operation"], ErrorCode>> = {
  planning: "add-while-approving",
  confirming: "add-while-approving",
  applying: "add-while-applying",
  adding: "busy-adding",
};
/**
 * Refused while approval plans or its heads-up is open: every command that changes the project
 * record, and every other operation (`documents.add` with its own code), so the plan always lands
 * on the record it was made from.
 */
const waitsForApproval = new Set<SessionCommand>(["add", "mark", "history", "markDownloaded", "apply", "approve"]);

/** Why `command` is refused while approval works out what spreads, or waits for its heads-up. */
function approving({ operation }: SessionView["parts"]["operation"], command: SessionCommand): ErrorCode | undefined {
  if (command === "confirm") return operation === "confirming" ? undefined : "no-plan";
  if (operation !== "planning" && operation !== "confirming") return undefined;
  // Another document can be opened behind the heads-up.
  return waitsForApproval.has(command) || (command === "open" && operation === "planning") ? "busy-approving" : undefined;
}

/** Why `command` is refused while another operation runs. */
function running(command: SessionCommand, operation: SessionState["operation"]): ErrorCode | undefined {
  if (command === "addDocuments") return addRefused[operation];
  return oneOperation.has(command) ? busy[operation] : undefined;
}

/** Whether `command` waits for the PDF worker, as it is now. */
function waitsForWorker({ status }: SessionView["worker"], command: SessionCommand): boolean {
  if (needsWorker.has(command)) return status === "starting" || status === "stopped";
  // A document is read as it is added, once the worker answers. A mark needs only the page text the
  // Session holds: it is taken during an apply, whose output it leaves out of date, and once the
  // worker has stopped, so a mark being typed is kept.
  if (command === "addDocuments") return status === "stopped";
  return command === "add" && status === "starting";
}

/** Why `command` is refused now, or undefined when it may run. `document`: the document it acts on. */
export function gate({ worker, parts }: SessionView, command: SessionCommand, document?: DocumentId): ErrorCode | undefined {
  if (parts.operation.closing) return "session-closed";
  if (document !== undefined && !parts.record.present.project.documents.some(({ id }) => id === document)) return "unknown-document";
  const approval = approving(parts.operation, command);
  if (approval !== undefined) return approval;
  const busyWith = running(command, parts.operation.operation);
  if (busyWith !== undefined) return busyWith;
  if (waitsForWorker(worker, command)) return "worker-not-ready";
  if (command === "apply" && parts.viewer.handle === undefined) return "stale-handle";
  return undefined;
}
