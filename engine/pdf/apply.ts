import type * as mupdf from "mupdf";
import type { Appearance, Edit } from "../model/document";
import type { FileNumber } from "../pdf-protocol/messages";
import { fail, post } from "./messages";
import { documentModel } from "./read";
import { current } from "./state";
import { checkStructure } from "./structure";
import { openPdf, writeAndCheck, WriteRefused } from "./write";

/**
 * With no edits there is nothing to write: the working copy is the cleaned file, downloaded as it
 * is once its structure passes (review answer 6). A copy is posted, as the working bytes stay for
 * the next Preview.
 */
function unchanged(working: mupdf.PDFDocument, workingBytes: Uint8Array): { bytes: Uint8Array<ArrayBuffer>; output: mupdf.PDFDocument } {
  if (checkStructure(working) !== undefined) throw new WriteRefused("check-failed");
  const bytes = workingBytes.slice();
  return { bytes, output: openPdf(bytes) };
}

export function apply(file: FileNumber, edits: readonly Edit[], appearance: Appearance): void {
  const document = current(file);
  if (document === undefined) {
    fail(file, "apply-failed", "The open document changed. Open the PDF again.");
    return;
  }
  document.output?.destroy();
  document.output = undefined;
  let output: mupdf.PDFDocument | undefined;
  try {
    const written = edits.length === 0 ? unchanged(document.working, document.bytes) : writeAndCheck(document.working, document.bytes, edits, appearance);
    const bytes = written.bytes;
    output = written.output;
    const model = documentModel(output);
    if (model === undefined) throw new WriteRefused("check-failed");
    document.output = output;
    post({ type: "applied", file, bytes: bytes.buffer, output: model }, [bytes.buffer]);
  } catch (error) {
    // Fail closed: nothing reaches the UI to download unless every check passed.
    output?.destroy();
    if (error instanceof WriteRefused) fail(file, error.code, undefined, error.data);
    else fail(file, "apply-failed");
  }
}
