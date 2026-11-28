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
 * and Back to editing. `run` and `stop` are `detection`'s; `findings` is `findings.setTicked`,
 * `choose` and `setEdges`, and `confirmFindings`, `closeFindings` and `dismissNotice` the other
 * three; `profile` is `profile.set`.
 */
type SessionCommand =
  | "add"
  | "mark"
  | "history"
  | "markDownloaded"
  | "open"
  | "apply"
  | "approve"
  | "confirm"
  | "addDocuments"
  | "query"
  | "close"
  | "run"
  | "stop"
  | "findings"
  | "confirmFindings"
  | "closeFindings"
  | "dismissNotice"
  | "profile";

/** Refused while documents are prepared again for this build: each would act on marks, working copies or page texts about to change. */
const waitsForUpdate = new Set<SessionCommand>([
  "add",
  "mark",
  "history",
  "open",
  "apply",
  "approve",
  "confirm",
  "addDocuments",
  "markDownloaded",
  "run",
  "findings",
  "confirmFindings",
  "closeFindings",
  "dismissNotice",
  "profile",
]);
/** Refused until the document's prepared files are read: approving lists what preparing it removed, and Auto mode reads its page texts. */
const waitsForPrepared = new Set<SessionCommand>(["approve", "run", "findings", "confirmFindings", "closeFindings", "dismissNotice"]);

/** Refused while the PDF worker is starting or stopped. */
const needsWorker = new Set<SessionCommand>(["history", "apply", "approve"]);
/** Refused while another operation runs, with the code each gives; `documents.add` has its own codes. */
const oneOperation = new Set<SessionCommand>(["history", "open", "apply", "approve", "confirmFindings", "profile"]);
const busy: Partial<Record<SessionState["operation"], ErrorCode>> = { applying: "busy-applying", adding: "busy-adding", marking: "busy-marking" };
/** Why `documents.add` is refused while another operation runs; the app tells the user the first two codes. */
const addRefused: Partial<Record<SessionState["operation"], ErrorCode>> = {
  planning: "add-while-approving",
  confirming: "add-while-approving",
  applying: "add-while-applying",
  adding: "busy-adding",
  marking: "busy-marking",
};
/**
 * Refused while approval plans or its heads-up is open: every command that changes the project
 * record or the number of found values the heads-up shows, and every other operation
 * (`documents.add` with its own code), so the plan always lands on the record it was made from.
 */
const waitsForApproval = new Set<SessionCommand>(["add", "mark", "history", "markDownloaded", "apply", "approve", "run", "confirmFindings", "closeFindings", "profile"]);
/** Refused on a document whose findings review is open: hand marking, undo and redo, and a new run. */
const waitsForFindings = new Set<SessionCommand>(["add", "mark", "history", "run"]);
/** Refused on a document with no findings review open. */
const needsFindings = new Set<SessionCommand>(["findings", "confirmFindings", "closeFindings"]);

/** Why `command` is refused while approval works out what spreads, or waits for its heads-up. */
function approving({ operation }: SessionView["parts"]["operation"], command: SessionCommand): ErrorCode | undefined {
  if (command === "confirm") return operation === "confirming" ? undefined : "no-plan";
  if (operation !== "planning" && operation !== "confirming") return undefined;
  // Another document can be opened behind the heads-up.
  return waitsForApproval.has(command) || (command === "open" && operation === "planning") ? "busy-approving" : undefined;
}

/** Why `command` on `document` is refused by a run of Auto mode or by a findings review, open or not. */
function detecting({ detection, findings }: SessionView["parts"], command: SessionCommand, document: DocumentId | undefined): ErrorCode | undefined {
  const isRunning = (id: DocumentId) => detection.get(id)?.run.state === "running";
  if (command === "run" && [...detection.keys()].some(isRunning)) return "busy-detecting";
  if (document === undefined) return undefined;
  if (command === "approve" && isRunning(document)) return "busy-detecting";
  const open = findings.has(document);
  if (open && waitsForFindings.has(command)) return "findings-open";
  return !open && needsFindings.has(command) ? "no-findings" : undefined;
}

/** Why `command` on `document` is refused before its prepared files are read, or because preparing it failed. */
function preparing({ documents }: SessionView["parts"], command: SessionCommand, document: DocumentId | undefined): ErrorCode | undefined {
  if (document === undefined) return undefined;
  const status = documents.get(document);
  if (status === undefined) return waitsForPrepared.has(command) ? "busy-updating" : undefined;
  // A run reads the page texts that preparing the document made.
  return command === "run" ? status.failed : undefined;
}

/** Why `command` is refused while another operation runs. */
function running(command: SessionCommand, operation: SessionState["operation"]): ErrorCode | undefined {
  if (command === "addDocuments") return addRefused[operation];
  // Closing a findings review is no operation, but it would end the one being confirmed.
  if (command === "closeFindings") return operation === "marking" ? "busy-marking" : undefined;
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
  if (parts.operation.operation === "updating" && waitsForUpdate.has(command)) return "busy-updating";
  const unprepared = preparing(parts, command, document);
  if (unprepared !== undefined) return unprepared;
  const approval = approving(parts.operation, command);
  if (approval !== undefined) return approval;
  const busyWith = running(command, parts.operation.operation);
  if (busyWith !== undefined) return busyWith;
  const detected = detecting(parts, command, document);
  if (detected !== undefined) return detected;
  if (waitsForWorker(worker, command)) return "worker-not-ready";
  if (command === "apply" && parts.viewer.handle === undefined) return "stale-handle";
  return undefined;
}
