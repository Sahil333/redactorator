import type { Project } from "../../../model/project";
import type { Store } from "../../../storage/store";
import { saveProject } from "../../stored/projects";
import type { SessionChange } from "../changes";

interface Saving {
  readonly store: Store;
  readonly folder: string;
  /** The project record as it is now; undefined once the Session is closed. */
  latest(): Project | undefined;
  dispatch(change: SessionChange): void;
}

/**
 * Saving one Session's project record. Every change is saved as it is made; changes made while a
 * save is under way are saved together next. A failed save is tried again by the next change or
 * flush.
 */
export function saver({ store, folder, latest, dispatch }: Saving) {
  let unsaved = false;
  // True while a write waits behind the one under way; it will write the latest project.
  let queued = false;
  let writing = Promise.resolve(true);

  /** Saves now. Resolves once every change so far is written: true if they all landed. */
  function flush(): Promise<boolean> {
    if (!unsaved || queued) return writing;
    queued = true;
    // Writes go one after another, so an older project never lands after a newer one.
    writing = writing.then(async () => {
      queued = false;
      unsaved = false;
      const project = latest();
      if (project === undefined) return true;
      try {
        await saveProject(store, { folder, project });
        if (!unsaved) dispatch({ type: "saved" });
        return true;
      } catch {
        unsaved = true;
        dispatch({ type: "saveFailed" });
        return false;
      }
    });
    return writing;
  }

  return {
    flush,
    /** The effect of every change to the project record. */
    changed: () => {
      unsaved = true;
      void flush();
    },
  };
}
