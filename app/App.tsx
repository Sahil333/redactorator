import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { Engine, Library } from "../engine/api/facade";
import type { EngineState, ProjectSummary } from "../engine/api/state";
import { createBrowserEngine } from "../engine/host-browser/createBrowserEngine";
import { errorText } from "./errors";
import { Home } from "./Home";
import type { Refusal } from "./importFiles";
import { ProjectView, type ProjectHandle } from "./ProjectView";
import { engineStatus, useEngine } from "./useEngine";
import { useEngineState } from "./useEngineState";
import { useHomeChanges } from "./useHomeChanges";
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

/**
 * Opening a project, as a Session, and leaving it, kept in step with the address. `onOpened` runs
 * once a project opens.
 */
function useOpenProject(facade: Engine | undefined, state: EngineState | undefined, onOpened: () => void) {
  const library = state?.library;
  const openFromAddress = useAddressedProject(library?.projects, library?.phase === "ready", (projectId) => void open(projectId, "none"));
  // Files chosen with the ones that made a new project, which could not be added.
  const [carried, setCarried] = useState<readonly Refusal[]>([]);
  const projectRef = useRef<ProjectHandle>(null);
  const session = state?.session === undefined ? undefined : facade?.session();

  async function open(projectId: string, how: Navigation, notAdded: readonly Refusal[] = []) {
    if (facade === undefined) return;
    // Set before the project shows, which takes them as it starts.
    setCarried(notAdded);
    const result = await facade.library.projects.open(projectId);
    if (!result.ok) {
      if (how === "none") navigate("replace", homeAddress());
      return;
    }
    onOpened();
    navigate(how, projectAddress(projectId));
  }

  /** False, and the project stays open, when its changes could not be saved. */
  async function leave(how: Navigation): Promise<boolean> {
    if (session === undefined) return true;
    if (!((await projectRef.current?.save()) ?? true)) return false;
    const closing = session.close();
    navigate(how, homeAddress());
    await closing;
    return true;
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

  return { session, carried, projectRef, openFromAddress, open, leave };
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
  const project = useOpenProject(facade, state, () => {
    problem.drop();
    changes.dismissRefused();
  });
  const changes = useHomeChanges({
    started,
    inspect: engine.inspect,
    raise: problem.raise,
    open: (projectId, notAdded) => project.open(projectId, "push", notAdded),
    pickProjectToImport: projectsFolder.pickProjectToImport,
  });
  const opened = project.session && interim?.opened(project.session);

  const withLibrary = (act: (library: Library) => Promise<void>) => () => {
    if (facade !== undefined) void act(facade.library);
  };

  if (opened !== undefined && library !== undefined && interim !== undefined) {
    return (
      <ProjectView
        key={opened.folder}
        ref={project.projectRef}
        files={interim.stored}
        store={opened.store}
        initial={opened}
        initialRefused={project.carried}
        engine={engine}
        settings={library.settings}
        onAppearance={(appearance) => facade?.library.settings.update({ appearance })}
        onCustomType={interim.addCustomType}
        labelling={labelling}
        problem={problem.shown(state)}
        onClose={() => void project.leave("push")}
      />
    );
  }

  return (
    <Home
      library={library}
      adding={changes.adding}
      waiting={projectsFolder.waiting}
      status={engineStatus({ state: state?.worker.status ?? "starting" }) ?? ""}
      error={errorText(engine.error) ?? problem.shown(state)}
      refused={changes.refused}
      onDismissRefused={changes.dismissRefused}
      onFiles={changes.onFiles}
      later={later}
      folder={{
        onChoose: withLibrary(projectsFolder.chooseFolder),
        onReopen: withLibrary(projectsFolder.reopenFolder),
        onLater: () => setLater(true),
        onImport: changes.onImport,
      }}
      onOpen={(listed) => void project.open(listed.id, "push")}
      onRename={changes.onRename}
      onDuplicate={changes.onDuplicate}
      onArchive={changes.onArchive}
      onDelete={changes.onDelete}
    />
  );
}
