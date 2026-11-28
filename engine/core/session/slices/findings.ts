import type { RunRecord } from "../../../model/detection";
import type { DocumentId } from "../../../model/project";
import type { Finding, FindingChange, Hit } from "../../../model/findings";
import type { PageIndex } from "../../../model/geometry";
import type { SessionChange } from "../changes";

/** A document's open findings review: its run's hits, the user's changes by finding key, and the resolver's findings. */
interface OpenFindings {
  readonly run: string;
  readonly hits: readonly Hit[];
  readonly ended: RunRecord["ended"];
  readonly notSearched: readonly PageIndex[];
  readonly changes: ReadonlyMap<string, FindingChange>;
  readonly findings: readonly Finding[];
}

/** Per document with an open findings review. */
export type FindingsPart = ReadonlyMap<DocumentId, OpenFindings>;

export const firstFindings: FindingsPart = new Map();

/** Findings reviews: opened on a run's hits, changed by the user, resolved again as the document's marks change, and ended when confirmed, closed, or nothing is left to offer. */
export function findings(part: FindingsPart, change: SessionChange): FindingsPart {
  switch (change.type) {
    case "findingsOpened": {
      const { run, hits, ended, notSearched, changes, findings: resolved } = change;
      return new Map(part).set(change.document, { run, hits, ended, notSearched, changes, findings: resolved });
    }
    case "findingChanged": {
      const open = part.get(change.document);
      if (open === undefined) return part;
      const changes = new Map(open.changes).set(change.key, { ...open.changes.get(change.key), ...change.change });
      return new Map(part).set(change.document, { ...open, changes });
    }
    case "findingsResolved": {
      const open = part.get(change.document);
      return open === undefined ? part : new Map(part).set(change.document, { ...open, findings: change.findings });
    }
    case "findingsApplied":
    case "findingsClosed": {
      if (!part.has(change.document)) return part;
      const next = new Map(part);
      next.delete(change.document);
      return next;
    }
    default:
      return part;
  }
}
