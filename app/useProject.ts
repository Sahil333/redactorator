import { useEffect, useRef, useState } from "react";
import type { Mark } from "./marks";
import type { DocumentId, Project, ProjectDocument } from "./project";
import { saveProject, type StoredProject } from "./projects";
import type { Store } from "./storage";

// Undo goes back this many changes per document.
const HISTORY_LIMIT = 100;

export type SaveState = "saved" | "saving" | "failed";

interface History {
  readonly past: readonly (readonly Mark[])[];
  readonly future: readonly (readonly Mark[])[];
}

const noHistory: History = { past: [], future: [] };

function withMarks(project: Project, id: DocumentId, marks: readonly Mark[]): Project {
  return { ...project, documents: project.documents.map((document) => (document.id === id ? { ...document, marks } : document)) };
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

  const marksOf = (id: DocumentId) => latest.current.documents.find((document) => document.id === id)?.marks ?? [];
  const historyOf = (id: DocumentId) => histories.get(id) ?? noHistory;

  function setHistory(id: DocumentId, history: History) {
    setHistories((current) => new Map(current).set(id, history));
  }

  function changeMarks(id: DocumentId, change: (current: readonly Mark[]) => readonly Mark[], undoable: boolean) {
    const before = marksOf(id);
    update(withMarks(latest.current, id, change(before)));
    if (!undoable) return;
    const { past } = historyOf(id);
    setHistory(id, { past: [...past, before].slice(-HISTORY_LIMIT), future: [] });
  }

  function step(id: DocumentId, direction: "undo" | "redo") {
    const { past, future } = historyOf(id);
    const from = direction === "undo" ? past : future;
    const to = from.at(-1);
    if (to === undefined) return;
    const now = marksOf(id);
    // Link ids are labelling data that undo does not track, so each mark keeps its latest one.
    const linkIds = new Map(now.map((mark) => [mark.id, mark.linkId]));
    update(withMarks(latest.current, id, to.map((mark) => ({ ...mark, linkId: linkIds.get(mark.id) ?? mark.linkId }))));
    setHistory(
      id,
      direction === "undo"
        ? { past: past.slice(0, -1), future: [...future, now] }
        : { past: [...past, now], future: future.slice(0, -1) },
    );
  }

  return {
    folder,
    project,
    saveState,
    save,
    changeMarks,
    canUndo: (id: DocumentId) => historyOf(id).past.length > 0,
    canRedo: (id: DocumentId) => historyOf(id).future.length > 0,
    undo: (id: DocumentId) => step(id, "undo"),
    redo: (id: DocumentId) => step(id, "redo"),
    addDocuments: (documents: readonly ProjectDocument[]) =>
      update({ ...latest.current, documents: [...latest.current.documents, ...documents] }),
  };
}
