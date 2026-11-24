import type { Problem } from "../api/state";
import type { LibraryChange } from "./library/changes";

/**
 * The problems that outlive the command that caused them. A store load replaces them with its own,
 * and a project that opens clears them; the app shows the newest.
 */
export function problems(current: readonly Problem[], change: LibraryChange, revision: number): readonly Problem[] {
  switch (change.type) {
    case "storeLoaded":
      return change.problems.map((error) => ({ error, raisedAt: revision }));
    case "storeLoadFailed":
      return [{ error: { code: "projects-read-failed" }, raisedAt: revision }];
    case "problemRaised":
      return [...current, { error: change.error, raisedAt: revision }];
    case "opened":
      return [];
    default:
      return current;
  }
}
