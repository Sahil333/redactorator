import type { ProjectSummary } from "../../../api/state";
import type { LibraryChange } from "../changes";

export interface ListPart {
  /** Undefined until the first list lands. */
  readonly projects: readonly ProjectSummary[] | undefined;
  /** Counts the lists started, so only the newest one's result lands. */
  readonly started: number;
}

export const noList: ListPart = { projects: undefined, started: 0 };

export function list(part: ListPart, change: LibraryChange): ListPart {
  switch (change.type) {
    // A list of the store being left is out of date too.
    case "refreshStarted":
    case "storeChanged":
      return { ...part, started: part.started + 1 };
    case "listed":
    case "storeLoaded":
      return { ...part, projects: change.projects };
    // The list still shown is the store's that was left.
    case "storeLoadFailed":
      return { ...part, projects: undefined };
    default:
      return part;
  }
}
