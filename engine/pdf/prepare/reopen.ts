import * as mupdf from "mupdf";

/**
 * Saves `document` with `options` and opens the result, using `document` up. The saved bytes are
 * a view into MuPDF's memory, which moves as it grows, so they are copied before opening.
 */
export function reopen(document: mupdf.PDFDocument, options: string): mupdf.PDFDocument {
  let saved: Uint8Array;
  try {
    saved = document.saveToBuffer(options).asUint8Array().slice();
  } finally {
    document.destroy();
  }
  return open(saved);
}

export function open(bytes: Uint8Array): mupdf.PDFDocument {
  const opened = mupdf.Document.openDocument(bytes, "application/pdf");
  if (opened instanceof mupdf.PDFDocument) return opened;
  opened.destroy();
  throw new Error("Not a PDF");
}
