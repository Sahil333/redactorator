import type * as mupdf from "mupdf";
import type { Source } from "../model/document";
import type { FileNumber } from "../pdf-protocol/messages";
import { fail, post } from "./messages";
import { load } from "./read";

interface Opened {
  readonly file: FileNumber;
  /** The file as the user picked it. Each apply starts again from these bytes. */
  readonly bytes: Uint8Array;
  readonly original: mupdf.PDFDocument;
  output: mupdf.Document | undefined;
}

let opened: Opened | undefined;

function closeAll(): void {
  opened?.original.destroy();
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
  opened = { file, bytes: copy, original: loaded.document, output: undefined };
  post({ type: "opened", file, document: loaded.model });
}

export function current(file: FileNumber): Opened | undefined {
  return opened?.file === file ? opened : undefined;
}

export function sourceDocument(file: FileNumber, source: Source): mupdf.Document | undefined {
  const document = current(file);
  return source === "original" ? document?.original : document?.output;
}
