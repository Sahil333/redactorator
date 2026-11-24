// What spreading searches: each document's reading (its pages' text and images) as the project
// keeps it, and where the engine finds values in the text.
import type { PageText, PlacedImage, Reading } from "../engine/model/document";
import type { DocumentId, ProjectDocument } from "../engine/model/project";
import type { TextPlace } from "../engine/model/spread";
import type { StoredFiles } from "../engine/host-browser/interim";
import type { Store } from "../engine/storage/store";
import type { PdfEngine } from "./useEngine";

/** A document's reading could not be had, or the engine could not search it, so nothing spread. */
class ReadingUnavailable extends Error {}

/** A document's reading, or undefined when its original is gone: it can't be opened or cleaned, so nothing in it needs hiding. */
async function readingOf(
  files: StoredFiles,
  store: Store,
  folder: string,
  document: ProjectDocument,
  engine: Pick<PdfEngine, "inspect">,
): Promise<Reading | undefined> {
  const [texts, images] = await Promise.all([files.readTexts(store, folder, document), files.readImages(store, folder, document)]);
  const [first, ...rest] = Array.isArray(texts) ? texts : [];
  if (first !== undefined && Array.isArray(images)) return { texts: [first, ...rest], images };
  // A project from before texts, or images, were kept, or a damaged file: read the original again.
  const original = await files.findOriginal(store, folder, document);
  if (original === undefined) return undefined;
  const inspection = await engine.inspect(original);
  if ("code" in inspection) throw new ReadingUnavailable();
  const { reading } = inspection;
  // Kept so the next search needn't read the original again; a newer version's file is left for
  // that version. A failed save costs only that, so it doesn't stop the search.
  const keep = (save: Promise<void>) => save.catch(() => undefined);
  await Promise.all([
    texts === "newer" ? undefined : keep(files.saveTexts(store, folder, document.id, reading.texts)),
    images === "newer" ? undefined : keep(files.saveImages(store, folder, document.id, reading.images)),
  ]);
  return reading;
}

/**
 * A document's images, read on their own; reading the original again when they were never kept or
 * are damaged. A newer version's file can't be read and is left alone, so they are unknown.
 */
export async function imagesOf(
  files: StoredFiles,
  store: Store,
  folder: string,
  document: ProjectDocument,
  engine: Pick<PdfEngine, "inspect">,
): Promise<readonly PlacedImage[] | undefined> {
  const images = await files.readImages(store, folder, document);
  if (Array.isArray(images)) return images;
  return images === "newer" ? undefined : ((await readingOf(files, store, folder, document, engine))?.images ?? []);
}

export async function documentReadings(
  files: StoredFiles,
  store: Store,
  folder: string,
  documents: readonly ProjectDocument[],
  engine: Pick<PdfEngine, "inspect">,
): Promise<Map<DocumentId, Reading>> {
  const entries = await Promise.all(documents.map(async (document) => [document.id, await readingOf(files, store, folder, document, engine)] as const));
  return new Map(entries.flatMap(([id, reading]) => (reading === undefined ? [] : [[id, reading] as const])));
}

/** Every place the engine finds each key in each document's text. */
export async function findPlaces(
  engine: Pick<PdfEngine, "match">,
  keys: readonly string[],
  documents: readonly { readonly id: DocumentId; readonly texts: readonly PageText[] }[],
): Promise<TextPlace[]> {
  if (keys.length === 0 || documents.length === 0) return [];
  const found = await engine.match(keys, documents);
  if ("code" in found) throw new ReadingUnavailable();
  return found.flatMap(({ document, key, page, start, end }) => {
    const id = documents[document]?.id;
    const value = keys[key];
    return id === undefined || value === undefined ? [] : [{ document: id, key: value, page, start, end }];
  });
}
