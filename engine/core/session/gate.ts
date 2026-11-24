import type { ErrorCode } from "../../api/errors";
import type { EngineState } from "../../api/state";
import type { DocumentId } from "../../model/project";
import type { SessionParts } from "./slices";

/** What the Session's gate reads: the PDF worker's status and the open Session's state. */
export interface SessionView {
  readonly worker: EngineState["worker"];
  readonly parts: SessionParts;
}

/**
 * The Session's commands, by what the gate asks of each. `history` is undo and redo; `change` is
 * a change the app's hooks worked out, landed through `interim`.
 */
type SessionCommand = "history" | "markDownloaded" | "change" | "close";

/** Why `command` is refused now, or undefined when it may run. `document`: the document it acts on. */
export function gate({ worker, parts }: SessionView, command: SessionCommand, document?: DocumentId): ErrorCode | undefined {
  if (parts.operation.closing) return "session-closed";
  if (document !== undefined && !parts.record.present.project.documents.some(({ id }) => id === document)) return "unknown-document";
  if (command === "history" && worker.status === "applying") return "busy-applying";
  if (command === "history" && worker.status !== "ready") return "worker-not-ready";
  return undefined;
}
