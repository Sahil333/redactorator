import type { SessionState } from "../../api/state";
import type { DocumentId } from "../../model/project";
import { gate, type SessionView } from "./gate";
import { stepsOf } from "./slices/history";

/** Whether undo, or redo, on `document` has a snapshot to go back to. */
export function canStep({ parts }: SessionView, document: DocumentId, direction: "undo" | "redo"): boolean {
  const { past, future } = stepsOf(parts.record, document);
  return (direction === "undo" ? past : future).length > 0;
}

/** The documents undo and redo can act on now: the gate allows it and there is a snapshot to go back to. */
function can(view: SessionView): SessionState["can"] {
  const undo = new Set<DocumentId>();
  const redo = new Set<DocumentId>();
  for (const document of view.parts.record.steps.keys()) {
    if (gate(view, "history", document) !== undefined) continue;
    if (canStep(view, document, "undo")) undo.add(document);
    if (canStep(view, document, "redo")) redo.add(document);
  }
  return { undo, redo };
}

/** The open Session's part of the published state. */
export const sessionState = (view: SessionView, folder: string): SessionState => ({
  project: view.parts.record.present.project,
  folder,
  save: view.parts.operation.save,
  can: can(view),
});
