import type { Engine, Session } from "../engine/api/facade";
import type { SessionState } from "../engine/api/state";
import type { Interim } from "../engine/host-browser/interim";
import type { ProjectDocument } from "../engine/model/project";
import type { Approval } from "../engine/model/spread";

/**
 * The open project for the hooks that still change it themselves, until step 6d: the Session
 * holds it, saves it and keeps its undo history; this hook lands their changes in it.
 */
export function useProject(engine: Engine, session: Session, opened: SessionState, interim: Pick<Interim, "approve" | "addDocuments">) {
  /** The project with every change so far, for work that outlasts a render. */
  const current = () => (engine.session() === session ? engine.getState().session?.project : undefined) ?? opened.project;

  return {
    folder: opened.folder,
    project: opened.project,
    current,
    approve: (approval: Approval) => interim.approve(session, approval),
    addDocuments: (documents: readonly ProjectDocument[]) => interim.addDocuments(session, documents),
  };
}
