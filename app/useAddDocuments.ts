import { useRef, useState } from "react";
import type { ErrorCode, Refusal } from "../engine/api/errors";
import type { Interim, StoredProject } from "../engine/host-browser/interim";
import type { ProjectDocument } from "../engine/model/project";
import { hiddenTextKeys, spreadToAdded } from "../engine/model/spread";
import type { Store } from "../engine/storage/store";
import { incomingFiles } from "./incomingFiles";

const refusals = (files: readonly string[], code: ErrorCode): Refusal[] => files.map((file) => ({ file, error: { code } }));

/** Adds chosen files to the open project, and keeps the list of those that could not be added. */
export function useAddDocuments(
  interim: Pick<Interim, "stored" | "intake" | "readings">,
  store: Store,
  project: StoredProject,
  /** Whether the PDF worker has stopped, so nothing can be added. */
  stopped: boolean,
  initialRefused: readonly Refusal[],
  onAdded: (documents: readonly ProjectDocument[]) => void,
) {
  const [adding, setAdding] = useState(false);
  const [refused, setRefused] = useState(initialRefused);
  const underWay = useRef<Promise<void>>(Promise.resolve());

  async function add(files: readonly File[]) {
    const prepared = await interim.intake(incomingFiles(files));
    const refuseAll = (code: ErrorCode) => setRefused([...prepared.refused, ...refusals(prepared.added.map(({ file }) => file), code)]);
    setRefused(prepared.refused);
    // Searched before anything is written, so no document joins without the project's hidden values.
    let places: Awaited<ReturnType<Interim["readings"]["findPlaces"]>>;
    try {
      places = await interim.readings.findPlaces(hiddenTextKeys(project.project), prepared.added.map(({ id, reading }) => ({ id, texts: reading.texts })));
    } catch {
      refuseAll("add-search-failed");
      return;
    }
    try {
      const documents = await interim.stored.writeOriginals(store, project, prepared.added);
      const readings = new Map(prepared.added.map((each) => [each.id, each.reading]));
      onAdded(spreadToAdded(project.project, documents, readings, places));
    } catch {
      refuseAll("add-save-failed");
    }
  }

  return {
    adding,
    refused,
    dismiss: () => setRefused([]),
    refuse: (files: readonly File[], code: ErrorCode) => setRefused((current) => [...current, ...refusals(files.map(({ name }) => name), code)]),
    add: (files: readonly File[]) => {
      if (adding || stopped) return;
      setAdding(true);
      underWay.current = add(files)
        .catch(() => setRefused(refusals(files.map(({ name }) => name), "add-save-failed")))
        .finally(() => setAdding(false));
    },
    /** Resolves once no add is under way, so the project is not left with files still being written. */
    settled: () => underWay.current,
  };
}
