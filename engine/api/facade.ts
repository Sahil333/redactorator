import type { Settings } from "../model/project";
import type { Store } from "../storage/store";
import type { Result } from "./errors";
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
    /** Locks the project and reads it again, since another tab may have changed it since it was listed. */
    open(projectId: string): Promise<Result<Session>>;
  };
  readonly folders: {
    /** A folder the user picked to keep projects in, before moving into it: "one-project" when it is itself one project's folder. */
    check(store: Store): Promise<Result<"usable" | "one-project">>;
    /**
     * Makes `store` the place projects live. With `adoptFrom`, moves its projects and settings in
     * first; returns the names left behind, being open in another tab.
     */
    switchTo(store: Store, options: { readonly name: string; readonly adoptFrom?: Store }): Promise<Result<{ readonly leftBehind: readonly string[] }>>;
  };
  readonly settings: {
    update(change: SettingsChange): Result<void>;
  };
}

/** One open, locked project. */
export interface Session {
  readonly projectId: string;
  /** Lets the project go and lists the projects again. */
  close(): Promise<Result<void>>;
}

/** The settings the user edits directly. */
export type SettingsChange = Partial<Pick<Settings, "appearance">>;
