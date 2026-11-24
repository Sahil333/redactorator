import type { Session } from "../engine/api/facade";
import type { SessionState } from "../engine/api/state";
import type { Interim } from "../engine/host-browser/interim";
import type { ProjectDocument } from "../engine/model/project";

/**
 * The open project for the hook that still changes it itself, until step 6d: the Session holds
 * it, saves it and keeps its undo history; this hook lands the documents it adds.
 */
export function useProject(session: Session, opened: SessionState, interim: Pick<Interim, "addDocuments">) {
  return {
    folder: opened.folder,
    project: opened.project,
    addDocuments: (documents: readonly ProjectDocument[]) => interim.addDocuments(session, documents),
  };
}
