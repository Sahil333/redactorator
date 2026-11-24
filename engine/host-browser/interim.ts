// What the app's hooks that have not moved into the engine yet take from it, until step 6d.
import type { Session } from "../api/facade";
import type { EngineInterim } from "../core/createEngine";
import type { EditKind, Edits } from "../core/session/changes";
import {
  findOriginal,
  readImages,
  readOriginal,
  readTexts,
  saveImages,
  saveTexts,
  writeOriginals,
} from "../core/stored/projects";
import type { DocumentId, ProjectDocument } from "../model/project";
import type { Approval } from "../model/spread";

export type { Applied, PdfClient, WorkerStatus } from "../core/pdf-client/client";
export type { ClientError } from "../core/pdf-client/errors";
export type { EditKind, Edits } from "../core/session/changes";
export type { StoredProject } from "../core/stored/projects";
export type { Pixels } from "../pdf-protocol/messages";

/** The stored-file functions the app still calls itself. */
const storedFiles = {
  findOriginal,
  readImages,
  readOriginal,
  readTexts,
  saveImages,
  saveTexts,
  writeOriginals,
};

export type StoredFiles = typeof storedFiles;

export interface Interim extends EngineInterim {
  readonly stored: StoredFiles;
  /** Until step 6b: a document's marks and kept-visible list as the app's marking left them. */
  replace(session: Session, document: DocumentId, marks: Edits["marks"], shown: Edits["shown"], kind: EditKind): void;
  /** Until step 6c: an approval the app worked out lands. */
  approve(session: Session, approval: Approval): void;
  /** Until step 6d: documents the app added, with the project's hidden values spread into them. */
  addDocuments(session: Session, documents: readonly ProjectDocument[]): void;
}

// Each lands only in `session`, so a late call from a project already left never lands in the next.
export const interimOf = (core: EngineInterim): Interim => ({
  ...core,
  stored: storedFiles,
  replace: (session, document, marks, shown, kind) => core.opened(session)?.commit({ type: "replaced", document, marks, shown, kind }),
  approve: (session, { project, here, changes }) =>
    core.opened(session)?.commit({ type: "approved", project, changedDocuments: [here, ...changes].map(({ document }) => document) }),
  addDocuments: (session, documents) => core.opened(session)?.commit({ type: "documentsAdded", documents }),
});
