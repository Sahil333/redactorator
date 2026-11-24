import { useRef, useState } from "react";
import { findPlaces } from "./documentReadings";
import { prepareFiles, type Refusal } from "./importFiles";
import type { ProjectDocument } from "../engine/model/project";
import { hiddenTextKeys, spreadToAdded } from "../engine/model/spread";
import type { StoredFiles, StoredProject } from "../engine/host-browser/interim";
import type { Store } from "../engine/storage/store";
import type { PdfEngine } from "./useEngine";

const NOT_SAVED = "This file could not be saved in the project. Check that the disk has space, then add it again.";
const NOT_SEARCHED = "This file could not be searched for the project's hidden values, so it wasn't added. Reload the page, then add it again.";

/** Adds chosen files to the open project, and keeps the list of those that could not be added. */
export function useAddDocuments(
  storedFiles: StoredFiles,
  store: Store,
  project: StoredProject,
  engine: PdfEngine,
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
      places = await findPlaces(engine, hiddenTextKeys(project.project), prepared.added.map(({ id, reading }) => ({ id, texts: reading.texts })));
    } catch {
      refuseAll(NOT_SEARCHED);
      return;
    }
    try {
      const documents = await storedFiles.writeOriginals(store, project, prepared.added);
      const readings = new Map(prepared.added.map((each) => [each.id, each.reading]));
      onAdded(spreadToAdded(project.project, documents, readings, places));
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
