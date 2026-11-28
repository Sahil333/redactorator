import { itemKey, markKey, type Mark } from "../../../model/marks";
import type { DocumentId, Project, ProjectDocument } from "../../../model/project";
import type { Edits, SessionChange } from "../changes";

export interface MarksPart {
  /** The project record, as it is saved. */
  readonly project: Project;
  /** Per document, how many changes its marks or kept-visible list have had; none yet is 0. */
  readonly edits: ReadonlyMap<DocumentId, number>;
}

export const firstMarks = (project: Project): MarksPart => ({ project, edits: new Map() });

/**
 * How a change to a document is kept. An `edit` alters what an apply would write: it can be
 * undone, and puts the document in review. A `note` alters nothing an apply writes: labelling
 * data, or rejected values alone.
 */
type EditKind = "edit" | "note";

/** A document's marks and kept-visible list after a change, the kind of change, and the keys of values it rejects. */
interface Edited {
  readonly edits: Edits;
  readonly kind: EditKind;
  readonly rejected?: readonly string[];
}

function withEdits(project: Project, id: DocumentId, { edits: { marks, shown }, kind, rejected = [] }: Edited): Project {
  // A value marked again is no longer one the user keeps visible here.
  const keep = shown.filter((key) => !marks.some((mark) => markKey(mark) === key));
  const documents = project.documents.map((document): ProjectDocument => {
    if (document.id !== id) return document;
    const changed = { ...document, marks, shown: keep, rejected: [...document.rejected, ...rejected.filter((key) => !document.rejected.includes(key))] };
    if (kind === "note") return changed;
    return { ...changed, review: "in-review", download: document.download === "none" ? "none" : "changed" };
  });
  return { ...project, documents };
}

function counted(edits: ReadonlyMap<DocumentId, number>, documents: readonly DocumentId[]): ReadonlyMap<DocumentId, number> {
  const next = new Map(edits);
  for (const document of documents) next.set(document, (next.get(document) ?? 0) + 1);
  return next;
}

/** Restores a document's marks and kept-visible list; each mark keeps its latest link id, which is labelling data undo does not track. */
function restored(project: Project, id: DocumentId, { marks, shown }: Edits): Project {
  const now = project.documents.find((document) => document.id === id)?.marks ?? [];
  const linkIds = new Map(now.map((mark) => [mark.id, mark.linkId]));
  return withEdits(project, id, { edits: { marks: marks.map((mark) => ({ ...mark, linkId: linkIds.get(mark.id) ?? mark.linkId })), shown }, kind: "edit" });
}

/** A document's marks and kept-visible list after a mark command or a confirmed findings review. */
function edited(document: ProjectDocument, change: SessionChange): Edited | undefined {
  const { marks, shown } = document;
  const item = (markId: number) => {
    const mark = marks.find((each) => each.id === markId);
    return mark && itemKey(mark);
  };
  const onItem = (markId: number, update: (mark: Mark) => Mark) => {
    const key = item(markId);
    return marks.map((each) => (itemKey(each) === key ? update(each) : each));
  };
  switch (change.type) {
    case "markAdded":
      return { edits: { marks: [...marks.filter((each) => !change.replaces.includes(each.id)), change.mark], shown }, kind: "edit" };
    case "markRetyped":
      return { edits: { marks: onItem(change.markId, (each) => ({ ...each, type: change.markType })), shown }, kind: "edit" };
    case "markRemoved": {
      const key = item(change.markId);
      return { edits: { marks: marks.filter((each) => itemKey(each) !== key), shown }, kind: "edit" };
    }
    case "keptHere":
      return { edits: { marks: marks.filter((each) => itemKey(each) !== change.key), shown: [...shown, change.key] }, kind: "edit" };
    case "linked":
      return { edits: { marks: onItem(change.markId, (each) => ({ ...each, linkId: change.linkId })), shown }, kind: "note" };
    case "findingsApplied": {
      const kept = marks.filter((each) => !change.replaces.includes(each.id));
      return { edits: { marks: [...kept, ...change.marks], shown }, kind: change.marks.length > 0 ? "edit" : "note", rejected: change.rejected };
    }
    default:
      return undefined;
  }
}

function markCommand(part: MarksPart, change: Extract<SessionChange, { readonly document: DocumentId }>): MarksPart {
  const document = part.project.documents.find((each) => each.id === change.document);
  const result = document && edited(document, change);
  if (result === undefined) return part;
  return {
    project: withEdits(part.project, change.document, result),
    edits: result.kind === "edit" ? counted(part.edits, [change.document]) : part.edits,
  };
}

/**
 * A document's marks placed again, which is not an edit: its edit count and download state stay.
 * An approved document whose marks or working copy changed goes back to review.
 */
function reanchored(project: Project, { document: id, marks, workingChanged }: Extract<SessionChange, { readonly type: "reanchored" }>): Project {
  const documents = project.documents.map((document): ProjectDocument => {
    if (document.id !== id) return document;
    const changed = workingChanged || marks !== document.marks;
    return { ...document, marks, review: changed && document.review === "approved" ? "in-review" : document.review };
  });
  return { ...project, documents };
}

/** The project record and its documents' edit counters. */
export function marks(part: MarksPart, change: SessionChange): MarksPart {
  switch (change.type) {
    case "markAdded":
    case "markRetyped":
    case "markRemoved":
    case "keptHere":
    case "linked":
    case "findingsApplied":
      return markCommand(part, change);
    case "restored":
      return { project: restored(part.project, change.document, change), edits: counted(part.edits, [change.document]) };
    case "approved":
      return { project: change.project, edits: counted(part.edits, change.changedDocuments) };
    case "documentsAdded":
      return {
        project: { ...part.project, documents: [...part.project.documents, ...change.documents] },
        edits: counted(
          part.edits,
          change.documents.map(({ id }) => id),
        ),
      };
    case "reanchored":
      return { ...part, project: reanchored(part.project, change) };
    case "profileSet":
      return { ...part, project: { ...part.project, profile: change.profile } };
    case "downloaded": {
      const documents = part.project.documents.map((document): ProjectDocument => (document.id === change.document ? { ...document, download: "downloaded" } : document));
      return { ...part, project: { ...part.project, documents } };
    }
    default:
      return part;
  }
}
