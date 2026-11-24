import type * as mupdf from "mupdf";
import type { Appearance, Edit } from "../model/document";
import type { FileNumber } from "../pdf-protocol/messages";
import { fail, post } from "./messages";
import { documentModel } from "./read";
import { current } from "./state";
import { CheckFailed, writeAndCheck } from "./write";

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
    const written = writeAndCheck(document.original, document.bytes, edits, appearance);
    const bytes = written.bytes;
    output = written.output;
    const model = documentModel(output);
    if (model === undefined) throw new CheckFailed("The cleaned file has no pages.");
    document.output = output;
    post({ type: "applied", file, bytes: bytes.buffer, output: model }, [bytes.buffer]);
  } catch (error) {
    // Fail closed: nothing reaches the UI to download unless every check passed.
    output?.destroy();
    const reason = error instanceof CheckFailed ? error.message : "The marks could not be applied.";
    fail(
      file,
      error instanceof CheckFailed ? "check-failed" : "apply-failed",
      `${reason} Nothing was exported. Apply and check again; if it fails again, this PDF can't be cleaned here yet.`,
    );
  }
}
