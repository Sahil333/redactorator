import type { Project } from "../../../model/project";
import { READER_TAG } from "../../../pdf-protocol/messages";
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
 * Saving one Session's project record and its findings files. Every change is saved as it is
 * made; changes made while a save is under way are saved together next. A failed save is tried
 * again by the next change or flush. The project is "saved" only once both are written.
 */
export function saver({ store, folder, latest, dispatch }: Saving) {
  let unsaved = false;
  // True while a write waits behind the one under way; it will write the latest project.
  let queued = false;
  let writing = Promise.resolve(true);
  /**
   * The findings files still to write, by path, with their content, or undefined to remove one;
   * in the order each was last asked for, so a crash leaves the files as they were at some step.
   */
  const files = new Map<string, string | undefined>();

  /** Writes the project record if it changed; false if that failed. */
  async function saveRecord(): Promise<boolean> {
    if (!unsaved) return true;
    unsaved = false;
    const project = latest();
    if (project === undefined) return true;
    try {
      await saveProject(store, { folder, project }, READER_TAG);
      return true;
    } catch {
      unsaved = true;
      return false;
    }
  }

  /** Writes and removes the findings files waiting, one after another; false at the first that failed, which waits with those after it. */
  async function saveFiles(): Promise<boolean> {
    for (const [path, content] of [...files]) {
      try {
        if (content === undefined) await store.remove(path);
        else await store.write(path, content);
      } catch {
        return false;
      }
      // Asked for again while it was written, it stays for the next round.
      if (files.get(path) === content) files.delete(path);
    }
    return true;
  }

  /** Saves now. Resolves once every change so far is written: true if they all landed. */
  function flush(): Promise<boolean> {
    if ((!unsaved && files.size === 0) || queued) return writing;
    queued = true;
    // Writes go one after another, so an older project or file never lands after a newer one.
    writing = writing.then(async () => {
      queued = false;
      const landed = (await saveRecord()) && (await saveFiles());
      if (!landed) dispatch({ type: "saveFailed" });
      else if (!unsaved && files.size === 0) dispatch({ type: "saved" });
      return landed;
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
    /** Writes `content` to the findings file at `path`, or removes it when undefined, after every write asked for so far. */
    file(path: string, content: string | undefined) {
      files.delete(path);
      files.set(path, content);
      dispatch({ type: "filing" });
      void flush();
    },
  };
}
