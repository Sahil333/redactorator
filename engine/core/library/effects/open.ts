import type { EngineError, Result } from "../../../api/errors";
import type { Session } from "../../../api/facade";
import type { Store } from "../../../storage/store";
import { openSession } from "../../session/facade";
import { readProject } from "../../stored/projects";
import type { LibraryHost } from "../host";
import { readFailed, refresh } from "./refresh";

function raised(host: LibraryHost, error: EngineError): Result<never> {
  host.dispatch({ type: "problemRaised", error });
  return { ok: false, error };
}

/**
 * Locks a listed project and reads it again, since another tab may have changed or deleted it
 * since; the Session holds the lock until it closes.
 */
export async function openProject(host: LibraryHost, listed: { readonly folder: string; readonly id: string; readonly name: string }, store: Store): Promise<Result<Session>> {
  const hold = await host.lock.acquire(listed.id);
  if (hold === undefined) return raised(host, { code: "open-elsewhere", data: { name: listed.name, doing: "open it" } });
  let current: Awaited<ReturnType<typeof readProject>>;
  try {
    current = await readProject(store, listed.folder);
  } catch {
    hold.release();
    return raised(host, readFailed);
  }
  // While this one was read, projects began to move into another store, where it would be left
  // behind, or another project opened, whose lock would never be let go once this one replaced it.
  const { library, session } = host.state();
  if (library.place.store !== store || session !== undefined) {
    hold.release();
    return { ok: false, error: { code: library.place.store === store ? "session-open" : "busy-moving" } };
  }
  if (current !== undefined && "project" in current && current.project.id === listed.id) {
    const opened = openSession({ store, folder: listed.folder, project: current.project }, hold, async () => {
      host.dispatch({ type: "closed" });
      await refresh(host);
    });
    host.dispatch({ type: "opened", session: opened });
    return { ok: true, value: opened.session };
  }
  hold.release();
  const gone = raised(host, { code: "project-gone", data: { name: listed.name } });
  await refresh(host);
  return gone;
}
