import { useRef, useState } from "react";
import { prepareFiles, type Refusal } from "./importFiles";
import type { ProjectDocument } from "./project";
import { writeOriginals, type StoredProject } from "./projects";
import type { Store } from "./storage";
import type { Engine } from "./useEngine";

const NOT_SAVED = "This file could not be saved in the project. Check that the disk has space, then add it again.";

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
    try {
      setRefused(prepared.refused);
      onAdded(await writeOriginals(store, project, prepared.added));
    } catch {
      setRefused([...prepared.refused, ...prepared.added.map(({ file }) => ({ file, reason: NOT_SAVED }))]);
    }
  }

  return {
    adding,
    refused,
    dismiss: () => setRefused([]),
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
