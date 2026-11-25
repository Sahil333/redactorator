import type { Refusal, Result } from "../../../api/errors";
import type { IncomingFile, Session } from "../../../api/facade";
import { READER_TAG } from "../../../pdf-protocol/messages";
import type { Store } from "../../../storage/store";
import { createProject, nameFromFile } from "../../stored/projects";
import type { LibraryHost } from "../host";
import { openProject } from "./open";
import { refresh } from "./refresh";

/**
 * Makes a project in `store` of the chosen files that can be added, named after the first, and
 * opens it. Its result has no Session when no file could be added, or the project could not be
 * made or opened; what went wrong then is a problem, and the refusals still come back.
 */
export async function createFrom(host: LibraryHost, files: readonly IncomingFile[], store: Store): Promise<Result<{ readonly session?: Session; readonly refused: readonly Refusal[] }>> {
  let refused: readonly Refusal[] = [];
  try {
    const taken = await host.intake(files);
    refused = taken.refused;
    const [first] = taken.added;
    if (first === undefined) return { ok: true, value: { refused } };
    const { folder, project } = await createProject(store, nameFromFile(first.file), taken.added, READER_TAG);
    await refresh(host);
    const opened = await openProject(host, { folder, id: project.id, name: project.name }, store);
    return { ok: true, value: opened.ok ? { session: opened.value, refused } : { refused } };
  } catch {
    host.dispatch({ type: "problemRaised", error: { code: "change-failed" } });
    return { ok: true, value: { refused } };
  } finally {
    host.dispatch({ type: "createEnded" });
  }
}
