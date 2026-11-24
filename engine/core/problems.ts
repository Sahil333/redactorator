import type { Problem } from "../api/state";
import type { LibraryChange } from "./library/changes";
import type { SessionChange } from "./session/changes";

/**
 * The problems that outlive the command that caused them. A store load replaces them with its own;
 * a project that opens, is taken to be changed, or is imported clears them; a failed approval goes
 * with its project. The app shows the newest.
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
    case "changeStarted":
    case "imported":
      return [];
    case "closed":
      return withoutApprovalFailed(current);
    default:
      return current;
  }
}

const withoutApprovalFailed = (current: readonly Problem[]) =>
  current.some(({ error }) => error.code === "approval-failed") ? current.filter(({ error }) => error.code !== "approval-failed") : current;

/** A failed approval is a problem until the next approval starts, or its project closes. */
export function approvalProblems(current: readonly Problem[], change: SessionChange, revision: number): readonly Problem[] {
  switch (change.type) {
    case "approvalFailed":
      return [...current, { error: { code: "approval-failed" }, raisedAt: revision }];
    case "planning":
      return withoutApprovalFailed(current);
    default:
      return current;
  }
}
