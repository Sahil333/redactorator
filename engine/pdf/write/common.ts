import * as mupdf from "mupdf";
import type { Box } from "../../model/geometry";

// What the writer and its check read letters with: as before preparation removed ActualText.
export const CHECK_OPTIONS = "preserve-whitespace";

/** Thrown inside apply to block the export with a reason the user sees. */
export class CheckFailed extends Error {}

export interface Redaction {
  /** The box drawn, and the area whose images and drawings are removed. */
  readonly box: Box;
  /**
   * The area text is removed from. For marked text it is the letters' ink, not their whole
   * height: MuPDF removes any letter whose font box an area overlaps, and the font boxes of
   * closely set lines overlap, so the whole height would remove letters from the next line.
   */
  readonly textArea: Box;
  /** What the box prints when labels are on, like `[PERSON]`. */
  readonly printed: string;
}

export function openPdf(bytes: Uint8Array): mupdf.PDFDocument {
  const document = mupdf.Document.openDocument(bytes.slice(0), "application/pdf");
  if (document instanceof mupdf.PDFDocument) return document;
  document.destroy();
  throw new CheckFailed("The cleaned file could not be read back.");
}
