import type { DocumentHandle } from "../../../api/state";
import type { OutputTag, SessionChange } from "../changes";

/** The cleaned file of the open document, and what it was written from. */
export interface OutputPart {
  readonly tag: OutputTag;
  readonly bytes: Uint8Array<ArrayBuffer>;
  /** What the state shows of it while it is valid. */
  readonly shown: DocumentHandle;
}

/** The latest cleaned file; another document opening, a new apply or Back to editing drops it. */
export function output(part: OutputPart | undefined, change: SessionChange): OutputPart | undefined {
  switch (change.type) {
    case "applied":
      return { tag: change.tag, bytes: change.bytes, shown: change.shown };
    case "opening":
    case "applyStarted":
    case "outputDiscarded":
      return undefined;
    default:
      return part;
  }
}
