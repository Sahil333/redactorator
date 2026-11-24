import type { EngineError, Result } from "../../../api/errors";
import type { ProjectSummary } from "../../../api/state";
import { listProjects, type ProjectEntries } from "../../stored/projects";
import type { LibraryHost } from "../host";

export const readFailed: EngineError = { code: "projects-read-failed" };

export const summaries = (entries: ProjectEntries): ProjectSummary[] =>
  entries.map((entry) => {
    if ("problem" in entry) return { folder: entry.folder, unreadable: entry.problem };
    const { folder, project } = entry;
    return {
      folder,
      id: project.id,
      name: project.name,
      archived: project.archived,
      marks: project.documents.reduce((sum, document) => sum + document.marks.length, 0),
      approved: project.documents.filter((document) => document.review === "approved").length,
      documents: project.documents.length,
    };
  });

/** Lists the projects again. Only the newest list lands: one started later may finish first. */
export function refresh(host: LibraryHost): Promise<Result<void>> {
  return new Promise((resolve) => host.dispatch({ type: "refreshStarted" }, () => resolve(listAgain(host))));
}

async function listAgain(host: LibraryHost): Promise<Result<void>> {
  const { list, place } = host.state().library;
  const newest = () => host.state().library.list.started === list.started;
  if (place.store === undefined) return { ok: true, value: undefined };
  try {
    const projects = summaries(await listProjects(place.store));
    if (newest()) host.dispatch({ type: "listed", projects });
    return { ok: true, value: undefined };
  } catch {
    if (newest()) host.dispatch({ type: "problemRaised", error: readFailed });
    return { ok: false, error: readFailed };
  }
}
