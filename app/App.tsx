import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Home } from "./Home";
import { prepareFiles, type Refusal } from "./importFiles";
import { createProject, duplicateProject, nameFromFile, saveProject, type ProjectEntries, type StoredProject } from "./projects";
import { ProjectView, type ProjectHandle } from "./ProjectView";
import { engineStatus, useEngine } from "./useEngine";
import { keepStorage, useProjectStore } from "./useProjectStore";

// Labelling mode, for building the evaluation dataset: open the app with ?label.
const labelling = new URLSearchParams(window.location.search).has("label");


// The open project is in the address, so Back and Forward move between it and the projects.
const PROJECT_HASH = "#project=";
/** The project id the address names, "" for an address that names one badly, or undefined for none. */
function projectInAddress(): string | undefined {
  if (!location.hash.startsWith(PROJECT_HASH)) return undefined;
  try {
    return decodeURIComponent(location.hash.slice(PROJECT_HASH.length));
  } catch {
    return "";
  }
}
const projectAddress = (id: string) => `${location.pathname}${location.search}${PROJECT_HASH}${encodeURIComponent(id)}`;
const homeAddress = () => `${location.pathname}${location.search}`;

/** How opening or leaving a project changes the browser's history. */
type Navigation = "push" | "replace" | "none";

function navigate(how: Navigation, address: string) {
  if (how === "push") history.pushState(null, "", address);
  if (how === "replace") history.replaceState(null, "", address);
}

/** Runs `onChange` when the user moves through history with Back or Forward. */
function useHistoryMoves(onChange: () => void) {
  const changed = useEffectEvent(onChange);
  useEffect(() => {
    const listener = () => changed();
    addEventListener("popstate", listener);
    return () => removeEventListener("popstate", listener);
  }, []);
}

interface OpenProject {
  readonly stored: StoredProject;
  readonly release: () => void;
  /** Files chosen with the ones that made a new project, which could not be added. */
  readonly refused: readonly Refusal[];
}

export function App() {
  const engine = useEngine();
  const projectStore = useProjectStore((listed) => void openFromAddress(listed));
  const { store, projects, settings, problem, refresh, whileLocked } = projectStore;
  const [open, setOpen] = useState<OpenProject | undefined>(undefined);
  const [refused, setRefused] = useState<readonly Refusal[]>([]);
  const [adding, setAdding] = useState(false);
  const projectRef = useRef<ProjectHandle>(null);

  async function openProject(stored: StoredProject, how: Navigation, notAdded: readonly Refusal[] = []) {
    const taken = await projectStore.take(stored, "open it");
    if (taken === undefined) {
      if (how === "none") navigate("replace", homeAddress());
      return;
    }
    setRefused([]);
    setOpen({ stored: taken.current, release: taken.release, refused: notAdded });
    navigate(how, projectAddress(stored.project.id));
  }

  /** Opens the project the address names, if it is one of `listed`; otherwise the address goes back to the projects. */
  async function openFromAddress(listed: ProjectEntries) {
    const id = projectInAddress();
    if (id === undefined) return;
    const stored = listed.find((entry) => "project" in entry && entry.project.id === id);
    if (stored !== undefined && "project" in stored) await openProject(stored, "none");
    else navigate("replace", homeAddress());
  }

  /** False, and the project stays open, when its changes could not be saved. */
  async function leaveProject(how: Navigation): Promise<boolean> {
    if (open === undefined) return true;
    if (!((await projectRef.current?.save()) ?? true)) return false;
    open.release();
    setOpen(undefined);
    navigate(how, homeAddress());
    await refresh();
    return true;
  }

  /** Back or Forward: leave the open project if the address no longer names it, then open the one it names. */
  async function followAddress() {
    if (open !== undefined && projectInAddress() === open.stored.project.id) return;
    if (open !== undefined && !(await leaveProject("none"))) {
      navigate("push", projectAddress(open.stored.project.id));
      return;
    }
    if (projects !== undefined) await openFromAddress(projects);
  }
  useHistoryMoves(() => void followAddress());

  async function startProject(files: readonly File[]) {
    if (store === undefined || adding) return;
    setAdding(true);
    try {
      const prepared = await prepareFiles(files, engine.inspect);
      setRefused(prepared.refused);
      const [first] = prepared.added;
      if (first === undefined) return;
      const stored = await createProject(store, nameFromFile(first.file), prepared.added);
      keepStorage();
      await refresh();
      await openProject(stored, "push", prepared.refused);
    } catch {
      projectStore.failed();
    } finally {
      setAdding(false);
    }
  }

  if (open !== undefined && store !== undefined) {
    return (
      <ProjectView
        key={open.stored.folder}
        ref={projectRef}
        store={store}
        initial={open.stored}
        initialRefused={open.refused}
        engine={engine}
        settings={settings}
        onSettings={projectStore.changeSettings}
        labelling={labelling}
        problem={problem}
        onClose={() => void leaveProject("push")}
      />
    );
  }

  return (
    <Home
      projects={projects}
      canAdd={store !== undefined && engine.state === "ready" && !adding}
      status={engineStatus(engine) ?? ""}
      error={engine.error ?? problem}
      refused={refused}
      onDismissRefused={() => setRefused([])}
      onFiles={(files) => void startProject(files)}
      onOpen={(stored) => void openProject(stored, "push")}
      onRename={(stored, name) => void whileLocked(stored, (from, current) => saveProject(from, { ...current, project: { ...current.project, name } }))}
      onDuplicate={(stored) => void whileLocked(stored, (from, current) => duplicateProject(from, current))}
      onArchive={(stored, archived) =>
        void whileLocked(stored, (from, current) => saveProject(from, { ...current, project: { ...current.project, archived } }))
      }
      onDelete={(stored) => void whileLocked(stored, (from, current) => from.remove(current.folder))}
    />
  );
}
