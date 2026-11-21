import { useEffect, useEffectEvent, useRef, useState } from "react";
import { defaultSettings, type Settings } from "./project";
import {
  listProjects,
  loadSettings,
  lockProject,
  readProject,
  saveSettings,
  type ProjectEntries,
  type StoredProject,
} from "./projects";
import { privateStore, type Store } from "./storage";

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

async function loadStore() {
  const store = await privateStore();
  const [listed, settings] = await Promise.all([listProjects(store), loadSettings(store)]);
  return { store, listed, settings };
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
  // A newer version's settings are never written over with this version's.
  const [settingsWritable, setSettingsWritable] = useState(true);
  // Settings are written one after another, so the latest change is the one that lands.
  const settingsWrite = useRef<Promise<void>>(Promise.resolve());

  const loaded = useEffectEvent(({ store: opened, listed, settings: stored }: Awaited<ReturnType<typeof loadStore>>) => {
    storeRef.current = opened;
    setStore(opened);
    setProjects(listed);
    if (typeof stored === "string") setProblem(settingsProblem[stored]);
    else setSettings(stored);
    setSettingsWritable(stored !== "newer");
    if (listed.length > 0) keepStorage();
    onLoaded(listed);
  });

  useEffect(() => {
    let live = true;
    loadStore().then(
      (result) => live && loaded(result),
      () => live && setProblem(READ_FAILED),
    );
    return () => {
      live = false;
    };
  }, []);

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

  return { store, projects, settings, problem, refresh, take, whileLocked, changeSettings, failed: () => setProblem(CHANGE_FAILED) };
}
