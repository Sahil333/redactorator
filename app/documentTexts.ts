// The text spreading searches: each document's, as the project keeps it, and where the engine
// finds values in it.
import type { PageText } from "../engine/contract";
import type { DocumentId, ProjectDocument } from "./project";
import { findOriginal, readTexts, saveTexts } from "./projects";
import type { Place } from "./spread";
import type { Store } from "./storage";
import type { Engine } from "./useEngine";

/** A document's text could not be had, or the engine could not search it, so nothing spread. */
class TextsUnavailable extends Error {}

async function textOf(store: Store, folder: string, document: ProjectDocument, engine: Pick<Engine, "inspect">) {
  const stored = await readTexts(store, folder, document);
  if (Array.isArray(stored)) return stored;
  // A project from before texts were kept, or a damaged text file: read the original again.
  const original = await findOriginal(store, folder, document);
  // One that is gone can't be opened or cleaned, so nothing in it needs hiding.
  if (original === undefined) return [];
  const inspection = await engine.inspect(await original.arrayBuffer());
  if ("error" in inspection) throw new TextsUnavailable();
  // Kept so the next search needn't read the original again; a newer version's file is left for
  // that version. A failed save costs only that, so it doesn't stop the search.
  if (stored !== "newer") await saveTexts(store, folder, document.id, inspection.texts).catch(() => undefined);
  return inspection.texts;
}

export async function documentTexts(
  store: Store,
  folder: string,
  documents: readonly ProjectDocument[],
  engine: Pick<Engine, "inspect">,
): Promise<Map<DocumentId, readonly PageText[]>> {
  const entries = await Promise.all(documents.map(async (document) => [document.id, await textOf(store, folder, document, engine)] as const));
  return new Map(entries);
}

/** Every place the engine finds each key in each document's text. */
export async function findPlaces(
  engine: Pick<Engine, "match">,
  keys: readonly string[],
  documents: readonly { readonly id: DocumentId; readonly texts: readonly PageText[] }[],
): Promise<Place[]> {
  if (keys.length === 0 || documents.length === 0) return [];
  const result = await engine.match(keys, documents.map(({ texts }) => texts.map((text) => text.chars.map((char) => char.c))));
  if ("error" in result) throw new TextsUnavailable();
  return result.found.flatMap(({ document, key, page, start, end }) => {
    const id = documents[document]?.id;
    const value = keys[key];
    return id === undefined || value === undefined ? [] : [{ document: id, key: value, page, start, end }];
  });
}
