import type { SessionState } from "../../../api/state";
import type { SessionChange } from "../changes";

export interface OperationPart {
  readonly save: SessionState["save"];
  /** While the Session closes, it takes no more commands. */
  readonly closing: boolean;
}

export const firstOperation: OperationPart = { save: "saved", closing: false };

/** Whether the project is saved, and whether the Session is closing. */
export function operation(part: OperationPart, change: SessionChange): OperationPart {
  switch (change.type) {
    // Each change to the project record is saved as it is made.
    case "replaced":
    case "undo":
    case "redo":
    case "approved":
    case "documentsAdded":
    case "downloaded":
      return part.save === "saving" ? part : { ...part, save: "saving" };
    case "saved":
      return part.save === "saved" ? part : { ...part, save: "saved" };
    case "saveFailed":
      return { ...part, save: "failed" };
    case "closeStarted":
    case "closeFailed":
      return { ...part, closing: change.type === "closeStarted" };
    default:
      return part;
  }
}
