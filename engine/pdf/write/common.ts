import * as mupdf from "mupdf";
import type { WriterErrorCode } from "../../model/errors";
import type { Box, PageIndex } from "../../model/geometry";

/** Where a refusal applies, never what the document says. */
interface RefusalData {
  readonly page?: PageIndex;
  readonly boxes?: readonly Box[];
}

/** Thrown inside apply to block the export; the app says why from its code. */
export class WriteRefused extends Error {
  constructor(
    readonly code: WriterErrorCode,
    readonly data?: RefusalData,
  ) {
    super(code);
  }
}

export interface Redaction {
  /** The box drawn, and the area whose images and drawings are removed. */
  readonly box: Box;
  /**
   * The area text is removed from. For marked text it is the letters' ink, not their whole
   * height: MuPDF removes any letter whose font box an area overlaps, and the font boxes of
   * closely set lines overlap, so the whole height would remove letters from the next line.
   */
  readonly textArea: Box;
  /** What the box prints when labels are on, like `[PERSON]`; empty where another box lies over the place it would print it. */
  readonly printed: string;
}

export function openPdf(bytes: Uint8Array): mupdf.PDFDocument {
  const document = mupdf.Document.openDocument(bytes.slice(0), "application/pdf");
  if (document instanceof mupdf.PDFDocument) return document;
  document.destroy();
  throw new WriteRefused("apply-failed");
}
