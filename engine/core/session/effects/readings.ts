// What spreading searches: each document's reading (its pages' text and images) as the project
// keeps it, and where the PDF worker finds values in the text.
import type { PageText, PlacedImage, Reading } from "../../../model/document";
import type { DocumentId, ProjectDocument } from "../../../model/project";
import type { TextPlace } from "../../../model/spread";
import type { Store } from "../../../storage/store";
import type { PdfClient } from "../../pdf-client/client";
import { findOriginal, readImages, readTexts, saveImages, saveTexts } from "../../stored/projects";

/** A document's reading could not be had, or the engine could not search it, so nothing spread. */
class ReadingUnavailable extends Error {}

/** Where a project's documents are kept, and the PDF worker that reads them again when their readings are missing. */
export interface ReadingSource {
  readonly store: Store;
  readonly folder: string;
  readonly client: Pick<PdfClient, "inspect">;
}

/** A document's reading, or undefined when its original is gone: it can't be opened or cleaned, so nothing in it needs hiding. */
async function readingOf({ store, folder, client }: ReadingSource, document: ProjectDocument): Promise<Reading | undefined> {
  const [texts, images] = await Promise.all([readTexts(store, folder, document), readImages(store, folder, document)]);
  const [first, ...rest] = Array.isArray(texts) ? texts : [];
  if (first !== undefined && Array.isArray(images)) return { texts: [first, ...rest], images };
  // A project from before texts, or images, were kept, or a damaged file: read the original again.
  const original = await findOriginal(store, folder, document);
  if (original === undefined) return undefined;
  const inspection = await client.inspect(original);
  if ("code" in inspection) throw new ReadingUnavailable();
  const { reading } = inspection;
  // Kept so the next search needn't read the original again; a newer version's file is left for
  // that version. A failed save costs only that, so it doesn't stop the search.
  const keep = (save: Promise<void>) => save.catch(() => undefined);
  await Promise.all([
    texts === "newer" ? undefined : keep(saveTexts(store, folder, document.id, reading.texts)),
    images === "newer" ? undefined : keep(saveImages(store, folder, document.id, reading.images)),
  ]);
  return reading;
}

/**
 * A document's images, read on their own; reading the original again when they were never kept or
 * are damaged. A newer version's file can't be read and is left alone, so they are unknown.
 */
export async function imagesOf(source: ReadingSource, document: ProjectDocument): Promise<readonly PlacedImage[] | undefined> {
  const images = await readImages(source.store, source.folder, document);
  if (Array.isArray(images)) return images;
  return images === "newer" ? undefined : ((await readingOf(source, document))?.images ?? []);
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
