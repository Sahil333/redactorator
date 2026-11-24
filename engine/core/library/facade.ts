import type { Result } from "../../api/errors";
import type { Library } from "../../api/facade";
import type { LibraryState } from "../../api/state";
import type { Settings } from "../../model/project";
import type { Store } from "../../storage/store";
import { readProject } from "../stored/projects";
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
  const refused = (command: Parameters<typeof gate>[1]): Result<never> | undefined => {
    const code = gate(host.state(), command);
    return code === undefined ? undefined : { ok: false, error: { code } };
  };

  function changeSettings(settings: Settings) {
    host.dispatch({ type: "settingsChanged", settings }, write(settings));
  }

  const library: Library = {
    projects: {
      refresh: () => refresh(host),
      async open(projectId) {
        const refusal = refused("open");
        if (refusal !== undefined) return refusal;
        const { list, place } = host.state().library;
        const listed = list.projects?.find((entry) => "id" in entry && entry.id === projectId);
        if (listed === undefined || !("id" in listed) || place.store === undefined) return { ok: false, error: { code: "unknown-project" } };
        return openProject(host, listed, place.store);
      },
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
