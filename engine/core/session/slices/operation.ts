import type { SessionState } from "../../../api/state";
import type { SessionChange } from "../changes";

export interface OperationPart {
  readonly operation: SessionState["operation"];
  readonly save: SessionState["save"];
  /** While the Session closes, it takes no more commands. */
  readonly closing: boolean;
}

export const firstOperation: OperationPart = { operation: "idle", save: "saved", closing: false };

/** The records that change the project record: each is saved as it is made. */
const changesRecord = new Set<SessionChange["type"]>([
  "markAdded",
  "markRetyped",
  "markRemoved",
  "keptHere",
  "linked",
  "undo",
  "redo",
  "approved",
  "documentsAdded",
  "downloaded",
  "reanchored",
  "findingsApplied",
  "profileSet",
]);

/** What the Session does after each record that starts or ends an operation. */
const operationAfter: Partial<Record<SessionChange["type"], SessionState["operation"]>> = {
  addStarted: "adding",
  documentsAdded: "idle",
  addFailed: "idle",
  planning: "planning",
  planned: "confirming",
  approved: "idle",
  approvalFailed: "idle",
  approvalCancelled: "idle",
  applyStarted: "applying",
  applied: "idle",
  applyFailed: "idle",
  updateStarted: "updating",
  updateFinished: "idle",
  findingsApplying: "marking",
  findingsApplied: "idle",
  findingsNotApplied: "idle",
};

function saveAfter(save: SessionState["save"], change: SessionChange): SessionState["save"] {
  if (changesRecord.has(change.type)) return "saving";
  if (change.type === "saved") return "saved";
  return change.type === "saveFailed" ? "failed" : save;
}

function closingAfter(closing: boolean, change: SessionChange): boolean {
  if (change.type === "closeStarted") return true;
  return change.type === "closeFailed" ? false : closing;
}

/** What the Session is doing, whether the project is saved, and whether the Session is closing. */
export function operation(part: OperationPart, change: SessionChange): OperationPart {
  const next: OperationPart = {
    operation: operationAfter[change.type] ?? part.operation,
    save: saveAfter(part.save, change),
    closing: closingAfter(part.closing, change),
  };
  return next.operation === part.operation && next.save === part.save && next.closing === part.closing ? part : next;
}
