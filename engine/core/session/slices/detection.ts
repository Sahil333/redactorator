import type { DocumentDetection } from "../../../api/state";
import type { DocumentId } from "../../../model/project";
import type { SessionChange } from "../changes";

/** Per document with a run under way or a notice about its last run that is not stored: the run, and the notice. */
export type DetectionPart = ReadonlyMap<DocumentId, Pick<DocumentDetection, "run" | "notice">>;

export const firstDetection: DetectionPart = new Map();

/** Runs of Auto mode. No run starts until the detection worker exists, so nothing changes yet. */
export function detection(part: DetectionPart, change: SessionChange): DetectionPart {
  return part;
}
