import type { Engine, IncomingFile, Session } from "../api/facade";
import type { EngineState, Problem } from "../api/state";
import { createDispatcher } from "./dispatcher";
import { intake, type Intake } from "./intake";
import type { LibraryChange } from "./library/changes";
import { createLibrary, type FirstStore } from "./library/facade";
import { can } from "./library/gate";
import { firstLibrary, library, type LibraryParts } from "./library/slices";
import { pdfClient, type PdfClient, type WorkerStatus } from "./pdf-client/client";
import type { LockPort, WorkerChannel } from "./ports";
import { problems } from "./problems";
import type { OpenSession } from "./session/facade";

/** The engine root's state: the published state's parts, with what stays inside. */
interface Root {
  readonly revision: number;
  readonly worker: EngineState["worker"];
  readonly problems: readonly Problem[];
  readonly library: LibraryParts;
  readonly session: OpenSession | undefined;
}

type Change = LibraryChange | { readonly type: "workerChanged"; readonly worker: EngineState["worker"] };

function reduce(root: Root, change: Change): Root {
  const revision = root.revision + 1;
  const next =
    change.type === "workerChanged"
      ? { ...root, worker: change.worker }
      : {
          ...root,
          problems: problems(root.problems, change, revision),
          library: library(root.library, change),
          session: change.type === "opened" ? change.session : change.type === "closed" ? undefined : root.session,
        };
  const same = next.worker === root.worker && next.problems === root.problems && next.library === root.library && next.session === root.session;
  return same ? root : { ...next, revision };
}

function publish(root: Root): EngineState {
  const { list, place, settings } = root.library;
  return {
    revision: root.revision,
    worker: root.worker,
    problems: root.problems,
    library: {
      place: place.place,
      phase: place.phase,
      settings: settings.settings,
      creating: settings.creating,
      can: can(root),
      ...(list.projects === undefined ? {} : { projects: list.projects }),
    },
    ...(root.session === undefined ? {} : { session: { project: root.session.project, folder: root.session.folder } }),
  };
}

const workerOf = ({ state, error }: WorkerStatus): EngineState["worker"] => (error === undefined ? { status: state } : { status: state, error });

/** What the app's hooks that have not moved into the engine yet take from it (engine/host-browser/interim.ts). */
export interface EngineInterim {
  readonly client: PdfClient;
  /** The open Session's store, folder and project as read; undefined for a Session no longer open. */
  opened(session: Session): OpenSession | undefined;
  /** Reads chosen files and has the PDF worker inspect them, for adding them to the open project. */
  intake(files: readonly IncomingFile[]): Promise<Intake>;
  addCustomType(name: string): void;
}

/** Builds the engine root: the PDF-worker client over `worker`, and the Library over the first store. No Session is open. */
export function createEngine(start: FirstStore & { readonly worker: WorkerChannel; readonly lock: LockPort }): { readonly engine: Engine; readonly interim: EngineInterim } {
  const client = pdfClient(start.worker);
  const root: Root = { revision: 0, worker: { status: "starting" }, problems: [], library: firstLibrary, session: undefined };
  const dispatcher = createDispatcher(root, reduce);
  const take = (files: readonly IncomingFile[]) => intake(files, client);
  const { library: facade, addCustomType } = createLibrary({ state: dispatcher.getState, dispatch: dispatcher.dispatch, lock: start.lock, intake: take }, start);
  client.onStatus((status) => dispatcher.dispatch({ type: "workerChanged", worker: workerOf(status) }));

  let publishedFrom = dispatcher.getState();
  let published = publish(publishedFrom);
  const engine: Engine = {
    getState() {
      const now = dispatcher.getState();
      if (now !== publishedFrom) {
        publishedFrom = now;
        published = publish(now);
      }
      return published;
    },
    subscribe: dispatcher.subscribe,
    library: facade,
    session: () => dispatcher.getState().session?.session,
  };
  const opened = (session: Session) => {
    const open = dispatcher.getState().session;
    return open?.session === session ? open : undefined;
  };
  return { engine, interim: { client, opened, intake: take, addCustomType } };
}
