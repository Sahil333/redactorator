// What spreading searches: each document's reading (its pages' text and images) as the project
// keeps it, and where the engine finds values in the text.
import type { PageText, PlacedImage, Reading } from "../engine/contract";
import type { DocumentId, ProjectDocument } from "./project";
import { findOriginal, readImages, readTexts, saveImages, saveTexts } from "./projects";
import type { TextPlace } from "./spread";
import type { Store } from "./storage";
import type { Engine } from "./useEngine";

/** A document's reading could not be had, or the engine could not search it, so nothing spread. */
class ReadingUnavailable extends Error {}

/** A document's reading, or undefined when its original is gone: it can't be opened or cleaned, so nothing in it needs hiding. */
async function readingOf(store: Store, folder: string, document: ProjectDocument, engine: Pick<Engine, "inspect">): Promise<Reading | undefined> {
  const [texts, images] = await Promise.all([readTexts(store, folder, document), readImages(store, folder, document)]);
  const [first, ...rest] = Array.isArray(texts) ? texts : [];
  if (first !== undefined && Array.isArray(images)) return { texts: [first, ...rest], images };
  // A project from before texts, or images, were kept, or a damaged file: read the original again.
  const original = await findOriginal(store, folder, document);
  if (original === undefined) return undefined;
  const inspection = await engine.inspect(await original.arrayBuffer());
  if ("error" in inspection) throw new ReadingUnavailable();
  // Kept so the next search needn't read the original again; a newer version's file is left for
  // that version. A failed save costs only that, so it doesn't stop the search.
  const keep = (save: Promise<void>) => save.catch(() => undefined);
  await Promise.all([
    texts === "newer" ? undefined : keep(saveTexts(store, folder, document.id, inspection.texts)),
    images === "newer" ? undefined : keep(saveImages(store, folder, document.id, inspection.images)),
  ]);
  return inspection;
}

/**
 * A document's images, read on their own; reading the original again when they were never kept or
 * are damaged. A newer version's file can't be read and is left alone, so they are unknown.
 */
export async function imagesOf(
  store: Store,
  folder: string,
  document: ProjectDocument,
  engine: Pick<Engine, "inspect">,
): Promise<readonly PlacedImage[] | undefined> {
  const images = await readImages(store, folder, document);
  if (Array.isArray(images)) return images;
  return images === "newer" ? undefined : ((await readingOf(store, folder, document, engine))?.images ?? []);
}

export async function documentReadings(
  store: Store,
  folder: string,
  documents: readonly ProjectDocument[],
  engine: Pick<Engine, "inspect">,
): Promise<Map<DocumentId, Reading>> {
  const entries = await Promise.all(documents.map(async (document) => [document.id, await readingOf(store, folder, document, engine)] as const));
  return new Map(entries.flatMap(([id, reading]) => (reading === undefined ? [] : [[id, reading] as const])));
}

/** Every place the engine finds each key in each document's text. */
export async function findPlaces(
  engine: Pick<Engine, "match">,
  keys: readonly string[],
  documents: readonly { readonly id: DocumentId; readonly texts: readonly PageText[] }[],
): Promise<TextPlace[]> {
  if (keys.length === 0 || documents.length === 0) return [];
  const result = await engine.match(keys, documents.map(({ texts }) => texts.map((text) => text.chars.map((char) => char.c))));
  if ("error" in result) throw new ReadingUnavailable();
  return result.found.flatMap(({ document, key, page, start, end }) => {
    const id = documents[document]?.id;
    const value = keys[key];
    return id === undefined || value === undefined ? [] : [{ document: id, key: value, page, start, end }];
  });
}
