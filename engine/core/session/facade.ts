import type { Result } from "../../api/errors";
import type { Session } from "../../api/facade";
import type { EngineState } from "../../api/state";
import type { DocumentId, Project } from "../../model/project";
import type { Store } from "../../storage/store";
import type { LockHold } from "../ports";
import type { InterimChange, SessionChange } from "./changes";
import { saver } from "./effects/save";
import { gate, type SessionView } from "./gate";
import { canStep } from "./selectors";
import { firstParts, type SessionParts } from "./slices";

/** The open Session, the store and folder its project lives in, and its part of the state. */
export interface OpenSession {
  readonly session: Session;
  readonly store: Store;
  readonly folder: string;
  readonly parts: SessionParts;
  /** Until steps 6b to 6d: lands a change the app's hooks worked out, and saves it, unless the Session is closing. */
  commit(change: InterimChange): void;
}

/** What the engine root gives a Session: the state, and the root dispatcher, which drops a change once its Session is no longer the open one. */
export interface SessionHost {
  state(): { readonly worker: EngineState["worker"]; readonly session: OpenSession | undefined };
  dispatch(from: Session, change: SessionChange, ...effects: (() => void)[]): void;
}

const done: Result<void> = { ok: true, value: undefined };

/**
 * A Session over `opening.project`, holding `hold` on it until it closes. Closing saves, lets the
 * lock go, then runs `closed`, the Library's part.
 */
export function openSession(host: SessionHost, opening: { readonly store: Store; readonly folder: string; readonly project: Project }, hold: LockHold, closed: () => void): OpenSession {
  const { store, folder } = opening;
  /** The gate's view of this Session, or undefined once it is closed. */
  function view(): SessionView | undefined {
    const { worker, session: open } = host.state();
    return open?.session === session ? { worker, parts: open.parts } : undefined;
  }
  const refused = (command: Parameters<typeof gate>[1], document?: DocumentId): Result<never> | undefined => {
    const now = view();
    const code = now === undefined ? "session-closed" : gate(now, command, document);
    return code === undefined ? undefined : { ok: false, error: { code } };
  };
  const dispatch = (change: SessionChange, ...effects: (() => void)[]) => host.dispatch(session, change, ...effects);
  const saving = saver({ store, folder, latest: () => view()?.parts.record.present.project, dispatch });
  /** Dispatches a change to the project record, which saves it. */
  const change = (record: SessionChange) => dispatch(record, saving.changed);

  const step = (direction: "undo" | "redo") => (document: DocumentId) => {
    const refusal = refused("history", document);
    if (refusal !== undefined) return refusal;
    const now = view();
    if (now !== undefined && canStep(now, document, direction)) change({ type: direction, document });
    return done;
  };

  const session: Session = {
    projectId: opening.project.id,
    history: { undo: step("undo"), redo: step("redo") },
    documents: {
      markDownloaded(document) {
        const refusal = refused("markDownloaded", document);
        if (refusal !== undefined) return refusal;
        change({ type: "downloaded", document });
        return done;
      },
    },
    flush: saving.flush,
    async close() {
      const refusal = refused("close");
      if (refusal !== undefined) return refusal;
      dispatch({ type: "closeStarted" });
      if (!(await saving.flush())) {
        dispatch({ type: "closeFailed" });
        return { ok: false, error: { code: "save-failed" } };
      }
      hold.release();
      closed();
      return done;
    },
  };
  return {
    session,
    store,
    folder,
    parts: firstParts(opening.project),
    commit(record) {
      if (refused("change") === undefined) change(record);
    },
  };
}
