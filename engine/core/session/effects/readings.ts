// What spreading searches: each document's reading (its pages' text and images) as this build
// stored it in the tag folder, and where the PDF worker finds values in the text.
import type { PageText, PlacedImage, Reading } from "../../../model/document";
import type { DocumentId, ProjectDocument } from "../../../model/project";
import type { TextPlace } from "../../../model/spread";
import { READER_TAG } from "../../../pdf-protocol/messages";
import type { Store } from "../../../storage/store";
import type { PdfClient } from "../../pdf-client/client";
import { findOriginal, readImages, readTexts } from "../../stored/projects";

/** A document's reading could not be had, or the engine could not search it, so nothing spread. */
class ReadingUnavailable extends Error {}

/** Where a project's documents are kept, and what the Session knows of them. */
export interface ReadingSource {
  readonly store: Store;
  readonly folder: string;
  /** Whether the document could not be prepared again: it is never opened or exported, so nothing in it needs hiding. */
  failed(document: DocumentId): boolean;
  /** A document's reading is missing or damaged: the documents are prepared again. */
  unavailable(): void;
}

/**
 * A document's reading from the tag folder, or undefined when it can't be opened or cleaned, as
 * when its original is gone. A missing or damaged reading starts the update and throws; it is
 * never read again here.
 */
async function readingOf(source: ReadingSource, document: ProjectDocument): Promise<Reading | undefined> {
  const { store, folder } = source;
  if (source.failed(document.id)) return undefined;
  const [texts, images] = await Promise.all([readTexts(store, folder, READER_TAG, document), readImages(store, folder, READER_TAG, document)]);
  const [first, ...rest] = texts !== undefined && typeof texts !== "string" ? texts.pages : [];
  if (first !== undefined && Array.isArray(images)) return { texts: [first, ...rest], images };
  if ((await findOriginal(store, folder, document)) === undefined) return undefined;
  source.unavailable();
  throw new ReadingUnavailable();
}

/** A document's images, or undefined when they can't be known now. */
export async function imagesOf(source: ReadingSource, document: ProjectDocument): Promise<readonly PlacedImage[] | undefined> {
  return (await readingOf(source, document))?.images;
}

export async function documentReadings(source: ReadingSource, documents: readonly ProjectDocument[]): Promise<Map<DocumentId, Reading>> {
  const entries = await Promise.all(documents.map(async (document) => [document.id, await readingOf(source, document)] as const));
  return new Map(entries.flatMap(([id, reading]) => (reading === undefined ? [] : [[id, reading] as const])));
}

/** Every place the PDF worker finds each key in each document's text. */
export async function findPlaces(
  client: Pick<PdfClient, "match">,
  keys: readonly string[],
  documents: readonly { readonly id: DocumentId; readonly texts: readonly PageText[] }[],
): Promise<TextPlace[]> {
  if (keys.length === 0 || documents.length === 0) return [];
  const found = await client.match(keys, documents);
  if ("code" in found) throw new ReadingUnavailable();
  return found.flatMap(({ document, key, page, start, end }) => {
    const id = documents[document]?.id;
    const value = keys[key];
    return id === undefined || value === undefined ? [] : [{ document: id, key: value, page, start, end }];
  });
}
