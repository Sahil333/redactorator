import type { EngineError, Result } from "../../../api/errors";
import type { Settings } from "../../../model/project";
import type { Store } from "../../../storage/store";
import type { StoredFileProblem } from "../../formats/project";
import { listProjects, loadSettings, moveProjects } from "../../stored/projects";
import type { LibraryHost } from "../host";
import { readFailed, summaries } from "./refresh";

const settingsProblems = (settings: Settings | StoredFileProblem): EngineError[] =>
  typeof settings === "string" ? [{ code: settings === "damaged" ? "settings-damaged" : "settings-newer" }] : [];

/** Moves every project and the settings from `from` into `into`; the problems say what stayed behind. */
async function moveIn(host: LibraryHost, from: Store, into: Store, name: string) {
  try {
    if ((await listProjects(from)).length > 0) host.dispatch({ type: "moveStarted" });
    const leftBehind = await moveProjects(from, into, host.lock);
    return { leftBehind, problems: leftBehind.map((project): EngineError => ({ code: "left-behind", data: { name: project } })) };
  } catch {
    return { leftBehind: [], problems: [{ code: "not-moved", data: { name } } satisfies EngineError] };
  }
}

/**
 * Reads the store projects now live in, called `name`: first, with `adoptFrom`, moving in the
 * projects still kept there, all of them the first time and later any left behind.
 */
export async function loadStore(host: LibraryHost, store: Store, adoptFrom: Store | undefined, name: string): Promise<Result<{ readonly leftBehind: readonly string[] }>> {
  const moved = adoptFrom === undefined ? { leftBehind: [], problems: [] } : await moveIn(host, adoptFrom, store, name);
  try {
    const [entries, settings] = await Promise.all([listProjects(store), loadSettings(store)]);
    host.dispatch({ type: "storeLoaded", projects: summaries(entries), settings, problems: [...settingsProblems(settings), ...moved.problems] });
    return { ok: true, value: { leftBehind: moved.leftBehind } };
  } catch {
    host.dispatch({ type: "storeLoadFailed" });
    return { ok: false, error: readFailed };
  }
}
