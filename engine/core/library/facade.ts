import type { Result } from "../../api/errors";
import type { Library } from "../../api/facade";
import type { LibraryState } from "../../api/state";
import type { Settings } from "../../model/project";
import type { Store } from "../../storage/store";
import { duplicateProject, readProject, saveProject, type StoredProject } from "../stored/projects";
import { createFrom } from "./effects/create";
import { importInto } from "./effects/import";
import { whileLocked } from "./effects/manage";
import { loadStore } from "./effects/move";
import { openProject } from "./effects/open";
import { readFailed, refresh } from "./effects/refresh";
import { settingsWriter } from "./effects/settings";
import { gate } from "./gate";
import type { LibraryHost } from "./host";

/** Where projects live first: none, Chrome's storage, or a folder that adopts what Chrome's storage still holds. */
export interface FirstStore {
  readonly store?: Store;
  readonly adoptFrom?: Store;
  /** The folder's name, when `store` is a folder the user picked. */
  readonly folderName?: string;
}

/** The project list, settings and the store they live in; opening a project hands its lock to a Session. */
export function createLibrary(host: LibraryHost, first: FirstStore) {
  const write = settingsWriter(host);
  const refused = (command: Parameters<typeof gate>[1], projectId?: string): Result<never> | undefined => {
    const code = gate(host.state(), command, projectId);
    return code === undefined ? undefined : { ok: false, error: { code } };
  };
  const noStore: Result<never> = { ok: false, error: { code: "no-store" } };

  /** The project the list holds under `projectId`, and the store it lives in. */
  function listed(projectId: string) {
    const { list, place } = host.state().library;
    const entry = list.projects?.find((each) => "id" in each && each.id === projectId);
    return entry === undefined || !("id" in entry) || place.store === undefined ? undefined : { entry, store: place.store };
  }

  /** Changes a listed project, as `manage` commands do. */
  async function manage(projectId: string, change: (store: Store, current: StoredProject) => Promise<unknown>): Promise<Result<void>> {
    const refusal = refused("manage", projectId);
    if (refusal !== undefined) return refusal;
    const found = listed(projectId);
    if (found === undefined) return { ok: false, error: { code: "unknown-project" } };
    return whileLocked(host, found.entry, found.store, (current) => change(found.store, current));
  }

  function changeSettings(settings: Settings) {
    host.dispatch({ type: "settingsChanged", settings }, write(settings));
  }

  const library: Library = {
    projects: {
      refresh: () => refresh(host),
      async create(files) {
        const refusal = refused("create");
        if (refusal !== undefined) return refusal;
        const { store } = host.state().library.place;
        if (store === undefined) return noStore;
        return new Promise((resolve) => host.dispatch({ type: "createStarted" }, () => resolve(createFrom(host, files, store))));
      },
      async open(projectId) {
        const refusal = refused("open");
        if (refusal !== undefined) return refusal;
        const found = listed(projectId);
        if (found === undefined) return { ok: false, error: { code: "unknown-project" } };
        return openProject(host, found.entry, found.store);
      },
      rename: (projectId, name) => manage(projectId, (store, current) => saveProject(store, { ...current, project: { ...current.project, name } })),
      duplicate: (projectId) => manage(projectId, duplicateProject),
      archive: (projectId, archived) => manage(projectId, (store, current) => saveProject(store, { ...current, project: { ...current.project, archived } })),
      remove: (projectId) => manage(projectId, (store, current) => store.remove(current.folder)),
    },
    folders: {
      async check(store) {
        const refusal = refused("check");
        if (refusal !== undefined) return refusal;
        try {
          // One project's own folder would hide that project and take the others inside it.
          return { ok: true, value: (await readProject(store, "")) === undefined ? "usable" : "one-project" };
        } catch {
          return { ok: false, error: readFailed };
        }
      },
      async switchTo(store, { name, adoptFrom }) {
        const refusal = refused("switchTo");
        if (refusal !== undefined) return refusal;
        // Moving the projects listed now; otherwise opening the remembered folder again, which may still adopt some.
        const phase = adoptFrom !== undefined && host.state().library.place.place.kind === "browser" ? "moving" : "opening";
        return new Promise((resolve) =>
          host.dispatch({ type: "storeChanged", store, place: { kind: "folder", name }, phase }, () => resolve(loadStore(host, store, adoptFrom, name))),
        );
      },
      async importFrom(from) {
        const refusal = refused("import");
        if (refusal !== undefined) return refusal;
        const { store } = host.state().library.place;
        return store === undefined ? noStore : importInto(host, from, store);
      },
    },
    settings: {
      update(change) {
        const refusal = refused("settings");
        if (refusal !== undefined) return refusal;
        changeSettings({ ...host.state().library.settings.settings, ...change });
        return { ok: true, value: undefined };
      },
    },
  };

  const { store, adoptFrom, folderName } = first;
  if (store !== undefined) {
    const place: LibraryState["place"] = folderName === undefined ? { kind: "browser" } : { kind: "folder", name: folderName };
    host.dispatch({ type: "storeChanged", store, place, phase: "loading" }, () => void loadStore(host, store, adoptFrom, folderName ?? ""));
  }

  return {
    library,
    /** A mark typed with a new custom type adds it to the settings, as the user typed it. */
    addCustomType(name: string) {
      const { settings } = host.state().library.settings;
      if (!settings.customTypes.includes(name)) changeSettings({ ...settings, customTypes: [...settings.customTypes, name] });
    },
  };
}
