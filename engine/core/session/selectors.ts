import type { SessionState } from "../../api/state";
import type { DocumentId } from "../../model/project";
import { newFrom, reachOf } from "../../model/spread";
import { gate, type SessionView } from "./gate";
import type { OutputPart } from "./slices/output";
import { stepsOf } from "./slices/history";

/** Whether undo, or redo, on `document` has a snapshot to go back to. */
export function canStep({ parts }: SessionView, document: DocumentId, direction: "undo" | "redo"): boolean {
  const { past, future } = stepsOf(parts.record, document);
  return (direction === "undo" ? past : future).length > 0;
}

/**
 * The output while it still matches what it was written from: the open document, its marks and
 * kept-visible list (by its edit count), and the appearance (by identity, so choosing one again
 * drops it, as Back to editing does). Once the PDF worker stops, no output can be trusted.
 */
export function validOutput({ worker, settings, parts }: SessionView): OutputPart | undefined {
  const { output, viewer, record } = parts;
  if (output === undefined || worker.status === "stopped") return undefined;
  const { document, edits, appearance } = output.tag;
  const valid = viewer.handle?.document === document && (record.present.edits.get(document) ?? 0) === edits && settings.appearance === appearance;
  return valid ? output : undefined;
}

/** The documents undo, or redo, can act on now: the gate allows it and there is a snapshot to go back to. */
function steppable(view: SessionView, direction: "undo" | "redo"): ReadonlySet<DocumentId> {
  const documents = new Set<DocumentId>();
  for (const document of view.parts.record.steps.keys()) {
    if (gate(view, "history", document) === undefined && canStep(view, document, direction)) documents.add(document);
  }
  return documents;
}

/** What the gate allows now: for the open document, and for undo and redo per document, since they need none open. */
function can(view: SessionView): SessionState["can"] {
  const document = view.parts.viewer.handle?.document;
  const allows = (command: Parameters<typeof gate>[1]) => gate(view, command, document) === undefined;
  const opened = document !== undefined;
  return {
    mark: opened && allows("add"),
    undo: steppable(view, "undo"),
    redo: steppable(view, "redo"),
    apply: allows("apply"),
    approve: opened && allows("approve"),
    add: allows("addDocuments"),
    switchDocument: allows("open"),
  };
}

/** The open Session's part of the published state. */
export function sessionState(view: SessionView, folder: string): SessionState {
  const { project } = view.parts.record.present;
  const { handle } = view.parts.viewer;
  const document = handle && project.documents.find(({ id }) => id === handle.document);
  const output = validOutput(view)?.shown;
  const { approval } = view.parts;
  return {
    project,
    folder,
    save: view.parts.operation.save,
    operation: view.parts.operation.operation,
    ...(approval === undefined ? {} : { approval: approval.plan }),
    ...(handle === undefined ? {} : { open: handle }),
    ...(output === undefined ? {} : { output }),
    can: can(view),
    reach: reachOf(project),
    newFrom: document === undefined ? [] : newFrom(project, document),
  };
}
