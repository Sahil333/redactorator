import type { ApprovalPlan, DocumentDetection, DocumentHandle } from "../../api/state";
import type { Profile, RunRecord } from "../../model/detection";
import type { Appearance, PageText, RemovalKind } from "../../model/document";
import type { ReaderErrorCode } from "../../model/errors";
import type { Finding, FindingChange, Hit } from "../../model/findings";
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
  /** `replaces`: the document's lost marks the new mark stands for, which it takes the place of (CUJ 7). */
  | { readonly type: "markAdded"; readonly document: DocumentId; readonly mark: Mark; readonly replaces: readonly Mark["id"][] }
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
  | { readonly type: "closeFailed" }
  /** Documents are being prepared again for this build, one at a time. */
  | { readonly type: "updateStarted" }
  | { readonly type: "updateFinished" }
  /** A document's prepared files are read, or made again: what preparing it removed, and the ids of its marks that could not be placed. */
  | { readonly type: "documentPrepared"; readonly document: DocumentId; readonly removed: readonly RemovalKind[]; readonly lost: readonly number[] }
  /** A document could not be prepared again; its marks are kept, and it is neither opened nor exported. */
  | { readonly type: "preparationFailed"; readonly document: DocumentId; readonly code: ReaderErrorCode }
  /**
   * A document's marks placed again on its text as this build reads it. Not an edit: it is not
   * undone, nor counted. `workingChanged`: its working copy or removed kinds differ from those stored.
   */
  | { readonly type: "reanchored"; readonly document: DocumentId; readonly marks: readonly Mark[]; readonly workingChanged: boolean }
  /** A run of Auto mode began on `document`: `run`, its id; `pages`, how many it searches. */
  | { readonly type: "runStarted"; readonly document: DocumentId; readonly run: string; readonly pages: number }
  /** One page of the run answered. */
  | { readonly type: "pageSearched"; readonly document: DocumentId; readonly page: PageIndex; readonly hits: readonly Hit[]; readonly errors: number }
  /** The run ended, finished, stopped or failed: what it did. */
  | { readonly type: "runEnded"; readonly document: DocumentId; readonly record: RunRecord }
  /** A findings review opened on an ended run's hits, or on those stored, with the user's stored changes by finding key and the resolver's findings. */
  | {
      readonly type: "findingsOpened";
      readonly document: DocumentId;
      readonly run: string;
      readonly hits: readonly Hit[];
      readonly notSearched: readonly PageIndex[];
      readonly changes: ReadonlyMap<string, FindingChange>;
      readonly findings: readonly Finding[];
    }
  /** The user changed the finding `key`. */
  | { readonly type: "findingChanged"; readonly document: DocumentId; readonly key: string; readonly change: FindingChange }
  /** The resolver's findings for the open findings review. */
  | { readonly type: "findingsResolved"; readonly document: DocumentId; readonly findings: readonly Finding[] }
  /** Confirming the findings review began: the operation `marking`. */
  | { readonly type: "findingsApplying"; readonly document: DocumentId }
  /**
   * The confirmed findings review's marks, made for `values` ticked values, the lost marks they
   * take the place of, and the keys of the values the user unticked. With marks it is one edit,
   * and one undo step.
   */
  | {
      readonly type: "findingsApplied";
      readonly document: DocumentId;
      readonly values: number;
      readonly marks: readonly Mark[];
      readonly replaces: readonly Mark["id"][];
      readonly rejected: readonly string[];
    }
  /** Confirming the findings review ended with nothing marked or rejected. */
  | { readonly type: "findingsNotApplied"; readonly document: DocumentId }
  /** The findings review ended without marking: closed, dropped, or every found value marked. */
  | { readonly type: "findingsClosed"; readonly document: DocumentId }
  | { readonly type: "noticeSet"; readonly document: DocumentId; readonly notice: NonNullable<DocumentDetection["notice"]> }
  | { readonly type: "noticeDismissed"; readonly document: DocumentId }
  /** The project's profile. Not an edit: not undone, and no document goes back to review. */
  | { readonly type: "profileSet"; readonly profile: Profile };
