import { useRef, useState } from "react";
import { findPlaces } from "./documentTexts";
import { prepareFiles, type Refusal } from "./importFiles";
import type { ProjectDocument } from "./project";
import { writeOriginals, type StoredProject } from "./projects";
import { spreadToAdded } from "./spread";
import type { Store } from "./storage";
import type { Engine } from "./useEngine";

const NOT_SAVED = "This file could not be saved in the project. Check that the disk has space, then add it again.";
const NOT_SEARCHED = "This file could not be searched for the project's hidden values, so it wasn't added. Reload the page, then add it again.";

/** Adds chosen files to the open project, and keeps the list of those that could not be added. */
export function useAddDocuments(
  store: Store,
  project: StoredProject,
  engine: Engine,
  initialRefused: readonly Refusal[],
  onAdded: (documents: readonly ProjectDocument[]) => void,
) {
  const [adding, setAdding] = useState(false);
  const [refused, setRefused] = useState(initialRefused);
  const underWay = useRef<Promise<void>>(Promise.resolve());

  async function add(files: readonly File[]) {
    const prepared = await prepareFiles(files, engine.inspect);
    const refuseAll = (reason: string) => setRefused([...prepared.refused, ...prepared.added.map(({ file }) => ({ file, reason }))]);
    setRefused(prepared.refused);
    // Searched before anything is written, so no document joins without the project's hidden values.
    let places: Awaited<ReturnType<typeof findPlaces>>;
    try {
      places = await findPlaces(engine, project.project.hidden.map((value) => value.key), prepared.added);
    } catch {
      refuseAll(NOT_SEARCHED);
      return;
    }
    try {
      const documents = await writeOriginals(store, project, prepared.added);
      const texts = new Map(prepared.added.map((each) => [each.id, each.texts]));
      onAdded(spreadToAdded(project.project, documents, texts, places));
    } catch {
      refuseAll(NOT_SAVED);
    }
  }

  return {
    adding,
    refused,
    dismiss: () => setRefused([]),
    refuse: (files: readonly File[], reason: string) => setRefused((current) => [...current, ...files.map((file) => ({ file: file.name, reason }))]),
    add: (files: readonly File[]) => {
      if (adding || engine.state === "stopped") return;
      setAdding(true);
      underWay.current = add(files)
        .catch(() => setRefused(files.map((file) => ({ file: file.name, reason: NOT_SAVED }))))
        .finally(() => setAdding(false));
    },
    /** Resolves once no add is under way, so the project is not left with files still being written. */
    settled: () => underWay.current,
  };
}
