/** Why the PDF reader could not open a document, or read or draw one of its pages. */
export type ReaderErrorCode = "open-failed" | "encrypted" | "text-failed" | "render-failed";

/** Why the PDF writer could not write a cleaned file, or the cleaned file failed its check. */
export type WriterErrorCode = "apply-failed" | "check-failed";
