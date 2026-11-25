import * as mupdf from "mupdf";
import type { DocumentModel, PageModel } from "../model/document";
import { isPageIndex, isPoints } from "../model/geometry";
import type { ReaderErrorCode } from "../model/errors";

export function documentModel(document: mupdf.Document): DocumentModel | undefined {
  const pages: PageModel[] = [];
  for (let index = 0; index < document.countPages(); index++) {
    const page = document.loadPage(index);
    try {
      const [x0, y0, x1, y1] = page.getBounds();
      const width = x1 - x0;
      const height = y1 - y0;
      if (!isPageIndex(index) || !isPoints(width) || !isPoints(height) || width <= 0 || height <= 0) {
        throw new Error(`Page ${index + 1} has no size`);
      }
      pages.push({ index, width, height });
    } finally {
      page.destroy();
    }
  }
  const [first, ...rest] = pages;
  return first && { pages: [first, ...rest] };
}

/** Opens a PDF the engine can work on, or says why it can't. */
export function load(
  bytes: ArrayBuffer,
): { readonly document: mupdf.PDFDocument; readonly model: DocumentModel } | { readonly code: Extract<ReaderErrorCode, "encrypted" | "open-failed">; readonly message: string } {
  let document: mupdf.Document | undefined;
  try {
    document = mupdf.Document.openDocument(bytes, "application/pdf");
    if (!(document instanceof mupdf.PDFDocument)) throw new Error("Not a PDF");
    // DOC-4: a file that needs a password to open is refused, never processed in part. One with
    // an empty password, locked only against editing or copying, is read in full like any other.
    if (document.needsPassword()) {
      document.destroy();
      return { code: "encrypted", message: "This PDF is encrypted. Remove its password in the app that made it, then open it again." };
    }
    const model = documentModel(document);
    if (model === undefined) {
      document.destroy();
      return { code: "open-failed", message: "This PDF has no pages. Choose another file." };
    }
    return { document, model };
  } catch {
    // A file that opens but fails later is still held in WebAssembly memory until destroyed.
    document?.destroy();
    return { code: "open-failed", message: "This file could not be opened as a PDF. Check that it is a PDF and try again." };
  }
}
