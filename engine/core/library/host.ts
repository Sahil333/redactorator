import type { IncomingFile } from "../../api/facade";
import type { EngineState } from "../../api/state";
import type { Intake } from "../intake";
import type { LockPort } from "../ports";
import type { OpenSession } from "../session/facade";
import type { LibraryChange } from "./changes";
import type { LibraryParts } from "./slices";

/** What the Library's gate and effects read. */
export interface LibraryView {
  readonly library: LibraryParts;
  readonly worker: EngineState["worker"];
  readonly session: OpenSession | undefined;
}

/** What the engine root gives the Library: its part of the state, the root dispatcher, the lock, and intake over the PDF worker. */
export interface LibraryHost {
  state(): LibraryView;
  dispatch(change: LibraryChange, ...effects: (() => void)[]): void;
  readonly lock: LockPort;
  intake(files: readonly IncomingFile[]): Promise<Intake>;
}
