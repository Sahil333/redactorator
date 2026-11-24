import { useState } from "react";
import type { createBrowserEngine } from "../engine/host-browser/createBrowserEngine";
import type { StoredFiles, StoredProject } from "../engine/host-browser/interim";
import { webLocks } from "../engine/host-browser/locks";
import type { Store } from "../engine/storage/store";
import { errorText } from "./errors";
import type { Listed } from "./Home";
import { prepareFiles, type Refusal } from "./importFiles";
import type { PdfEngine } from "./useEngine";
import { keepStorage } from "./useProjectsFolder";

const CHANGE_FAILED = "That change could not be saved. Check that the disk has space, then try again.";

const notImported: Record<NonNullable<Awaited<ReturnType<StoredFiles["importProject"]>>> | "failed", string> = {
  projects:
    "That folder holds projects rather than being one. To keep your projects there, choose it as your projects folder instead. To import one project, pick that project's own folder.",
  missing: "That folder holds no Redactorator project. Choose the folder that holds a project's documents and its .redactorator folder.",
  damaged: "That project's file is damaged, so it can't be imported.",
  newer: "That project was saved by a newer version of Redactorator. Reload the page to get it, then import the project again.",
  failed: "That project could not be copied in. Check that the disk has space, then import it again.",
};

interface HomeChangesProps {
  readonly started: ReturnType<typeof createBrowserEngine> | undefined;
  readonly inspect: PdfEngine["inspect"];
  /** Shows `text` as the app's problem; undefined clears every problem shown. */
  readonly raise: (text: string | undefined) => void;
  readonly open: (projectId: string, notAdded: readonly Refusal[]) => Promise<void>;
  readonly pickProjectToImport: () => Promise<Store | undefined>;
}

/**
 * Making, changing and importing projects on Home, with the stored-file functions in the store
 * projects live in, until the Library takes them in step 5b.
 */
export function useHomeChanges({ started, inspect, raise, open, pickProjectToImport }: HomeChangesProps) {
  const [adding, setAdding] = useState(false);
  // Chosen files that were not added, shown on Home.
  const [refused, setRefused] = useState<readonly Refusal[]>([]);
  const interim = started?.interim;
  const library = started?.engine.library;
  const refresh = () => library?.projects.refresh();

  async function create(files: readonly File[]) {
    const store = interim?.store();
    // Files chosen while the PDF worker starts wait for it to read them.
    if (interim === undefined || store === undefined || started?.engine.getState().library.phase !== "ready" || adding) return;
    setAdding(true);
    try {
      const prepared = await prepareFiles(files, inspect);
      setRefused(prepared.refused);
      const [first] = prepared.added;
      if (first === undefined) return;
      const stored = await interim.stored.createProject(store, interim.stored.nameFromFile(first.file), prepared.added);
      if (started.engine.getState().library.place.kind === "browser") keepStorage();
      await refresh();
      await open(stored.project.id, prepared.refused);
    } catch {
      raise(CHANGE_FAILED);
    } finally {
      setAdding(false);
    }
  }

  /**
   * Runs `change` on a listed project as it is stored now, only while no other tab has it open:
   * it is locked and read again, since another tab may have changed or deleted it. Then lists the
   * projects again.
   */
  async function whileLocked(project: Listed, change: (files: StoredFiles, store: Store, current: StoredProject) => Promise<unknown>) {
    const store = interim?.store();
    if (interim === undefined || store === undefined) return;
    const hold = await webLocks.acquire(project.id);
    if (hold === undefined) {
      raise(errorText({ code: "open-elsewhere", data: { name: project.name, doing: "change it" } }));
      return;
    }
    let current: Awaited<ReturnType<StoredFiles["readProject"]>>;
    try {
      current = await interim.stored.readProject(store, project.folder);
    } catch {
      hold.release();
      raise(errorText({ code: "projects-read-failed" }));
      return;
    }
    if (current === undefined || !("project" in current) || current.project.id !== project.id) {
      hold.release();
      raise(errorText({ code: "project-gone", data: { name: project.name } }));
      await refresh();
      return;
    }
    raise(undefined);
    try {
      await change(interim.stored, store, current);
    } catch {
      raise(CHANGE_FAILED);
    } finally {
      hold.release();
    }
    await refresh();
  }

  /** Asks for a project folder, say one copied from another computer, and copies it in. */
  async function importProject() {
    const into = interim?.store();
    if (interim === undefined || into === undefined) return;
    let why: Awaited<ReturnType<StoredFiles["importProject"]>> | "failed";
    try {
      const from = await pickProjectToImport();
      if (from === undefined) return;
      why = await interim.stored.importProject(from, into);
    } catch {
      why = "failed";
    }
    raise(why && notImported[why]);
    await refresh();
  }

  return {
    adding,
    refused,
    dismissRefused: () => setRefused([]),
    onFiles: (files: readonly File[]) => void create(files),
    onImport: () => void importProject(),
    onRename: (project: Listed, name: string) =>
      void whileLocked(project, (files, store, current) => files.saveProject(store, { ...current, project: { ...current.project, name } })),
    onDuplicate: (project: Listed) => void whileLocked(project, (files, store, current) => files.duplicateProject(store, current)),
    onArchive: (project: Listed, archived: boolean) =>
      void whileLocked(project, (files, store, current) => files.saveProject(store, { ...current, project: { ...current.project, archived } })),
    onDelete: (project: Listed) => void whileLocked(project, (_files, store, current) => store.remove(current.folder)),
  };
}
