import { useRef, useState } from "react";
import { documentReadings, findPlaces } from "./documentReadings";
import type { DocumentId, Project } from "../engine/model/project";
import { approve, changed, keysToFind, type Approval } from "../engine/model/spread";
import type { StoredFiles } from "../engine/host-browser/interim";
import type { Store } from "../engine/storage/store";
import type { PdfEngine } from "./useEngine";
import type { useProject } from "./useProject";

const NOT_APPROVED = "The documents' text could not be read, so nothing was approved. Reload the page and approve again.";

/** An approval worked out and waiting for the user to read the heads-up. */
export interface PendingApproval extends Approval {
  readonly document: DocumentId;
  /** The project it was worked out from. */
  readonly from: Project;
}

/**
 * Approving a document: works out what spreads, then lands it, after a heads-up when it changes
 * anything beyond the document's state.
 */
export function useApproval(files: StoredFiles, store: Store, opened: ReturnType<typeof useProject>, engine: PdfEngine) {
  const [working, setWorking] = useState(false);
  const [asking, setAsking] = useState<PendingApproval | undefined>(undefined);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const underWay = useRef<Promise<void>>(Promise.resolve());

  async function plan(id: DocumentId): Promise<PendingApproval | undefined> {
    const project = opened.current();
    const readings = await documentReadings(files, store, opened.folder, project.documents, engine);
    const searched = [...readings].map(([document, { texts }]) => ({ id: document, texts }));
    const places = await findPlaces(engine, keysToFind(project, id), searched);
    const approval = approve(project, id, readings, places);
    return approval && { ...approval, document: id, from: project };
  }

  async function start(id: DocumentId) {
    setWorking(true);
    setProblem(undefined);
    try {
      const pending = await plan(id);
      if (pending === undefined) return;
      // Landing it would drop what changed in the project while it was worked out.
      if (opened.current() !== pending.from) {
        await start(id);
        return;
      }
      if (pending.changes.length > 0 || changed(pending.here)) setAsking(pending);
      else opened.approve(pending);
    } catch {
      setProblem(NOT_APPROVED);
    } finally {
      setWorking(false);
    }
  }

  return {
    working,
    asking,
    problem,
    start: (id: DocumentId) => {
      underWay.current = start(id);
    },
    confirm: () => {
      setAsking(undefined);
      if (asking === undefined) return;
      // Nothing can change the project while the heads-up is open, but if it did, work it out again.
      if (opened.current() === asking.from) opened.approve(asking);
      else underWay.current = start(asking.document);
    },
    cancel: () => setAsking(undefined),
    /** Resolves once no approval is being worked out, so leaving can't lose one that lands later. */
    settled: () => underWay.current,
  };
}
