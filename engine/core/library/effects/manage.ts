import type { Result } from "../../../api/errors";
import { READER_TAG } from "../../../pdf-protocol/messages";
import type { Store } from "../../../storage/store";
import { readProject, type ReadProject } from "../../stored/projects";
import type { LibraryHost } from "../host";
import { raised } from "./open";
import { readFailed, refresh } from "./refresh";

/**
 * Runs `change` on a listed project as it is stored now, only while no other tab has it open: it
 * is locked and read again, since another tab may have changed or deleted it since it was listed.
 * Then lists the projects again.
 */
export async function whileLocked(
  host: LibraryHost,
  listed: { readonly folder: string; readonly id: string; readonly name: string },
  store: Store,
  change: (current: ReadProject) => Promise<unknown>,
): Promise<Result<void>> {
  const hold = await host.lock.acquire(listed.id);
  if (hold === undefined) return raised(host, { code: "open-elsewhere", data: { name: listed.name, doing: "change it" } });
  let current: Awaited<ReturnType<typeof readProject>>;
  try {
    current = await readProject(store, listed.folder, READER_TAG);
  } catch {
    hold.release();
    return raised(host, readFailed);
  }
  if (current === undefined || !("project" in current) || current.project.id !== listed.id) {
    hold.release();
    const gone = raised(host, { code: "project-gone", data: { name: listed.name } });
    await refresh(host);
    return gone;
  }
  host.dispatch({ type: "changeStarted" });
  let result: Result<void> = { ok: true, value: undefined };
  try {
    await change(current);
  } catch {
    result = raised(host, { code: "change-failed" });
  } finally {
    hold.release();
  }
  await refresh(host);
  return result;
}
