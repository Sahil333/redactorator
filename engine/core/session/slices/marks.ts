import { markKey } from "../../../model/marks";
import type { DocumentId, Project, ProjectDocument } from "../../../model/project";
import type { EditKind, Edits, SessionChange } from "../changes";

export interface MarksPart {
  /** The project record, as it is saved. */
  readonly project: Project;
  /** Per document, how many changes its marks or kept-visible list have had; none yet is 0. */
  readonly edits: ReadonlyMap<DocumentId, number>;
}

export const firstMarks = (project: Project): MarksPart => ({ project, edits: new Map() });

function withEdits(project: Project, id: DocumentId, { marks, shown }: Edits, kind: EditKind): Project {
  // A value marked again is no longer one the user keeps visible here.
  const keep = shown.filter((key) => !marks.some((mark) => markKey(mark) === key));
  const documents = project.documents.map((document): ProjectDocument => {
    if (document.id !== id) return document;
    if (kind === "label") return { ...document, marks, shown: keep };
    return { ...document, marks, shown: keep, review: "in-review", download: document.download === "none" ? "none" : "changed" };
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
  return withEdits(project, id, { marks: marks.map((mark) => ({ ...mark, linkId: linkIds.get(mark.id) ?? mark.linkId })), shown }, "edit");
}

/** The project record and its documents' edit counters. */
export function marks(part: MarksPart, change: SessionChange): MarksPart {
  switch (change.type) {
    case "replaced":
      return {
        project: withEdits(part.project, change.document, change, change.kind),
        edits: change.kind === "edit" ? counted(part.edits, [change.document]) : part.edits,
      };
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
    case "downloaded": {
      const documents = part.project.documents.map((document): ProjectDocument => (document.id === change.document ? { ...document, download: "downloaded" } : document));
      return { ...part, project: { ...part.project, documents } };
    }
    default:
      return part;
  }
}
