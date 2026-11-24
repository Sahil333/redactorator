import { useEffect, useRef, useState } from "react";
import type { DocumentId, Project, ProjectDocument } from "../engine/model/project";
import { saveProject, type StoredProject } from "./projects";
import { markKey } from "../engine/model/marks";
import type { Approval } from "../engine/model/spread";
import type { Store } from "./storage";

// Undo goes back this many changes per document.
const HISTORY_LIMIT = 100;

export type SaveState = "saved" | "saving" | "failed";

/** What the user changes in a document, and undo and redo take back. */
export type Edits = Pick<ProjectDocument, "marks" | "shown">;

/**
 * How a change to a document is kept. An `edit` alters what an apply would write: it can be
 * undone, and puts the document in review. A `label` is labelling data only.
 */
export type ChangeKind = "edit" | "label";

interface History {
  readonly past: readonly Edits[];
  readonly future: readonly Edits[];
}

const noHistory: History = { past: [], future: [] };

function withEdits(project: Project, id: DocumentId, { marks, shown }: Edits, kind: ChangeKind): Project {
  // A value marked again is no longer one the user keeps visible here.
  const keep = shown.filter((key) => !marks.some((mark) => markKey(mark) === key));
  const documents = project.documents.map((document): ProjectDocument => {
    if (document.id !== id) return document;
    if (kind === "label") return { ...document, marks, shown: keep };
    return { ...document, marks, shown: keep, review: "in-review", download: document.download === "none" ? "none" : "changed" };
  });
  return { ...project, documents };
}

/**
 * The open project: its documents and marks, undo and redo per document, and saving.
 * Every change is saved as it is made; changes made while a save is under way are saved together next.
 */
export function useProject(store: Store, opened: StoredProject) {
  const { folder } = opened;
  const [project, setProject] = useState(opened.project);
  const [histories, setHistories] = useState<ReadonlyMap<DocumentId, History>>(new Map());
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const latest = useRef(project);
  const unsaved = useRef(false);
  // True while a write waits behind the one under way; it will write the latest project.
  const queued = useRef(false);
  const writing = useRef<Promise<boolean>>(Promise.resolve(true));

  /** Saves now. Resolves once every change so far is written: true if they all landed. */
  function save(): Promise<boolean> {
    if (!unsaved.current || queued.current) return writing.current;
    queued.current = true;
    // Writes go one after another, so an older project never lands after a newer one.
    writing.current = writing.current.then(async () => {
      queued.current = false;
      unsaved.current = false;
      try {
        await saveProject(store, { folder, project: latest.current });
        setSaveState(unsaved.current ? "saving" : "saved");
        return true;
      } catch {
        unsaved.current = true;
        setSaveState("failed");
        return false;
      }
    });
    return writing.current;
  }

  function update(next: Project) {
    latest.current = next;
    unsaved.current = true;
    setProject(next);
    setSaveState("saving");
    void save();
  }

  useEffect(() => {
    const flush = () => void save();
    addEventListener("pagehide", flush);
    return () => {
      removeEventListener("pagehide", flush);
      flush();
    };
    // `save` reads refs and this project's store and folder, which never change while it is open.
  }, []);

  const editsOf = (id: DocumentId): Edits => {
    const document = latest.current.documents.find((each) => each.id === id);
    return { marks: document?.marks ?? [], shown: document?.shown ?? [] };
  };
  const historyOf = (id: DocumentId) => histories.get(id) ?? noHistory;

  function setHistory(id: DocumentId, history: History) {
    setHistories((current) => new Map(current).set(id, history));
  }

  function edit(id: DocumentId, change: (current: Edits) => Edits, kind: ChangeKind) {
    const before = editsOf(id);
    update(withEdits(latest.current, id, change(before), kind));
    if (kind === "label") return;
    const { past } = historyOf(id);
    setHistory(id, { past: [...past, before].slice(-HISTORY_LIMIT), future: [] });
  }

  function step(id: DocumentId, direction: "undo" | "redo") {
    const { past, future } = historyOf(id);
    const from = direction === "undo" ? past : future;
    const to = from.at(-1);
    if (to === undefined) return;
    const now = editsOf(id);
    // Link ids are labelling data that undo does not track, so each mark keeps its latest one.
    const linkIds = new Map(now.marks.map((mark) => [mark.id, mark.linkId]));
    const marks = to.marks.map((mark) => ({ ...mark, linkId: linkIds.get(mark.id) ?? mark.linkId }));
    update(withEdits(latest.current, id, { marks, shown: to.shown }, "edit"));
    setHistory(
      id,
      direction === "undo"
        ? { past: past.slice(0, -1), future: [...future, now] }
        : { past: [...past, now], future: future.slice(0, -1) },
    );
  }

  /** Lands an approval in one save. It can't be undone, so it ends the undo history of every document it changed. */
  function approve(approval: Approval) {
    update(approval.project);
    setHistories((current) => {
      const next = new Map(current);
      for (const { document } of [approval.here, ...approval.changes]) next.delete(document);
      return next;
    });
  }

  function downloaded(id: DocumentId) {
    const documents = latest.current.documents.map((document): ProjectDocument => (document.id === id ? { ...document, download: "downloaded" } : document));
    update({ ...latest.current, documents });
  }

  return {
    folder,
    project,
    saveState,
    save,
    /** The project with every change so far, for work that outlasts a render. */
    current: () => latest.current,
    edit,
    approve,
    downloaded,
    canUndo: (id: DocumentId) => historyOf(id).past.length > 0,
    canRedo: (id: DocumentId) => historyOf(id).future.length > 0,
    undo: (id: DocumentId) => step(id, "undo"),
    redo: (id: DocumentId) => step(id, "redo"),
    addDocuments: (documents: readonly ProjectDocument[]) =>
      update({ ...latest.current, documents: [...latest.current.documents, ...documents] }),
  };
}
