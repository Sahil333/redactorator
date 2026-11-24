// The messages between the UI and the PDF worker.
import type { Brand } from "../model/brand";
import type { Appearance, DocumentModel, Edit, PageText, Pixels, Reading, Source } from "../model/document";
import type { ReaderErrorCode, WriterErrorCode } from "../model/errors";
import type { PageIndex } from "../model/geometry";
import type { Found } from "../model/match";

/** Numbers each file the UI opens, starting at 1. */
export type FileNumber = Brand<number, "FileNumber">;

/** Numbers each file the UI asks the engine to inspect before adding it, starting at 1. */
export type InspectionNumber = Brand<number, "InspectionNumber">;

/** Numbers each search the UI asks the engine to run over documents' text, starting at 1. */
export type MatchNumber = Brand<number, "MatchNumber">;

export const isFileNumber = (value: unknown): value is FileNumber =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

export const isInspectionNumber = (value: unknown): value is InspectionNumber =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

export const isMatchNumber = (value: unknown): value is MatchNumber =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

// `file` numbers each file the UI opens; the worker echoes it in every reply so
// the UI can drop a reply about a file the user has since replaced.
// An inspection opens a file only to say whether it can be added and to read its text and
// images, and keeps nothing. A match searches documents' text for keys (engine/model/match.ts), each document
// given as each page's characters.
export type PdfRequest =
  | { readonly type: "inspect"; readonly inspection: InspectionNumber; readonly bytes: ArrayBuffer }
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

export const engineErrorCodes = [
  "open-failed",
  "encrypted",
  "render-failed",
  "text-failed",
  "apply-failed",
  "check-failed",
  "bad-message",
] as const satisfies readonly (ReaderErrorCode | WriterErrorCode | "bad-message")[];

export interface PdfError {
  readonly code: (typeof engineErrorCodes)[number];
  readonly message: string;
}

/** A key found in one of the documents a match searched, which it names by index. */
export interface DocumentFound extends Found {
  readonly document: number;
  readonly page: PageIndex;
}

export type PdfReply =
  | { readonly type: "ready" }
  | { readonly type: "inspected"; readonly inspection: InspectionNumber; readonly reading: Reading }
  | { readonly type: "matched"; readonly match: MatchNumber; readonly found: readonly DocumentFound[] }
  | { readonly type: "refused"; readonly inspection: InspectionNumber; readonly error: PdfError }
  | { readonly type: "opened"; readonly file: FileNumber; readonly document: DocumentModel }
  | {
      readonly type: "rendered";
      readonly file: FileNumber;
      readonly source: Source;
      readonly page: PageIndex;
      readonly image: Pixels;
    }
  | { readonly type: "text"; readonly file: FileNumber; readonly page: PageIndex; readonly text: PageText }
  // Sent only when the output passed every check; otherwise an error with code check-failed.
  | { readonly type: "applied"; readonly file: FileNumber; readonly bytes: ArrayBuffer; readonly output: DocumentModel }
  // `file` is undefined only for a request the worker could not read.
  | { readonly type: "error"; readonly file: FileNumber | undefined; readonly error: PdfError };
