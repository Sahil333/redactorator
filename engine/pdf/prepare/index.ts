// Preparation: the working copy of a document, made once from the user's file, that the app
// shows, reads, marks and writes from (docs/designs/pdf-leak-suite.md, part 1).
import type * as mupdf from "mupdf";
import type { Reading, RemovalKind } from "../../model/document";
import type { ReaderErrorCode } from "../../model/errors";
import { placedImages } from "../images";
import { nameAt, objectAt, valuesOf } from "../objects";
import { load } from "../read";
import { stripToAllowlist } from "../allowlist";
import { pageText, withPage } from "../text";
import { flattenAnnotations } from "./annotations";
import { preparedWell } from "./check";
import { cleanContent, removeOutside } from "./page";
import { open, reopen } from "./reopen";

const STEP_8 = "garbage=4,compress,encrypt=none";

export interface Prepared {
  readonly preparedBytes: Uint8Array<ArrayBuffer>;
  readonly reading: Reading;
  /** Sorted, with no repeats. */
  readonly removed: readonly RemovalKind[];
}

/** Why a file can't be prepared; `message` is the reader's own sentence, where it has one. */
export interface NotPrepared {
  readonly code: ReaderErrorCode;
  readonly message?: string;
}

const failed: NotPrepared = { code: "prepare-failed" };

/**
 * A form drawn only by XFA, which MuPDF can't draw: an `/XFA` entry and no widget on any page. A
 * hybrid form, XFA beside the widgets MuPDF draws, is flattened like any other (owner, 25 Nov 2026).
 */
function isXfaOnly(document: mupdf.PDFDocument): boolean {
  if (document.getTrailer().get("Root", "AcroForm", "XFA").isNull()) return false;
  // Read from the page objects, as an XFA form's placeholder pages need not load.
  for (let index = 0; index < document.countPages(); index++) {
    if (valuesOf(objectAt(document.findPage(index), "Annots")).some((annotation) => nameAt(annotation.resolve(), "Subtype") === "Widget")) return false;
  }
  return true;
}

/** Steps 1 to 9 on the user's file. Any failure refuses the document; nothing is kept in part. */
export function prepareDocument(bytes: ArrayBuffer): Prepared | NotPrepared {
  const loaded = load(bytes.slice(0));
  if ("code" in loaded) return loaded;
  const { model } = loaded;
  let document = loaded.document;
  let original: mupdf.PDFDocument | undefined;
  const removed = new Set<RemovalKind>();
  try {
    if (isXfaOnly(document)) return { code: "unsupported-form" };
    if (document.countVersions() > 1) removed.add("old-revisions");
    document = flattenAnnotations(document, removed);
    document = cleanContent(document, removed);
    removeOutside(document, removed);
    const stripped = stripToAllowlist(document);
    if (stripped === "refused") return failed;
    for (const kind of stripped) removed.add(kind);
    // MuPDF 1.28.6's garbage collection drops the data of a stream read from the file whose
    // references it renumbers, once that stream has been read, as the walk above reads every one.
    // Saved and opened again first, nothing has been read when step 8 renumbers. The save
    // compresses the streams step 7 wrote again from their decoded bytes, which would otherwise
    // fill MuPDF's memory as a copy that large.
    document = reopen(document, "compress");
    const preparedBytes = document.saveToBuffer(STEP_8).asUint8Array().slice();
    document.destroy();
    document = open(preparedBytes);
    original = open(new Uint8Array(bytes));
    if (!preparedWell(original, document)) return failed;
    const working = document;
    const [first, ...rest] = model.pages.map((page) => withPage(working, page.index, pageText));
    if (first === undefined) return failed;
    const images = model.pages.flatMap((page) => withPage(working, page.index, (loadedPage) => placedImages(loadedPage, page.index)));
    return { preparedBytes, reading: { texts: [first, ...rest], images }, removed: [...removed].toSorted() };
  } catch {
    return failed;
  } finally {
    document.destroy();
    original?.destroy();
  }
}
