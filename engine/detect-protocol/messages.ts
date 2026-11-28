// The messages between the engine core and the detection worker (docs/designs/auto-mode.md,
// Technical Plan, section 3). A page goes as its characters only: no boxes.
import type { Brand } from "../model/brand";
import type { PackId } from "../model/detection";
import type { Hit } from "../model/findings";
import type { PageIndex } from "../model/geometry";

/** Numbers each run the core starts, starting at 1. Every message names its run, so a reply of an earlier run is ignored. */
export type RunNumber = Brand<number, "RunNumber">;

export const isRunNumber = (value: unknown): value is RunNumber =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

export type DetectRequest =
  | { readonly type: "load"; readonly run: RunNumber; readonly packs: readonly PackId[] }
  | { readonly type: "page"; readonly run: RunNumber; readonly page: PageIndex; readonly chars: readonly string[] };

export interface LoadedPack {
  readonly id: PackId;
  readonly version: string;
}

export type DetectReply =
  | { readonly type: "ready"; readonly run: RunNumber; readonly packs: readonly LoadedPack[] }
  /** `errors`: how many values on the page met an error in a check. */
  | { readonly type: "hits"; readonly run: RunNumber; readonly page: PageIndex; readonly hits: readonly Hit[]; readonly errors: number }
  /** The packs could not be loaded. */
  | { readonly type: "failed"; readonly run: RunNumber; readonly code: "recognizer-failed" };
