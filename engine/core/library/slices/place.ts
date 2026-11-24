import type { LibraryState } from "../../../api/state";
import type { Store } from "../../../storage/store";
import type { LibraryChange } from "../changes";

export interface PlacePart {
  /** Where projects live; undefined while there is none, as when the remembered folder waits for permission. */
  readonly store: Store | undefined;
  readonly place: LibraryState["place"];
  readonly phase: LibraryState["phase"];
}

export const noPlace: PlacePart = { store: undefined, place: { kind: "none" }, phase: "none" };

export function place(part: PlacePart, change: LibraryChange): PlacePart {
  switch (change.type) {
    case "storeChanged":
      return { store: change.store, place: change.place, phase: change.phase };
    case "moveStarted":
      return { ...part, phase: "moving" };
    case "storeLoaded":
    case "storeLoadFailed":
      return { ...part, phase: "ready" };
    default:
      return part;
  }
}
