import type { EngineError } from "../../api/errors";
import type { LibraryState, ProjectSummary } from "../../api/state";
import type { Settings } from "../../model/project";
import type { Store } from "../../storage/store";
import type { StoredFileProblem } from "../formats/project";
import type { OpenSession } from "../session/facade";

/** Every change to the Library's part of the state, and to which Session is open. */
export type LibraryChange =
  /** Projects now live in `store`, which is being read, moved into or opened again. */
  | {
      readonly type: "storeChanged";
      readonly store: Store;
      readonly place: LibraryState["place"];
      readonly phase: "loading" | "moving" | "opening";
    }
  /** The store's projects are found to be moving in from the one it adopts. */
  | { readonly type: "moveStarted" }
  /** The store is read: its projects, its settings or why they can't be used, and the problems of moving in. */
  | {
      readonly type: "storeLoaded";
      readonly projects: readonly ProjectSummary[];
      readonly settings: Settings | StoredFileProblem;
      readonly problems: readonly EngineError[];
    }
  | { readonly type: "storeLoadFailed" }
  | { readonly type: "refreshStarted" }
  | { readonly type: "listed"; readonly projects: readonly ProjectSummary[] }
  | { readonly type: "opened"; readonly session: OpenSession }
  | { readonly type: "closed" }
  | { readonly type: "createStarted" }
  | { readonly type: "createEnded" }
  /** A listed project is locked and read again, as it is stored now, to be changed. */
  | { readonly type: "changeStarted" }
  | { readonly type: "imported" }
  | { readonly type: "settingsChanged"; readonly settings: Settings }
  | { readonly type: "problemRaised"; readonly error: EngineError };
