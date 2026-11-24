import type { Engine, Session } from "../engine/api/facade";
import type { SessionState } from "../engine/api/state";
import type { EditKind, Edits, Interim } from "../engine/host-browser/interim";
import type { DocumentId, ProjectDocument } from "../engine/model/project";
import type { Approval } from "../engine/model/spread";

/**
 * The open project for the hooks that still change it themselves, until step 6d: the Session
 * holds it, saves it and keeps its undo history; this hook lands their changes in it.
 */
export function useProject(engine: Engine, session: Session, opened: SessionState, interim: Pick<Interim, "replace" | "approve" | "addDocuments">) {
  /** The project with every change so far, for work that outlasts a render. */
  const current = () => (engine.session() === session ? engine.getState().session?.project : undefined) ?? opened.project;

  return {
    folder: opened.folder,
    project: opened.project,
    saveState: opened.save,
    current,
    edit(id: DocumentId, change: (current: Edits) => Edits, kind: EditKind) {
      const document = current().documents.find((each) => each.id === id);
      const { marks, shown } = change({ marks: document?.marks ?? [], shown: document?.shown ?? [] });
      interim.replace(session, id, marks, shown, kind);
    },
    /** Lands an approval in one save. It can't be undone, so it ends the undo history of every document it changed. */
    approve: (approval: Approval) => interim.approve(session, approval),
    downloaded: (id: DocumentId) => void session.documents.markDownloaded(id),
    addDocuments: (documents: readonly ProjectDocument[]) => interim.addDocuments(session, documents),
  };
}
