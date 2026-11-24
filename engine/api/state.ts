import type { Project, Settings } from "../model/project";
import type { EngineError } from "./errors";

/** The engine's state: one immutable value, the same object until something changes. */
export interface EngineState {
  /** Rises on every change. */
  readonly revision: number;
  readonly worker: { readonly status: "starting" | "ready" | "applying" | "stopped"; readonly error?: EngineError };
  /** What went wrong and still matters, oldest first. */
  readonly problems: readonly Problem[];
  readonly library: LibraryState;
  /** Set while a project is open. */
  readonly session?: SessionState;
}

export interface Problem {
  readonly error: EngineError;
  /** The revision it was raised at; problems raised together share it. */
  readonly raisedAt: number;
}

export interface LibraryState {
  readonly place: { readonly kind: "none" } | { readonly kind: "browser" } | { readonly kind: "folder"; readonly name: string };
  /**
   * `none`: no store yet (the remembered folder waits for permission, or is missing). `moving`:
   * projects move into a newly chosen folder. `opening`: the remembered folder opens again.
   */
  readonly phase: "none" | "loading" | "ready" | "moving" | "opening";
  /** Undefined until the first list lands. */
  readonly projects?: readonly ProjectSummary[];
  readonly settings: Settings;
  /** Whether files chosen on Home are being made into a project. */
  readonly creating: boolean;
  /** What the Library's gate allows now, for the controls that send each command. */
  readonly can: { readonly create: boolean; readonly open: boolean; readonly manage: boolean; readonly import: boolean };
}

export type ProjectSummary =
  | {
      readonly folder: string;
      readonly id: string;
      readonly name: string;
      readonly archived: boolean;
      readonly marks: number;
      readonly approved: number;
      readonly documents: number;
    }
  | { readonly folder: string; readonly unreadable: "damaged" | "newer" };

export interface SessionState {
  /** The project record, as stored when the project opened. */
  readonly project: Project;
  readonly folder: string;
}
