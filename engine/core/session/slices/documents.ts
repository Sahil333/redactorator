import type { DocumentStatus } from "../../../api/state";
import type { DocumentId } from "../../../model/project";
import type { SessionChange } from "../changes";

export type DocumentsPart = ReadonlyMap<DocumentId, DocumentStatus>;

export const firstDocuments: DocumentsPart = new Map();

/** Per document, once its prepared files are read or made again: what preparing removed, its lost marks, and whether preparing it failed. */
export function documents(part: DocumentsPart, change: SessionChange): DocumentsPart {
  switch (change.type) {
    case "documentPrepared":
      return new Map(part).set(change.document, { removed: change.removed, lost: change.lost });
    case "preparationFailed":
      return new Map(part).set(change.document, { removed: part.get(change.document)?.removed ?? [], lost: part.get(change.document)?.lost ?? [], failed: change.code });
    default:
      return part;
  }
}
