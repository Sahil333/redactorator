// A document's findings files in a reader folder: the hits of its open findings review, that
// review's state, and the record of its last run (docs/designs/auto-mode.md, Technical Plan,
// section 5). Their positions belong to the reader that made them, so they live in its folder.
import type { RunRecord } from "../../model/detection";
import type { DocumentId } from "../../model/project";
import type { Store } from "../../storage/store";
import { parseHits, parseRun, parseState, type FindingsState, type StoredHits } from "../formats/findings";

const decoder = new TextDecoder();

/** The paths of `document`'s findings files in `readerFolder`, a project's `.redactorator/<reader tag>`. */
export function findingsFiles(readerFolder: string, document: DocumentId) {
  const at = `${readerFolder}/findings/${document}`;
  return { hits: `${at}.hits.json`, state: `${at}.state.json`, run: `${at}.run.json` } as const;
}

/** A document's findings files as this build reads them; each is undefined when it is missing, or this build can't read it. */
export interface StoredFindings {
  readonly hits: StoredHits | undefined;
  readonly state: FindingsState | undefined;
  readonly record: RunRecord | undefined;
}

/** The file at `path` parsed, or undefined when it is missing, can't be read, or doesn't parse. Such a file is left alone. */
async function readParsed<T>(store: Store, path: string, parse: (text: string) => T | undefined): Promise<T | undefined> {
  try {
    const file = await store.read(path);
    return file === undefined ? undefined : parse(decoder.decode(file));
  } catch {
    return undefined;
  }
}

/** The hits file of `document` in `readerFolder`, when this build can read it. */
export const readHits = (store: Store, readerFolder: string, document: DocumentId): Promise<StoredHits | undefined> =>
  readParsed(store, findingsFiles(readerFolder, document).hits, parseHits);

export async function readFindings(store: Store, readerFolder: string, document: DocumentId): Promise<StoredFindings> {
  const files = findingsFiles(readerFolder, document);
  const [hits, state, record] = await Promise.all([readHits(store, readerFolder, document), readParsed(store, files.state, parseState), readParsed(store, files.run, parseRun)]);
  return { hits, state, record };
}
