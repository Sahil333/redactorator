import type { DocumentId, Project } from "../../../model/project";
import type { SessionChange } from "../changes";
import { approval, type ApprovalPart } from "./approval";
import { detection, firstDetection, type DetectionPart } from "./detection";
import { documents, firstDocuments, type DocumentsPart } from "./documents";
import { findings, firstFindings, type FindingsPart } from "./findings";
import { history, withNoHistory, type HistoryPart } from "./history";
import { firstMarks, marks, type MarksPart } from "./marks";
import { firstOperation, operation, type OperationPart } from "./operation";
import { output, type OutputPart } from "./output";
import { firstViewer, viewer, type ViewerPart } from "./viewer";

export interface SessionParts {
  /** The project record and its edit counters, with each document's undo and redo. */
  readonly record: HistoryPart<MarksPart>;
  readonly operation: OperationPart;
  readonly viewer: ViewerPart;
  readonly output: OutputPart | undefined;
  readonly approval: ApprovalPart | undefined;
  readonly documents: DocumentsPart;
  readonly detection: DetectionPart;
  readonly findings: FindingsPart;
}

export const firstParts = (project: Project): SessionParts => ({
  record: withNoHistory(firstMarks(project)),
  operation: firstOperation,
  viewer: firstViewer,
  output: undefined,
  approval: undefined,
  documents: firstDocuments,
  detection: firstDetection,
  findings: firstFindings,
});

/** The document an undoable record changes. A label change is not undone. */
function isUndoable(change: SessionChange): DocumentId | undefined {
  switch (change.type) {
    case "markAdded":
    case "markRetyped":
    case "markRemoved":
    case "keptHere":
      return change.document;
    default:
      return undefined;
  }
}

const record = history(marks, isUndoable);

export function session(parts: SessionParts, change: SessionChange): SessionParts {
  const next = {
    record: record(parts.record, change),
    operation: operation(parts.operation, change),
    viewer: viewer(parts.viewer, change),
    output: output(parts.output, change),
    approval: approval(parts.approval, change),
    documents: documents(parts.documents, change),
    detection: detection(parts.detection, change),
    findings: findings(parts.findings, change),
  };
  const same =
    next.record === parts.record &&
    next.operation === parts.operation &&
    next.viewer === parts.viewer &&
    next.output === parts.output &&
    next.approval === parts.approval &&
    next.documents === parts.documents &&
    next.detection === parts.detection &&
    next.findings === parts.findings;
  return same ? parts : next;
}
