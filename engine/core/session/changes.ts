import type { DocumentId, Project, ProjectDocument } from "../../model/project";

/** What the user changes in a document, and undo and redo take back. */
export type Edits = Pick<ProjectDocument, "marks" | "shown">;

/**
 * How a change to a document is kept. An `edit` alters what an apply would write: it can be
 * undone, and puts the document in review. A `label` is labelling data only.
 */
export type EditKind = "edit" | "label";

/** Every change to the open Session's part of the state. */
export type SessionChange =
  /** Until step 6b: a document's marks and kept-visible list as the app's marking left them. */
  | ({ readonly type: "replaced"; readonly document: DocumentId; readonly kind: EditKind } & Edits)
  | { readonly type: "undo"; readonly document: DocumentId }
  | { readonly type: "redo"; readonly document: DocumentId }
  /** What an undo or redo brings back; history passes it to the slice it wraps. */
  | ({ readonly type: "restored"; readonly document: DocumentId } & Edits)
  /** An approval landed: the project it made, and the documents it changed, the approved one first. */
  | { readonly type: "approved"; readonly project: Project; readonly changedDocuments: readonly DocumentId[] }
  | { readonly type: "documentsAdded"; readonly documents: readonly ProjectDocument[] }
  | { readonly type: "downloaded"; readonly document: DocumentId }
  /** Every change so far is written. */
  | { readonly type: "saved" }
  | { readonly type: "saveFailed" }
  /** Closing began: no more commands are taken. */
  | { readonly type: "closeStarted" }
  /** Closing stopped, as the save failed: the Session stays open. */
  | { readonly type: "closeFailed" };

/** The changes the app's hooks still work out themselves, landed through `interim` until each command moves. */
export type InterimChange = Extract<SessionChange, { readonly type: "replaced" | "approved" | "documentsAdded" }>;
