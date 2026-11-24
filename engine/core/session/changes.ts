import type { ApprovalPlan, DocumentHandle } from "../../api/state";
import type { Appearance, PageText } from "../../model/document";
import type { PageIndex } from "../../model/geometry";
import type { Mark } from "../../model/marks";
import type { MarkType } from "../../model/markTypes";
import type { DocumentId, Project, ProjectDocument } from "../../model/project";

/** What the user changes in a document, and undo and redo take back. */
export type Edits = Pick<ProjectDocument, "marks" | "shown">;

/** What a cleaned file was written from: its document, that document's edit count then, and the appearance. */
export interface OutputTag {
  readonly document: DocumentId;
  readonly edits: number;
  readonly appearance: Appearance;
}

/** Every change to the open Session's part of the state. */
export type SessionChange =
  | { readonly type: "markAdded"; readonly document: DocumentId; readonly mark: Mark }
  /** Retypes every mark of the item `markId` belongs to, since a value has one type. */
  | { readonly type: "markRetyped"; readonly document: DocumentId; readonly markId: number; readonly markType: MarkType }
  /** Removes every mark of the item `markId` belongs to. */
  | { readonly type: "markRemoved"; readonly document: DocumentId; readonly markId: number }
  /** Keeps the value `key` visible in this document only. */
  | { readonly type: "keptHere"; readonly document: DocumentId; readonly key: string }
  /** Labelling data: not undone, and the document's review is unchanged. */
  | { readonly type: "linked"; readonly document: DocumentId; readonly markId: number; readonly linkId: string }
  | { readonly type: "undo"; readonly document: DocumentId }
  | { readonly type: "redo"; readonly document: DocumentId }
  /** What an undo or redo brings back; history passes it to the slice it wraps. */
  | ({ readonly type: "restored"; readonly document: DocumentId } & Edits)
  /** Approval works out what approving `document` spreads. */
  | { readonly type: "planning"; readonly document: DocumentId }
  /** An approval waits for its heads-up: the record it was worked out from, and the record it would make. */
  | { readonly type: "planned"; readonly plan: ApprovalPlan; readonly from: Project; readonly project: Project }
  /** An approval landed: the project it made, and the documents it changed, the approved one first. */
  | { readonly type: "approved"; readonly project: Project; readonly changedDocuments: readonly DocumentId[] }
  /** Nothing was approved: the readings could not be had or searched, or the record changed since the plan. */
  | { readonly type: "approvalFailed" }
  | { readonly type: "approvalCancelled" }
  /** Chosen files are being added to the project. */
  | { readonly type: "addStarted" }
  /** Documents joined the project, with its hidden values spread into them. */
  | { readonly type: "documentsAdded"; readonly documents: readonly ProjectDocument[] }
  /** No chosen file joined the project. */
  | { readonly type: "addFailed" }
  | { readonly type: "downloaded"; readonly document: DocumentId }
  /** The PDF worker is asked to open `document`: what was open, and its output, are gone. */
  | { readonly type: "opening"; readonly document: DocumentId }
  | { readonly type: "opened"; readonly handle: DocumentHandle }
  | { readonly type: "pageTextLoaded"; readonly handle: DocumentHandle; readonly page: PageIndex; readonly text: PageText }
  | { readonly type: "applyStarted" }
  /** A cleaned file passed the worker's check. */
  | { readonly type: "applied"; readonly tag: OutputTag; readonly bytes: Uint8Array<ArrayBuffer>; readonly shown: DocumentHandle }
  | { readonly type: "applyFailed" }
  | { readonly type: "outputDiscarded" }
  /** Every change so far is written. */
  | { readonly type: "saved" }
  | { readonly type: "saveFailed" }
  /** Closing began: no more commands are taken. */
  | { readonly type: "closeStarted" }
  /** Closing stopped, as the save failed: the Session stays open. */
  | { readonly type: "closeFailed" };
