// The messages between the UI and the PDF worker.
import type { Brand } from "../model/brand";
import { readerTag, type Appearance, type DocumentModel, type Edit, type PageText, type Pixels, type Reading, type ReaderTag, type RemovalKind, type Source } from "../model/document";
import { readerErrorCodes, writerErrorCodes } from "../model/errors";
import type { Box, PageIndex } from "../model/geometry";
import type { Found } from "../model/match";

/** Numbers each file the UI opens, starting at 1. */
export type FileNumber = Brand<number, "FileNumber">;

/** Numbers each file the UI asks the engine to prepare, starting at 1. */
export type PreparationNumber = Brand<number, "PreparationNumber">;

/** Numbers each search the UI asks the engine to run over documents' text, starting at 1. */
export type MatchNumber = Brand<number, "MatchNumber">;

export const isFileNumber = (value: unknown): value is FileNumber =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

export const isPreparationNumber = (value: unknown): value is PreparationNumber =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

/**
 * How this build prepares and reads PDFs, its MuPDF build included. It changes on any change to
 * preparation, to reading, or to vendor/mupdf's patches or SHA256SUMS. The worker's `ready` says it
 * too, so a worker of another build is never used.
 */
export const READER_TAG: ReaderTag = readerTag("pdf-3");

export const isMatchNumber = (value: unknown): value is MatchNumber =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

// `file` numbers each file the UI opens; the worker echoes it in every reply so
// the UI can drop a reply about a file the user has since replaced.
// A preparation makes a document's working copy from the file the user picked, reads its text
// and images, and keeps nothing. `open` takes a working copy. A match searches documents' text for keys (engine/model/match.ts), each document
// given as each page's characters.
export type PdfRequest =
  | { readonly type: "prepare"; readonly preparation: PreparationNumber; readonly bytes: ArrayBuffer }
  | {
      readonly type: "match";
      readonly match: MatchNumber;
      readonly keys: readonly string[];
      readonly documents: readonly (readonly (readonly string[])[])[];
    }
  | { readonly type: "open"; readonly file: FileNumber; readonly bytes: ArrayBuffer }
  | {
      readonly type: "render";
      readonly file: FileNumber;
      readonly source: Source;
      readonly page: PageIndex;
      readonly scale: number;
    }
  | { readonly type: "text"; readonly file: FileNumber; readonly page: PageIndex }
  | {
      readonly type: "apply";
      readonly file: FileNumber;
      readonly edits: readonly Edit[];
      readonly appearance: Appearance;
    };

export const engineErrorCodes = [...readerErrorCodes, ...writerErrorCodes, "bad-message"] as const;

/** Where a refusal applies, never what the document says. */
export type PdfErrorData = {
  readonly page?: PageIndex;
  readonly boxes?: readonly Box[];
};

export interface PdfError {
  readonly code: (typeof engineErrorCodes)[number];
  /** A sentence the worker composed; a code with none has the app's own. */
  readonly message?: string;
  readonly data?: PdfErrorData;
}

/** A key found in one of the documents a match searched, which it names by index. */
export interface DocumentFound extends Found {
  readonly document: number;
  readonly page: PageIndex;
}

export type PdfReply =
  | { readonly type: "ready"; readonly readerTag: ReaderTag }
  | {
      readonly type: "prepared";
      readonly preparation: PreparationNumber;
      /** The working copy. */
      readonly preparedBytes: ArrayBuffer;
      readonly reading: Reading;
      /** Sorted, with no repeats. */
      readonly removed: readonly RemovalKind[];
    }
  | { readonly type: "matched"; readonly match: MatchNumber; readonly found: readonly DocumentFound[] }
  | { readonly type: "refused"; readonly preparation: PreparationNumber; readonly error: PdfError }
  | { readonly type: "opened"; readonly file: FileNumber; readonly document: DocumentModel }
  | {
      readonly type: "rendered";
      readonly file: FileNumber;
      readonly source: Source;
      readonly page: PageIndex;
      readonly image: Pixels;
    }
  | { readonly type: "text"; readonly file: FileNumber; readonly page: PageIndex; readonly text: PageText }
  // Sent only when the output passed every check; otherwise an error with the refusal's code.
  | { readonly type: "applied"; readonly file: FileNumber; readonly bytes: ArrayBuffer; readonly output: DocumentModel }
  // `file` is undefined only for a request the worker could not read.
  | { readonly type: "error"; readonly file: FileNumber | undefined; readonly error: PdfError };
