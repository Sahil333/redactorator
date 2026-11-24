import type { ApprovalPlan } from "../../../api/state";
import type { Project } from "../../../model/project";
import type { SessionChange } from "../changes";

/** The approval waiting for its heads-up to be answered. */
export interface ApprovalPart {
  readonly plan: ApprovalPlan;
  /** The project record it was worked out from: it lands only on that record. */
  readonly from: Project;
  /** The project record it makes. */
  readonly project: Project;
}

/** The plan waiting for confirmation; landing, failing or cancelling ends it. */
export function approval(part: ApprovalPart | undefined, change: SessionChange): ApprovalPart | undefined {
  switch (change.type) {
    case "planned":
      return { plan: change.plan, from: change.from, project: change.project };
    case "approved":
    case "approvalFailed":
    case "approvalCancelled":
      return undefined;
    default:
      return part;
  }
}
