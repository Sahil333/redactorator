import type { DocumentDetection } from "../../../api/state";
import type { DocumentId, Project } from "../../../model/project";
import type { Edits, SessionChange } from "../changes";

// Undo goes back this many changes per document.
const HISTORY_LIMIT = 100;

/** What a step undoes: an edit, or the marks a confirmed findings review made, with its counts. */
export type StepTag = NonNullable<DocumentDetection["nextUndo"]>;

/** Each snapshot's tag is at the same place in its list as the snapshot, and moves with it. */
interface Steps {
  readonly past: readonly Edits[];
  readonly future: readonly Edits[];
  readonly pastTags: readonly StepTag[];
  readonly futureTags: readonly StepTag[];
}

export interface HistoryPart<P> {
  /** The wrapped slice's part. */
  readonly present: P;
  /** Each document's snapshots, to undo back to and redo forward to; a document with none has no entry. */
  readonly steps: ReadonlyMap<DocumentId, Steps>;
}

type Slice<P> = (part: P, change: SessionChange) => P;

const noSteps: Steps = { past: [], future: [], pastTags: [], futureTags: [] };

export const withNoHistory = <P>(present: P): HistoryPart<P> => ({ present, steps: new Map() });

export const stepsOf = (part: HistoryPart<unknown>, document: DocumentId): Steps => part.steps.get(document) ?? noSteps;

function editsOf(project: Project, id: DocumentId): Edits {
  const document = project.documents.find((each) => each.id === id);
  return { marks: document?.marks ?? [], shown: document?.shown ?? [] };
}

/**
 * Wraps `inner` with per-document undo and redo. `undoable` names the document an undoable record
 * changes, and tags its step. Undo and redo reach `inner` as a `restored` record, which it applies
 * with its own rules. An approval can't be undone, so it ends the history of every document it
 * changed; placing a document's marks again ends its history too.
 */
export function history<P extends { readonly project: Project }>(
  inner: Slice<P>,
  undoable: (change: SessionChange) => { readonly document: DocumentId; readonly tag: StepTag } | undefined,
): Slice<HistoryPart<P>> {
  function step(part: HistoryPart<P>, document: DocumentId, direction: "undo" | "redo"): HistoryPart<P> {
    const { past, future, pastTags, futureTags } = stepsOf(part, document);
    const to = (direction === "undo" ? past : future).at(-1);
    const tag = (direction === "undo" ? pastTags : futureTags).at(-1);
    if (to === undefined || tag === undefined) return part;
    const now = editsOf(part.present.project, document);
    const steps =
      direction === "undo"
        ? { past: past.slice(0, -1), future: [...future, now], pastTags: pastTags.slice(0, -1), futureTags: [...futureTags, tag] }
        : { past: [...past, now], future: future.slice(0, -1), pastTags: [...pastTags, tag], futureTags: futureTags.slice(0, -1) };
    return { present: inner(part.present, { type: "restored", document, ...to }), steps: new Map(part.steps).set(document, steps) };
  }

  return (part, change) => {
    if (change.type === "undo" || change.type === "redo") return step(part, change.document, change.type);
    const present = inner(part.present, change);
    if (change.type === "approved" || change.type === "reanchored") {
      // Snapshots from before would bring back marks at offsets this build no longer reads.
      const steps = new Map(part.steps);
      for (const document of change.type === "approved" ? change.changedDocuments : [change.document]) steps.delete(document);
      return { present, steps };
    }
    const undone = undoable(change);
    if (undone === undefined) return present === part.present ? part : { ...part, present };
    const { document, tag } = undone;
    const before = stepsOf(part, document);
    // A new change clears redo.
    const past = [...before.past, editsOf(part.present.project, document)].slice(-HISTORY_LIMIT);
    const pastTags = [...before.pastTags, tag].slice(-HISTORY_LIMIT);
    return { present, steps: new Map(part.steps).set(document, { past, future: [], pastTags, futureTags: [] }) };
  };
}
