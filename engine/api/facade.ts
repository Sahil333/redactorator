import type { PageText, Pixels, PlacedImage, Source } from "../model/document";
import type { Profile } from "../model/detection";
import type { Box, PageIndex } from "../model/geometry";
import type { DocumentFacts, GroundTruth } from "../model/groundTruth";
import type { MarkType } from "../model/markTypes";
import type { DocumentId, Settings } from "../model/project";
import type { TextPieceRange } from "../model/selection";
import type { Store } from "../storage/store";
import type { Refusal, Result } from "./errors";
import type { ApprovalPlan, DocumentHandle, EngineState } from "./state";

/** The one object the app, or a script, uses: commands by role, and the state. */
export interface Engine {
  getState(): EngineState;
  /** Calls `listener` after each change; returns the function that stops it. */
  subscribe(listener: () => void): () => void;
  readonly library: Library;
  /** The open Session, if any. */
  session(): Session | undefined;
}

export interface Library {
  readonly projects: {
    refresh(): Promise<Result<void>>;
    /** Makes a project of the files that can be added, named after the first, and opens it; no Session when none could be. */
    create(files: readonly IncomingFile[]): Promise<Result<{ readonly session?: Session; readonly refused: readonly Refusal[] }>>;
    /** Locks the project and reads it again, since another tab may have changed it since it was listed. */
    open(projectId: string): Promise<Result<Session>>;
    // Each locks the project and reads it again, so it changes the project as it is stored now.
    rename(projectId: string, name: string): Promise<Result<void>>;
    duplicate(projectId: string): Promise<Result<void>>;
    archive(projectId: string, archived: boolean): Promise<Result<void>>;
    remove(projectId: string): Promise<Result<void>>;
  };
  readonly folders: {
    /** A folder the user picked to keep projects in, before moving into it: "one-project" when it is itself one project's folder. */
    check(store: Store): Promise<Result<"usable" | "one-project">>;
    /**
     * Makes `store` the place projects live. With `adoptFrom`, moves its projects and settings in
     * first; returns the names left behind, being open in another tab.
     */
    switchTo(store: Store, options: { readonly name: string; readonly adoptFrom?: Store }): Promise<Result<{ readonly leftBehind: readonly string[] }>>;
    /** Copies in one project's folder, say one from another computer. Projects stay where they live. */
    importFrom(store: Store): Promise<Result<void>>;
  };
  readonly settings: {
    update(change: SettingsChange): Result<void>;
  };
}

/** One open, locked project. */
export interface Session {
  readonly projectId: string;
  /** Each changes the project before it returns. */
  readonly marks: {
    /** Refused with `stale-handle` once `handle` is no longer the open document's. */
    add(input: { readonly handle: DocumentHandle; readonly type: MarkType; readonly target: TargetInput }): Result<{ readonly markId: number }>;
    /** Retypes every mark of the value, since a value has one type. */
    retype(document: DocumentId, markId: number, type: MarkType): Result<void>;
    /** Stops hiding the mark's value here, every place of it. */
    remove(document: DocumentId, markId: number): Result<void>;
    /** "Don't hide here": keeps a value hidden across the project visible in this document only. */
    keepHere(document: DocumentId, markId: number): Result<void>;
  };
  /** Each document's own undo and redo; changing nothing when there is nothing to go back to. */
  readonly history: {
    undo(document: DocumentId): Result<void>;
    redo(document: DocumentId): Result<void>;
  };
  /** Approving a document: its values become hidden in the whole project, and spread to the other documents. */
  readonly approval: {
    /**
     * Works out what approving `document` spreads. It lands at once when it changes nothing beyond
     * the document's review state; otherwise the plan waits, in the state, for `confirm` or `cancel`.
     */
    plan(document: DocumentId): Promise<Result<{ readonly landed: true } | { readonly landed: false; readonly plan: ApprovalPlan }>>;
    confirm(planId: number): Promise<Result<void>>;
    cancel(planId: number): Result<void>;
  };
  readonly documents: {
    /** Adds the files that can be added, with the project's hidden values spread into them; the rest are refused. */
    add(files: readonly IncomingFile[]): Promise<Result<{ readonly added: readonly DocumentId[]; readonly refused: readonly Refusal[] }>>;
    /** The document's cleaned file was downloaded. */
    markDownloaded(document: DocumentId): Result<void>;
  };
  /** The open document. Results never enter the state. */
  readonly viewer: {
    /** Opens `document` in the PDF worker, in place of the one open before. */
    open(document: DocumentId): Promise<Result<DocumentHandle>>;
    render(handle: DocumentHandle, source: Source, page: PageIndex, scale: number): Promise<Result<Pixels>>;
    /** Fetched once per page; `marks.add` needs the text of each page a mark is on. */
    pageText(handle: DocumentHandle, page: PageIndex): Promise<Result<PageText>>;
    /** The document's images a box can spread over; undefined when they can't be known. */
    images(document: DocumentId): Promise<Result<readonly PlacedImage[] | undefined>>;
  };
  readonly output: {
    /** Writes and checks the open document's cleaned file, from its marks and the current appearance. */
    apply(): Promise<Result<void>>;
    /** The valid output's bytes, for Download. */
    bytes(): Result<Uint8Array<ArrayBuffer>>;
    /** Back to editing. */
    discard(): Result<void>;
  };
  /** Auto mode's run on one document; one run at a time in a project. */
  readonly detection: {
    /** Starts a run, once the document's stored page texts are read; `profile` replaces the project's for this run only. */
    run(document: DocumentId, profile?: Profile): Promise<Result<void>>;
    /** Ends the run; the pages already searched keep their hits. */
    stop(document: DocumentId): Result<void>;
  };
  /** A document's open findings review; a finding is named by its key. */
  readonly findings: {
    setTicked(document: DocumentId, key: string, ticked: boolean): Result<void>;
    /** Picks another candidate, by its index: another identifier for the same span. */
    choose(document: DocumentId, key: string, candidate: number): Result<void>;
    /** Moves the finding's edges to the range shown at one place; the engine applies them at every place. */
    setEdges(document: DocumentId, key: string, page: PageIndex, start: number, end: number): Result<void>;
    /** Makes the marks and the rejected values, and ends the findings review. The app asks first. */
    confirm(document: DocumentId): Promise<Result<{ readonly values: number; readonly marks: number }>>;
    /** Ends the findings review and keeps nothing. The app asks first. */
    close(document: DocumentId): Promise<Result<void>>;
    /** Removes the document's stored notice. */
    dismissNotice(document: DocumentId): Result<void>;
  };
  /** What Auto mode looks for in the project. Not undone; no document goes back to review. */
  readonly profile: { set(profile: Profile): Result<void> };
  readonly labelling: {
    /** Not undoable. */
    link(document: DocumentId, markId: number, linkId: string): Result<void>;
    exportGroundTruth(document: DocumentId, facts: DocumentFacts): Result<GroundTruth>;
  };
  /** Saves now. Resolves once every change so far is written: true if they all landed. */
  flush(): Promise<boolean>;
  /** Saves every change, then lets the project go and lists the projects again; stays open, with `save-failed`, when the save fails. */
  close(): Promise<Result<void>>;
}

/** What a new mark covers: the text of the selection's pieces, from `selectionPieces`, or a drawn box. */
export type TargetInput =
  | { readonly kind: "text"; readonly pieces: readonly TextPieceRange[] }
  | { readonly kind: "box"; readonly page: PageIndex; readonly box: Box };

/** The settings the user edits directly. */
export type SettingsChange = Partial<Pick<Settings, "appearance">>;

/** A file the user chose: the app wraps a browser File, a script a path. */
export interface IncomingFile {
  readonly name: string;
  /** Where it sits in a chosen folder; files are taken in this order. */
  readonly path: string;
  /** Its media type, which may be empty. */
  readonly type: string;
  /** Called only for PDFs, one at a time, in order. */
  read(): Promise<Uint8Array<ArrayBuffer>>;
}
