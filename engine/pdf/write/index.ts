import type * as mupdf from "mupdf";
import type { Appearance, Edit } from "../../model/document";
import { check } from "./check";
import { openPdf } from "./common";
import { redact, redactionsByPage } from "./redact";

export { CheckFailed } from "./common";

/**
 * Writes the cleaned file from the original's bytes and checks it, in apply's order. A failed
 * check destroys the output it opened before the CheckFailed goes on to the caller.
 */
export function writeAndCheck(
  original: mupdf.PDFDocument,
  bytes: Uint8Array,
  edits: readonly Edit[],
  appearance: Appearance,
): { bytes: Uint8Array<ArrayBuffer>; output: mupdf.PDFDocument } {
  const byPage = redactionsByPage(original, edits);
  const written = redact(bytes, byPage, appearance);
  const output = openPdf(written);
  try {
    check(original, output, byPage, appearance);
  } catch (error) {
    output.destroy();
    throw error;
  }
  return { bytes: written, output };
}
