/** Why the PDF reader could not open, prepare or read a document, or draw one of its pages. */
export const readerErrorCodes = ["open-failed", "encrypted", "text-failed", "render-failed", "unsupported-form", "prepare-failed"] as const;

export type ReaderErrorCode = (typeof readerErrorCodes)[number];

/** Why the PDF writer could not write a cleaned file, or the cleaned file failed its check. */
export const writerErrorCodes = ["apply-failed", "check-failed", "mark-lost", "extra-text-removed", "text-moved", "partly-covered-drawing"] as const;

export type WriterErrorCode = (typeof writerErrorCodes)[number];

/** Why a run of Auto mode ended as failed. */
export const detectionErrorCodes = ["detector-not-started", "recognizer-failed", "detector-failed"] as const;

export type DetectionErrorCode = (typeof detectionErrorCodes)[number];
