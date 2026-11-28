import type { DocumentId } from "../../../model/project";
import type { Finding, FindingChange, Hit } from "../../../model/findings";
import type { PageIndex } from "../../../model/geometry";
import type { SessionChange } from "../changes";

/** A document's open findings review: its run's hits, the user's changes by finding key, and the resolver's findings. */
interface OpenFindings {
  readonly run: string;
  readonly hits: readonly Hit[];
  readonly notSearched: readonly PageIndex[];
  readonly changes: ReadonlyMap<string, FindingChange>;
  readonly findings: readonly Finding[];
}

/** Per document with an open findings review. */
export type FindingsPart = ReadonlyMap<DocumentId, OpenFindings>;

export const firstFindings: FindingsPart = new Map();

/** Findings reviews. No run ends with hits yet, so none opens. */
export function findings(part: FindingsPart, change: SessionChange): FindingsPart {
  return part;
}
