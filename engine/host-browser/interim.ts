// What the app's hooks that have not moved into the engine yet take from it, until step 6d.
import type { Session } from "../api/facade";
import type { EngineInterim } from "../core/createEngine";
import { documentReadings, findPlaces } from "../core/session/effects/readings";
import { writeOriginals } from "../core/stored/projects";
import type { PageText, Reading } from "../model/document";
import type { DocumentId, ProjectDocument } from "../model/project";
import type { TextPlace } from "../model/spread";
import type { Store } from "../storage/store";

export type { StoredProject } from "../core/stored/projects";

/** What spreading searches: each document's reading as the project keeps it, and where values are in the text. */
interface Readings {
  documentReadings(store: Store, folder: string, documents: readonly ProjectDocument[]): Promise<Map<DocumentId, Reading>>;
  findPlaces(keys: readonly string[], documents: readonly { readonly id: DocumentId; readonly texts: readonly PageText[] }[]): Promise<TextPlace[]>;
}

export interface Interim extends EngineInterim {
  /** The stored-file function the app still calls itself. */
  readonly stored: { readonly writeOriginals: typeof writeOriginals };
  /** Until step 6d. */
  readonly readings: Readings;
  /** Until step 6d: documents the app added, with the project's hidden values spread into them. */
  addDocuments(session: Session, documents: readonly ProjectDocument[]): void;
}

// Each lands only in `session`, so a late call from a project already left never lands in the next.
export const interimOf = (core: EngineInterim): Interim => ({
  ...core,
  stored: { writeOriginals },
  readings: {
    documentReadings: (store, folder, documents) => documentReadings({ store, folder, client: core.client }, documents),
    findPlaces: (keys, documents) => findPlaces(core.client, keys, documents),
  },
  addDocuments: (session, documents) => core.opened(session)?.commit({ type: "documentsAdded", documents }),
});
