import type * as mupdf from "mupdf";
import type { Source } from "../model/document";
import type { FileNumber } from "../pdf-protocol/messages";
import { fail, post } from "./messages";
import { load } from "./read";

interface Opened {
  readonly file: FileNumber;
  /** The document's working copy, which preparation made. Each apply starts again from these bytes. */
  readonly bytes: Uint8Array;
  readonly working: mupdf.PDFDocument;
  output: mupdf.Document | undefined;
}

let opened: Opened | undefined;

function closeAll(): void {
  opened?.working.destroy();
  opened?.output?.destroy();
  opened = undefined;
}

export function open(file: FileNumber, bytes: ArrayBuffer): void {
  closeAll();
  const copy = new Uint8Array(bytes.slice(0));
  const loaded = load(bytes);
  if ("code" in loaded) {
    fail(file, loaded.code, loaded.message);
    return;
  }
  opened = { file, bytes: copy, working: loaded.document, output: undefined };
  post({ type: "opened", file, document: loaded.model });
}

export function current(file: FileNumber): Opened | undefined {
  return opened?.file === file ? opened : undefined;
}

/** The document a render reads. `Source` "original" names the working copy, which stands in for the user's file. */
export function sourceDocument(file: FileNumber, source: Source): mupdf.Document | undefined {
  const document = current(file);
  return source === "original" ? document?.working : document?.output;
}
