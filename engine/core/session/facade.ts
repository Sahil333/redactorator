import type { Result } from "../../api/errors";
import type { Session, TargetInput } from "../../api/facade";
import type { DocumentHandle, EngineState } from "../../api/state";
import { groundTruth } from "../../model/groundTruth";
import { markKey, nextId, type Mark, type MarkTarget } from "../../model/marks";
import { customTypeName, type MarkType } from "../../model/markTypes";
import type { DocumentId, Project, Settings } from "../../model/project";
import { textTarget, type TextPieceRange, type Texts } from "../../model/selection";
import type { Store } from "../../storage/store";
import type { PdfClient } from "../pdf-client/client";
import type { LockHold } from "../ports";
import type { InterimChange, SessionChange } from "./changes";
import { applyOutput } from "./effects/apply";
import { staleHandle, viewerOf } from "./effects/open";
import { saver } from "./effects/save";
import { gate, type SessionView } from "./gate";
import { canStep, validOutput } from "./selectors";
import { firstParts, type SessionParts } from "./slices";

/** The open Session, the store and folder its project lives in, and its part of the state. */
export interface OpenSession {
  readonly session: Session;
  readonly store: Store;
  readonly folder: string;
  readonly parts: SessionParts;
  /** Until steps 6c and 6d: lands a change the app's hooks worked out, and saves it, unless the Session is closing. */
  commit(change: InterimChange): void;
}

/**
 * What the engine root gives a Session: the state, the root dispatcher, which drops a change once
 * its Session is no longer the open one, the PDF worker, and the Library's custom types.
 */
export interface SessionHost {
  state(): { readonly worker: EngineState["worker"]; readonly settings: Settings; readonly session: OpenSession | undefined };
  dispatch(from: Session, change: SessionChange, ...effects: (() => void)[]): void;
  readonly client: PdfClient;
  /** Adds a type the user typed to the settings, once. */
  addCustomType(name: string): void;
}

const done: Result<void> = { ok: true, value: undefined };
const closed: Result<never> = { ok: false, error: { code: "session-closed" } };

const documentIn = (project: Project, id: DocumentId) => project.documents.find((document) => document.id === id);

/** Whether a piece's offsets lie within its page's text; a page with no text yet is `textTarget`'s to refuse. */
function fits(texts: Texts, { page, start, end }: TextPieceRange): boolean {
  const text = texts.get(page);
  return text === undefined || (Number.isInteger(start) && Number.isInteger(end) && start >= 0 && start <= end && end <= text.chars.length);
}

/** A new mark's target on the open document: the text of the pieces, worked out from the page texts the Session holds, or a box. */
function targetOf(texts: Texts, handle: DocumentHandle, input: TargetInput): MarkTarget | "page-text-missing" | "empty-target" | "empty-box" {
  if (input.kind === "text") return input.pieces.every((piece) => fits(texts, piece)) ? textTarget(texts, input.pieces) : "empty-target";
  const { page, box } = input;
  const onPage = handle.pages.some(({ index }) => index === page);
  return onPage && box.x1 > box.x0 && box.y1 > box.y0 ? { kind: "box", page, box } : "empty-box";
}

/**
 * A Session over `opening.project`, holding `hold` on it until it closes. Closing saves, lets the
 * lock go, then runs `closed`, the Library's part.
 */
export function openSession(host: SessionHost, opening: { readonly store: Store; readonly folder: string; readonly project: Project }, hold: LockHold, onClosed: () => void): OpenSession {
  const { store, folder } = opening;
  /** The gate's view of this Session, or undefined once it is closed. */
  function view(): SessionView | undefined {
    const { worker, settings, session: open } = host.state();
    return open?.session === session ? { worker, settings, parts: open.parts } : undefined;
  }
  /** This Session as it is now, if `command` may run. */
  function allowed(command: Parameters<typeof gate>[1], document?: DocumentId): Result<SessionView> {
    const now = view();
    if (now === undefined) return closed;
    const code = gate(now, command, document);
    return code === undefined ? { ok: true, value: now } : { ok: false, error: { code } };
  }
  const dispatch = (change: SessionChange, ...effects: (() => void)[]) => host.dispatch(session, change, ...effects);
  const saving = saver({ store, folder, latest: () => view()?.parts.record.present.project, dispatch });
  /** Dispatches a change to the project record, which saves it. */
  const change = (record: SessionChange) => dispatch(record, saving.changed);

  /** A command on mark `markId` of `document`, with that mark, once the gate allows it. */
  function onMark(document: DocumentId, markId: number, act: (mark: Mark) => void): Result<void> {
    const at = allowed("mark", document);
    if (!at.ok) return at;
    const mark = documentIn(at.value.parts.record.present.project, document)?.marks.find(({ id }) => id === markId);
    if (mark === undefined) return { ok: false, error: { code: "unknown-mark" } };
    act(mark);
    return done;
  }

  /** A type the user typed joins the settings, after the change that uses it. */
  function rememberType(type: MarkType) {
    const name = customTypeName(type);
    if (name !== undefined) host.addCustomType(name);
  }

  const step = (direction: "undo" | "redo") => (document: DocumentId) => {
    const at = allowed("history", document);
    if (!at.ok) return at;
    if (canStep(at.value, document, direction)) change({ type: direction, document });
    return done;
  };

  const session: Session = {
    projectId: opening.project.id,
    marks: {
      add({ handle, type, target }) {
        const at = allowed("add", handle.document);
        if (!at.ok) return at;
        const { viewer, record } = at.value.parts;
        if (viewer.handle !== handle) return staleHandle;
        const built = targetOf(viewer.texts, handle, target);
        if (typeof built === "string") return { ok: false, error: { code: built } };
        const marks = documentIn(record.present.project, handle.document)?.marks ?? [];
        const mark: Mark = { id: nextId(marks), type, linkId: "", target: built, isNew: false };
        change({ type: "markAdded", document: handle.document, mark });
        rememberType(type);
        return { ok: true, value: { markId: mark.id } };
      },
      retype: (document, markId, type) =>
        onMark(document, markId, () => {
          change({ type: "markRetyped", document, markId, markType: type });
          rememberType(type);
        }),
      remove: (document, markId) => onMark(document, markId, () => change({ type: "markRemoved", document, markId })),
      keepHere: (document, markId) =>
        onMark(document, markId, (mark) => {
          // Only a value with a key is hidden across the project.
          const key = markKey(mark);
          if (key !== undefined) change({ type: "keptHere", document, key });
        }),
    },
    history: { undo: step("undo"), redo: step("redo") },
    documents: {
      markDownloaded(document) {
        const at = allowed("markDownloaded", document);
        if (!at.ok) return at;
        change({ type: "downloaded", document });
        return done;
      },
    },
    viewer: viewerOf({
      source: { store, folder, client: host.client },
      view,
      allowed,
      dispatch,
    }),
    output: {
      apply() {
        const at = allowed("apply");
        return at.ok ? applyOutput(at.value, host.client, dispatch) : Promise.resolve(at);
      },
      bytes() {
        const at = allowed("query");
        if (!at.ok) return at;
        const output = validOutput(at.value);
        return output === undefined ? staleHandle : { ok: true, value: output.bytes };
      },
      discard() {
        const at = allowed("query");
        if (!at.ok) return at;
        dispatch({ type: "outputDiscarded" });
        return done;
      },
    },
    labelling: {
      link: (document, markId, linkId) => onMark(document, markId, () => change({ type: "linked", document, markId, linkId })),
      exportGroundTruth(document, facts) {
        const at = allowed("query", document);
        if (!at.ok) return at;
        const record = documentIn(at.value.parts.record.present.project, document);
        return record === undefined ? { ok: false, error: { code: "unknown-document" } } : { ok: true, value: groundTruth(record.marks, facts, record.sha256) };
      },
    },
    flush: saving.flush,
    async close() {
      const at = allowed("close");
      if (!at.ok) return at;
      dispatch({ type: "closeStarted" });
      if (!(await saving.flush())) {
        dispatch({ type: "closeFailed" });
        return { ok: false, error: { code: "save-failed" } };
      }
      hold.release();
      onClosed();
      return done;
    },
  };
  return {
    session,
    store,
    folder,
    parts: firstParts(opening.project),
    commit(record) {
      if (allowed("change").ok) change(record);
    },
  };
}
