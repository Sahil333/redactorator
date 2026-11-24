import type { DocumentId, Settings } from "../model/project";
import type { Store } from "../storage/store";
import type { Refusal, Result } from "./errors";
import type { EngineState } from "./state";

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
  /** Each document's own undo and redo; changing nothing when there is nothing to go back to. */
  readonly history: {
    undo(document: DocumentId): Result<void>;
    redo(document: DocumentId): Result<void>;
  };
  readonly documents: {
    /** The document's cleaned file was downloaded. */
    markDownloaded(document: DocumentId): Result<void>;
  };
  /** Saves now. Resolves once every change so far is written: true if they all landed. */
  flush(): Promise<boolean>;
  /** Saves every change, then lets the project go and lists the projects again; stays open, with `save-failed`, when the save fails. */
  close(): Promise<Result<void>>;
}

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
