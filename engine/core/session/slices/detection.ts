import type { DocumentDetection } from "../../../api/state";
import type { DocumentId } from "../../../model/project";
import type { SessionChange } from "../changes";

/** Per document with a run under way or a notice about its last run that is not stored: the run, and the notice. */
export type DetectionPart = ReadonlyMap<DocumentId, Pick<DocumentDetection, "run" | "notice">>;

export const firstDetection: DetectionPart = new Map();

/** Runs of Auto mode: the page each is on, counted from 1, and the notice a run with nothing to offer leaves. A new run clears the notice. */
export function detection(part: DetectionPart, change: SessionChange): DetectionPart {
  switch (change.type) {
    case "runStarted":
      return new Map(part).set(change.document, { run: { state: "running", page: 1, pages: change.pages } });
    case "pageSearched": {
      const { run } = part.get(change.document) ?? {};
      if (run?.state !== "running") return part;
      // Pages are searched one at a time, in order: the next is being searched now.
      return new Map(part).set(change.document, { run: { ...run, page: Math.min(change.page + 2, run.pages) } });
    }
    case "runEnded": {
      if (!part.has(change.document)) return part;
      const next = new Map(part);
      next.delete(change.document);
      return next;
    }
    case "noticeSet":
      return new Map(part).set(change.document, { run: part.get(change.document)?.run ?? { state: "idle" }, notice: change.notice });
    default:
      return part;
  }
}
