import { useEffect, useEffectEvent, useRef, useState } from "react";
import { defaultSettings, type Settings } from "../engine/model/project";
import {
  importProject,
  listProjects,
  loadSettings,
  lockProject,
  moveProjects,
  readProject,
  saveSettings,
  type ProjectEntries,
  type StoredProject,
} from "./projects";
import { pickFolder, rememberedFolder, rememberFolder, stillThere } from "./projectsFolder";
import { directoryStore, privateStore, type Store } from "./storage";

const READ_FAILED = "Your projects could not be read. Reload the page to try again.";
const CHANGE_FAILED = "That change could not be saved. Check that the disk has space, then try again.";

// Projects are kept until the browser is told otherwise; Chrome decides without asking the user.
export const keepStorage = () => void navigator.storage.persist().catch(() => undefined);

const busyElsewhere = (stored: StoredProject, doing: string) =>
  `“${stored.project.name}” is open in another tab. Close it there to ${doing} here.`;

const gone = (stored: StoredProject) =>
  `“${stored.project.name}” has changed or gone since this list was shown, perhaps in another tab. The list is up to date now; try again.`;

const settingsProblem = {
  damaged: "Your settings could not be read, so the defaults are in use. Changing a setting saves new ones.",
  newer: "Your settings were saved by a newer version of Redactorator, so the defaults are in use and changes are not saved. Reload the page to get the newer version.",
} as const;

/** A project this tab holds the lock on, as stored now, and the function that lets the lock go. */
export interface TakenProject {
  readonly current: StoredProject;
  readonly release: () => void;
}

/** Where the projects are kept, as home tells the user. */
export type Whereabouts =
  | { readonly kind: "browser" }
  /** In the picked folder; or, before that, moving the projects into it or opening it again. */
  | { readonly kind: "moving" | "opening" | "folder"; readonly name: string }
  /** Chrome asks again, on a later visit, before the page may use the folder. */
  | { readonly kind: "reopen"; readonly name: string }
  /** The folder was moved, renamed or deleted since it was picked. */
  | { readonly kind: "missing"; readonly name: string };

const leftBehind = (names: readonly string[]) =>
  names.map((name) => `“${name}” is open in another tab, so it stays inside Chrome for now. Close it there, then reload this page to move it.`).join(" ");

const oneProject = (name: string) => `“${name}” is one project's own folder. Choose the folder that holds your projects, or a new empty folder.`;

const NOT_CHOSEN = "That folder could not be used for your projects. Reload the page, then choose it again.";

const notAllowed = (name: string) =>
  `Chrome didn't allow this page to use “${name}”. Allow it in Chrome's settings for this site, then click Reopen again.`;

const notMoved = (name: string) => `Some projects could not be moved into “${name}”, so they stay inside Chrome for now. Reload the page to try again.`;

const notImported: Record<NonNullable<Awaited<ReturnType<typeof importProject>>> | "failed", string> = {
  projects:
    "That folder holds projects rather than being one. To keep your projects there, choose it as your projects folder instead. To import one project, pick that project's own folder.",
  missing: "That folder holds no Redactorator project. Choose the folder that holds a project's documents and its .redactorator folder.",
  damaged: "That project's file is damaged, so it can't be imported.",
  newer: "That project was saved by a newer version of Redactorator. Reload the page to get it, then import the project again.",
  failed: "That project could not be copied in. Check that the disk has space, then import it again.",
};

/** A store that can be used, what is in it, and why some of it could not be moved there. */
interface Loaded {
  readonly where: Whereabouts;
  readonly store: Store;
  readonly listed: ProjectEntries;
  readonly settings: Awaited<ReturnType<typeof loadSettings>>;
  readonly problem: string | undefined;
}

/** The projects' store, as kept in the browser or in the picked `folder`, and what is in it; or why the folder can't be used. */
async function loadStore(folder: FileSystemDirectoryHandle | undefined): Promise<Loaded | { readonly where: Whereabouts; readonly store?: undefined }> {
  if (folder === undefined) {
    const store = await privateStore();
    const [listed, settings] = await Promise.all([listProjects(store), loadSettings(store)]);
    return { store, listed, settings, where: { kind: "browser" }, problem: undefined };
  }
  const { name } = folder;
  if ((await folder.queryPermission({ mode: "readwrite" })) !== "granted") return { where: { kind: "reopen", name } };
  if (!(await stillThere(folder))) return { where: { kind: "missing", name } };
  const store = directoryStore(folder);
  // Projects still inside Chrome move in: all of them the first time, and later any left behind.
  let problem: string | undefined;
  try {
    const left = await moveProjects(await privateStore(), store);
    if (left.length > 0) problem = leftBehind(left);
  } catch {
    problem = notMoved(name);
  }
  const [listed, settings] = await Promise.all([listProjects(store), loadSettings(store)]);
  return { store, listed, settings, where: { kind: "folder", name }, problem };
}

/**
 * The store, the projects in it and the app's settings, and the problem to show when reading or
 * changing them fails. `onLoaded` runs once the projects are first listed.
 */
export function useProjectStore(onLoaded: (listed: ProjectEntries) => void) {
  const [store, setStore] = useState<Store | undefined>(undefined);
  // Read by the functions below, which can run before a render has the store, as when the
  // address names a project to open as soon as the projects are listed.
  const storeRef = useRef<Store | undefined>(undefined);
  const [projects, setProjects] = useState<ProjectEntries | undefined>(undefined);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [where, setWhere] = useState<Whereabouts | undefined>(undefined);
  // The remembered folder, to ask Chrome for again.
  const folderRef = useRef<FileSystemDirectoryHandle | undefined>(undefined);
  // A newer version's settings are never written over with this version's.
  const [settingsWritable, setSettingsWritable] = useState(true);
  // Settings are written one after another, so the latest change is the one that lands.
  const settingsWrite = useRef<Promise<void>>(Promise.resolve());

  function show(result: Awaited<ReturnType<typeof loadStore>>) {
    setWhere(result.where);
    if (result.store === undefined) return;
    const { store: opened, listed, settings: stored } = result;
    storeRef.current = opened;
    setStore(opened);
    setProjects(listed);
    if (typeof stored !== "string") setSettings(stored);
    const problems = [typeof stored === "string" ? settingsProblem[stored] : undefined, result.problem].filter((each) => each !== undefined);
    setProblem(problems.length > 0 ? problems.join(" ") : undefined);
    setSettingsWritable(stored !== "newer");
    // A folder on disk keeps its files whatever the browser does.
    if (listed.length > 0 && result.where.kind === "browser") keepStorage();
    onLoaded(listed);
  }

  const loaded = useEffectEvent(show);

  useEffect(() => {
    let live = true;
    rememberedFolder()
      .then((folder) => {
        folderRef.current = folder;
        return loadStore(folder);
      })
      .then(
        (result) => live && loaded(result),
        () => live && setProblem(READ_FAILED),
      );
    return () => {
      live = false;
    };
  }, []);

  /** Loads the projects from `folder`, once Chrome lets the page use it. */
  async function openFolder(folder: FileSystemDirectoryHandle, kind: "moving" | "opening") {
    folderRef.current = folder;
    setWhere({ kind, name: folder.name });
    try {
      show(await loadStore(folder));
    } catch {
      setProblem(READ_FAILED);
    }
  }

  async function refresh() {
    const from = storeRef.current;
    if (from === undefined) return;
    try {
      setProjects(await listProjects(from));
    } catch {
      setProblem(READ_FAILED);
    }
  }

  /**
   * Locks a project listed earlier and reads it again, since another tab may have changed or
   * deleted it since. Undefined, with the problem shown, when it is open elsewhere or gone.
   */
  async function take(stored: StoredProject, doing: string): Promise<TakenProject | undefined> {
    const from = storeRef.current;
    if (from === undefined) return undefined;
    const release = await lockProject(stored.project.id);
    if (release === undefined) {
      setProblem(busyElsewhere(stored, doing));
      return undefined;
    }
    let current: Awaited<ReturnType<typeof readProject>>;
    try {
      current = await readProject(from, stored.folder);
    } catch {
      release();
      setProblem(READ_FAILED);
      return undefined;
    }
    if (current !== undefined && "project" in current && current.project.id === stored.project.id) {
      setProblem(undefined);
      return { current, release };
    }
    release();
    setProblem(gone(stored));
    await refresh();
    return undefined;
  }

  /** Runs `change` on a project as it is stored now, only while no other tab has it open, then lists the projects again. */
  async function whileLocked(stored: StoredProject, change: (from: Store, current: StoredProject) => Promise<unknown>) {
    const from = storeRef.current;
    const taken = await take(stored, "change it");
    if (from === undefined || taken === undefined) return;
    try {
      await change(from, taken.current);
    } catch {
      setProblem(CHANGE_FAILED);
    } finally {
      taken.release();
    }
    await refresh();
  }

  function changeSettings(next: Settings) {
    setSettings(next);
    const into = storeRef.current;
    if (into === undefined || !settingsWritable) return;
    settingsWrite.current = settingsWrite.current
      .then(() => saveSettings(into, next))
      .catch(() => setProblem("Your settings could not be saved. Check that the disk has space, then change the setting again."));
  }

  return {
    store,
    projects,
    settings,
    problem,
    where,
    refresh,
    take,
    whileLocked,
    changeSettings,
    failed: () => setProblem(CHANGE_FAILED),
    /** Asks for a folder to keep the projects in, remembers it, and moves the projects there. */
    chooseFolder: async () => {
      try {
        const folder = await pickFolder("redactorator-projects", "readwrite");
        if (folder === undefined) return;
        // One project's own folder would hide that project and take the others inside it.
        if ((await readProject(directoryStore(folder), "")) !== undefined) {
          setProblem(oneProject(folder.name));
          return;
        }
        await rememberFolder(folder);
        await openFolder(folder, "moving");
      } catch {
        setProblem(NOT_CHOSEN);
      }
    },
    /** Asks Chrome, on the user's click, to let the page use the remembered folder again. */
    reopenFolder: async () => {
      const folder = folderRef.current;
      if (folder === undefined) return;
      if ((await folder.requestPermission({ mode: "readwrite" })) === "granted") await openFolder(folder, "opening");
      else setProblem(notAllowed(folder.name));
    },
    /** Asks for a project folder, say one copied from another computer, and copies it in. */
    importFromFolder: async () => {
      const into = storeRef.current;
      if (into === undefined) return;
      let why: Awaited<ReturnType<typeof importProject>> | "failed";
      try {
        const folder = await pickFolder("redactorator-import", "read");
        if (folder === undefined) return;
        why = await importProject(directoryStore(folder), into);
      } catch {
        why = "failed";
      }
      setProblem(why && notImported[why]);
      await refresh();
    },
  };
}
