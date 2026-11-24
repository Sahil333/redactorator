import type { DocumentId, Project } from "../../../model/project";
import type { SessionChange } from "../changes";
import { history, withNoHistory, type HistoryPart } from "./history";
import { firstMarks, marks, type MarksPart } from "./marks";
import { firstOperation, operation, type OperationPart } from "./operation";

export interface SessionParts {
  /** The project record and its edit counters, with each document's undo and redo. */
  readonly record: HistoryPart<MarksPart>;
  readonly operation: OperationPart;
}

export const firstParts = (project: Project): SessionParts => ({ record: withNoHistory(firstMarks(project)), operation: firstOperation });

/** The document an undoable record changes. A label change is not undone. */
const isUndoable = (change: SessionChange): DocumentId | undefined => (change.type === "replaced" && change.kind === "edit" ? change.document : undefined);

const record = history(marks, isUndoable);

export function session(parts: SessionParts, change: SessionChange): SessionParts {
  const next = { record: record(parts.record, change), operation: operation(parts.operation, change) };
  return next.record === parts.record && next.operation === parts.operation ? parts : next;
}
