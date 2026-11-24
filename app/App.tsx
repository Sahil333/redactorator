import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { EngineError, Refusal } from "../engine/api/errors";
import type { Engine, Library, Session } from "../engine/api/facade";
import type { EngineState, ProjectSummary } from "../engine/api/state";
import { createBrowserEngine } from "../engine/host-browser/createBrowserEngine";
import type { Store } from "../engine/storage/store";
import { errorText } from "./errors";
import { Home } from "./Home";
import { incomingFiles } from "./incomingFiles";
import { ProjectView, type ProjectHandle } from "./ProjectView";
import { engineStatus, useEngine } from "./useEngine";
import { useEngineState } from "./useEngineState";
import { useProblem } from "./useProblem";
import { useProjectsFolder } from "./useProjectsFolder";

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

/**
 * Opens the project the address names, once the projects are listed and none are moving into a
 * folder; a project the list doesn't hold sends the address back to the projects. Returns the
 * function that reads the address, which only sets state.
 */
function useAddressedProject(projects: readonly ProjectSummary[] | undefined, ready: boolean, open: (projectId: string) => void) {
  const [waitingFor, setWaitingFor] = useState<string | undefined>(undefined);
  const openWaiting = useEffectEvent((id: string, listed: readonly ProjectSummary[]) => {
    setWaitingFor(undefined);
    if (listed.some((entry) => "id" in entry && entry.id === id)) open(id);
    else navigate("replace", homeAddress());
  });
  useEffect(() => {
    if (waitingFor !== undefined && projects !== undefined && ready) openWaiting(waitingFor, projects);
  }, [waitingFor, projects, ready]);
  return () => {
    const id = projectInAddress();
    if (id !== undefined) setWaitingFor(id);
  };
}

/** The open project the app shows, with the files chosen with the ones that made it, which could not be added. */
interface Shown {
  readonly session: Session;
  readonly carried: readonly Refusal[];
}

/**
 * Opening a project, as a Session, and leaving it, kept in step with the address. `onOpened` runs
 * once a project opens.
 */
function useOpenProject(facade: Engine | undefined, state: EngineState | undefined, onOpened: () => void) {
  const library = state?.library;
  const openFromAddress = useAddressedProject(library?.projects, library?.phase === "ready", (projectId) => void open(projectId, "none"));
  // Set together with what the project takes as it starts, so it never starts without them.
  const [shown, setShown] = useState<Shown | undefined>(undefined);
  const projectRef = useRef<ProjectHandle>(null);
  const session = state?.session !== undefined && facade?.session() === shown?.session ? shown?.session : undefined;

  function show(opened: Session, how: Navigation, carried: readonly Refusal[]) {
    setShown({ session: opened, carried });
    onOpened();
    navigate(how, projectAddress(opened.projectId));
  }

  async function open(projectId: string, how: Navigation) {
    if (facade === undefined) return;
    const result = await facade.library.projects.open(projectId);
    if (result.ok) show(result.value, how, []);
    else if (how === "none") navigate("replace", homeAddress());
  }

  const leaving = useRef<Promise<boolean>>(undefined);

  async function close(opened: Session, how: Navigation): Promise<boolean> {
    await projectRef.current?.settled();
    if (!(await opened.close()).ok) return false;
    navigate(how, homeAddress());
    return true;
  }

  /** False, and the project stays open, when its changes could not be saved. A second leave waits for the one under way. */
  function leave(how: Navigation): Promise<boolean> {
    if (session === undefined) return Promise.resolve(true);
    leaving.current ??= close(session, how).finally(() => (leaving.current = undefined));
    return leaving.current;
  }

  /** Back or Forward: leave the open project if the address no longer names it, then open the one it names. */
  async function followAddress() {
    if (session !== undefined && projectInAddress() === session.projectId) return;
    if (session !== undefined && !(await leave("none"))) {
      navigate("push", projectAddress(session.projectId));
      return;
    }
    openFromAddress();
  }
  useHistoryMoves(() => void followAddress());

  return { session, carried: shown?.carried ?? [], projectRef, openFromAddress, open, show, leave };
}

/** Makes chosen files into a project and opens it; the files that could not be added are listed on Home, or carried into the project. */
async function createProject(library: Library, files: readonly File[], project: ReturnType<typeof useOpenProject>, onRefused: (refused: readonly Refusal[]) => void) {
  const result = await library.projects.create(incomingFiles(files));
  if (!result.ok) return;
  const { session, refused } = result.value;
  if (session === undefined) onRefused(refused);
  else project.show(session, "push", refused);
}

/** Asks for one project's folder, say one copied from another computer, and copies it in. What went wrong is the app's problem. */
async function importProject(library: Library, pick: () => Promise<Store | undefined>, problem: ReturnType<typeof useProblem>) {
  let error: EngineError | undefined;
  try {
    const from = await pick();
    if (from === undefined) return;
    const result = await library.folders.importFrom(from);
    if (!result.ok) error = result.error;
  } catch {
    error = { code: "import-failed" };
  }
  const text = errorText(error);
  if (error === undefined) problem.drop();
  else if (text !== undefined) problem.raise(text);
}

export function App() {
  const [started, setStarted] = useState<ReturnType<typeof createBrowserEngine> | undefined>(undefined);
  const facade = started?.engine;
  const interim = started?.interim;
  const state = useEngineState(facade);
  const library = state?.library;
  const engine = useEngine(interim?.client);
  const problem = useProblem(facade);
  const projectsFolder = useProjectsFolder(
    library,
    (first) => {
      setStarted(createBrowserEngine(first));
      project.openFromAddress();
    },
    (error) => (error === undefined ? problem.drop() : problem.raise(errorText(error))),
  );
  // "Later" on the folder card holds until the next visit.
  const [later, setLater] = useState(false);
  // Chosen files that were not made into a project, shown on Home.
  const [refused, setRefused] = useState<readonly Refusal[]>([]);
  const project = useOpenProject(facade, state, () => {
    problem.drop();
    setRefused([]);
  });
  const opened = project.session && interim?.opened(project.session);

  const withLibrary = (act: (library: Library) => Promise<void>) => () => {
    if (facade !== undefined) void act(facade.library);
  };
  const projects = facade?.library.projects;
  // A change that went through clears the app's own problem too; one that failed has a newer problem of the engine's.
  const changed = (change: Promise<unknown> | undefined) => void change?.then(problem.drop);

  if (opened !== undefined && state?.session !== undefined && started !== undefined) {
    return (
      <ProjectView
        key={opened.folder}
        ref={project.projectRef}
        facade={started.engine}
        session={opened.session}
        opened={state.session}
        interim={started.interim}
        store={opened.store}
        initialRefused={project.carried}
        engine={engine}
        settings={state.library.settings}
        onAppearance={(appearance) => facade?.library.settings.update({ appearance })}
        onCustomType={started.interim.addCustomType}
        labelling={labelling}
        problem={problem.shown(state)}
        onClose={() => void project.leave("push")}
      />
    );
  }

  return (
    <Home
      library={library}
      waiting={projectsFolder.waiting}
      status={engineStatus({ state: state?.worker.status ?? "starting" }) ?? ""}
      error={errorText(engine.error) ?? problem.shown(state)}
      refused={refused}
      onDismissRefused={() => setRefused([])}
      onFiles={(files) => withLibrary((library) => createProject(library, files, project, setRefused))()}
      later={later}
      folder={{
        onChoose: withLibrary(projectsFolder.chooseFolder),
        onReopen: withLibrary(projectsFolder.reopenFolder),
        onLater: () => setLater(true),
        onImport: withLibrary((library) => importProject(library, projectsFolder.pickProjectToImport, problem)),
      }}
      onOpen={(listed) => void project.open(listed.id, "push")}
      onRename={(listed, name) => changed(projects?.rename(listed.id, name))}
      onDuplicate={(listed) => changed(projects?.duplicate(listed.id))}
      onArchive={(listed, archived) => changed(projects?.archive(listed.id, archived))}
      onDelete={(listed) => changed(projects?.remove(listed.id))}
    />
  );
}
