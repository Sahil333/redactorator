// The engine's shared types and the messages between the UI and the engine worker.
import type { Found } from "./match";

declare const brand: unique symbol;
type Brand<T, Name extends string> = T & { readonly [brand]: Name };

/** Zero-based page index. A page number shown to a user is this plus one. */
export type PageIndex = Brand<number, "PageIndex">;

/**
 * A length in PDF points in MuPDF's page space: origin top-left, y grows down,
 * page rotation and crop box already applied. Every box in the engine uses it.
 */
export type Points = Brand<number, "Points">;

/** Numbers each file the UI opens, starting at 1. */
export type FileNumber = Brand<number, "FileNumber">;

/** Numbers each file the UI asks the engine to inspect before adding it, starting at 1. */
export type InspectionNumber = Brand<number, "InspectionNumber">;

/** Numbers each search the UI asks the engine to run over documents' text, starting at 1. */
export type MatchNumber = Brand<number, "MatchNumber">;

export const isPageIndex = (value: unknown): value is PageIndex =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

export const isPoints = (value: unknown): value is Points => typeof value === "number" && Number.isFinite(value);

/** A box from four coordinates, or undefined when one is not a finite number. */
export const pointBox = (x0: number, y0: number, x1: number, y1: number): Box | undefined =>
  isPoints(x0) && isPoints(y0) && isPoints(x1) && isPoints(y1) ? { x0, y0, x1, y1 } : undefined;

/** A rectangle in the engine's box convention (see `Points`). */
export interface Box {
  readonly x0: Points;
  readonly y0: Points;
  readonly x1: Points;
  readonly y1: Points;
}

/** RED-6: the colour of each redaction box, as `#rrggbb`, and whether it carries a `[TYPE]` label. */
export interface Appearance {
  readonly colour: string;
  readonly label: boolean;
}

export interface PageModel {
  readonly index: PageIndex;
  readonly width: Points;
  readonly height: Points;
}

export interface DocumentModel {
  readonly pages: readonly [PageModel, ...PageModel[]];
}

/**
 * One character of a page's text: MuPDF's structured-text blocks and lines, put in
 * reading order by `readingOrder` (engine/pageText.ts). A line ends with a "\n"
 * entry and a block with a second one; those have no box. Lines and blocks with no
 * characters add nothing. A character's
 * index in `PageText.chars` is its offset, as the ground-truth schema counts them.
 */
export type PageChar = { readonly c: string; readonly box: Box } | { readonly c: "\n"; readonly box: undefined };

export interface PageText {
  readonly chars: readonly PageChar[];
}

/** [a, b, c, d, e, f]: takes (x, y) to (a x + c y + e, b x + d y + f). */
export type Matrix = readonly [number, number, number, number, number, number];

/**
 * An image drawn on a page, which a box over it can spread from or to. Images too small, too
 * plain, or filling most of their page to be told apart from others are not listed.
 */
export interface PlacedImage {
  readonly page: PageIndex;
  /** Places the image's unit square in page space (see `Points`), its first row of pixels at y = 0. */
  readonly matrix: Matrix;
  /** Its width over its height, in pixels. */
  readonly aspect: number;
  /**
   * A difference hash of a 9 × 8 grey copy, 64 bits as 16 hex digits: whether each cell is
   * darker than the next one along. Copies at any size, or saved again, share most bits.
   */
  readonly fingerprint: string;
}

/** What the engine reads from a document for the project to keep: each page's text and its images. */
export interface Reading {
  readonly texts: readonly [PageText, ...PageText[]];
  readonly images: readonly PlacedImage[];
}

/** What the user marked: a range of a page's text, or a box with no text behind it. */
export type Edit =
  | { readonly kind: "text"; readonly page: PageIndex; readonly start: number; readonly end: number; readonly label: string }
  | { readonly kind: "box"; readonly page: PageIndex; readonly box: Box; readonly label: string };

/** Which document a render reads: the file the user opened, or the cleaned output. */
export type Source = "original" | "output";

// `file` numbers each file the UI opens; the worker echoes it in every reply so
// the UI can drop a reply about a file the user has since replaced.
// An inspection opens a file only to say whether it can be added and to read its text and
// images, and keeps nothing. A match searches documents' text for keys (engine/match.ts), each document
// given as each page's characters.
export type EngineRequest =
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

const engineErrorCodes = [
  "open-failed",
  "encrypted",
  "render-failed",
  "text-failed",
  "apply-failed",
  "check-failed",
  "bad-message",
] as const;

export interface EngineError {
  readonly code: (typeof engineErrorCodes)[number];
  readonly message: string;
}

/** A key found in one of the documents a match searched, which it names by index. */
export interface DocumentFound extends Found {
  readonly document: number;
  readonly page: PageIndex;
}

export type EngineMessage =
  | { readonly type: "ready" }
  | { readonly type: "inspected"; readonly inspection: InspectionNumber; readonly reading: Reading }
  | { readonly type: "matched"; readonly match: MatchNumber; readonly found: readonly DocumentFound[] }
  | { readonly type: "refused"; readonly inspection: InspectionNumber; readonly error: EngineError }
  | { readonly type: "opened"; readonly file: FileNumber; readonly document: DocumentModel }
  | {
      readonly type: "rendered";
      readonly file: FileNumber;
      readonly source: Source;
      readonly page: PageIndex;
      readonly image: ImageData;
    }
  | { readonly type: "text"; readonly file: FileNumber; readonly page: PageIndex; readonly text: PageText }
  // Sent only when the output passed every check; otherwise an error with code check-failed.
  | { readonly type: "applied"; readonly file: FileNumber; readonly bytes: ArrayBuffer; readonly output: DocumentModel }
  // `file` is undefined only for a request the worker could not read.
  | { readonly type: "error"; readonly file: FileNumber | undefined; readonly error: EngineError };

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const isPositiveNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

export const isOffset = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

export const isFileNumber = (value: unknown): value is FileNumber =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

export const isInspectionNumber = (value: unknown): value is InspectionNumber =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

export const isMatchNumber = (value: unknown): value is MatchNumber =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

const isSource = (value: unknown): value is Source => value === "original" || value === "output";

const isColour = (value: unknown): value is string => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);

export function parseBox(value: unknown): Box | undefined {
  if (!isRecord(value)) return undefined;
  const { x0, y0, x1, y1 } = value;
  if (!isPoints(x0) || !isPoints(y0) || !isPoints(x1) || !isPoints(y1) || x0 > x1 || y0 > y1) return undefined;
  return { x0, y0, x1, y1 };
}

function parseEdit(value: unknown): Edit | undefined {
  if (!isRecord(value) || !isPageIndex(value.page) || typeof value.label !== "string") return undefined;
  const { page, label } = value;
  if (value.kind === "text" && isOffset(value.start) && isOffset(value.end) && value.start < value.end) {
    return { kind: "text", page, start: value.start, end: value.end, label };
  }
  const box = value.kind === "box" ? parseBox(value.box) : undefined;
  return box && { kind: "box", page, box, label };
}

export function parseAppearance(value: unknown): Appearance | undefined {
  if (!isRecord(value) || !isColour(value.colour) || typeof value.label !== "boolean") return undefined;
  return { colour: value.colour, label: value.label };
}

export function parseAll<T>(values: unknown, parse: (value: unknown) => T | undefined): T[] | undefined {
  if (!Array.isArray(values)) return undefined;
  const parsed: T[] = [];
  for (const value of values) {
    const one = parse(value);
    if (one === undefined) return undefined;
    parsed.push(one);
  }
  return parsed;
}

function parseInspectRequest({ inspection, bytes }: Record<string, unknown>): EngineRequest | undefined {
  return isInspectionNumber(inspection) && bytes instanceof ArrayBuffer ? { type: "inspect", inspection, bytes } : undefined;
}

export const isText = (value: unknown): value is string => typeof value === "string";

function parseMatchRequest({ match, keys, documents }: Record<string, unknown>): EngineRequest | undefined {
  const parsedKeys = parseAll(keys, (key) => (isText(key) ? key : undefined));
  const parsedDocuments = parseAll(documents, (pages) => parseAll(pages, (chars) => parseAll(chars, (c) => (isText(c) ? c : undefined))));
  return isMatchNumber(match) && parsedKeys && parsedDocuments
    ? { type: "match", match, keys: parsedKeys, documents: parsedDocuments }
    : undefined;
}

export function parseEngineRequest(data: unknown): EngineRequest | undefined {
  if (isRecord(data) && data.type === "inspect") return parseInspectRequest(data);
  if (isRecord(data) && data.type === "match") return parseMatchRequest(data);
  if (!isRecord(data) || !isFileNumber(data.file)) return undefined;
  const { file } = data;
  switch (data.type) {
    case "open":
      return data.bytes instanceof ArrayBuffer ? { type: "open", file, bytes: data.bytes } : undefined;
    case "render":
      return isSource(data.source) && isPageIndex(data.page) && isPositiveNumber(data.scale)
        ? { type: "render", file, source: data.source, page: data.page, scale: data.scale }
        : undefined;
    case "text":
      return isPageIndex(data.page) ? { type: "text", file, page: data.page } : undefined;
    case "apply": {
      const edits = parseAll(data.edits, parseEdit);
      const appearance = parseAppearance(data.appearance);
      return edits && appearance && { type: "apply", file, edits, appearance };
    }
    default:
      return undefined;
  }
}

function parsePageModel(value: unknown): PageModel | undefined {
  if (!isRecord(value)) return undefined;
  const { index, width, height } = value;
  if (!isPageIndex(index) || !isPoints(width) || !isPoints(height) || width <= 0 || height <= 0) return undefined;
  return { index, width, height };
}

function parseDocumentModel(value: unknown): DocumentModel | undefined {
  const pages = isRecord(value) ? parseAll(value.pages, parsePageModel) : undefined;
  const [first, ...rest] = pages ?? [];
  return first && { pages: [first, ...rest] };
}

function parsePageChar(value: unknown): PageChar | undefined {
  if (!isRecord(value) || typeof value.c !== "string") return undefined;
  if (value.c === "\n") return value.box === undefined ? { c: "\n", box: undefined } : undefined;
  const box = parseBox(value.box);
  return box && { c: value.c, box };
}

function parsePageText(value: unknown): PageText | undefined {
  const chars = isRecord(value) ? parseAll(value.chars, parsePageChar) : undefined;
  return chars && { chars };
}

const isMatrix = (value: unknown): value is Matrix =>
  Array.isArray(value) && value.length === 6 && value.every((n) => typeof n === "number" && Number.isFinite(n));

export const isFingerprint = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{16}$/.test(value);

export function parsePlacedImage(value: unknown): PlacedImage | undefined {
  if (!isRecord(value)) return undefined;
  const { page, matrix, aspect, fingerprint } = value;
  return isPageIndex(page) && isMatrix(matrix) && isPositiveNumber(aspect) && isFingerprint(fingerprint)
    ? { page, matrix, aspect, fingerprint }
    : undefined;
}

function parseReading(value: unknown): Reading | undefined {
  if (!isRecord(value)) return undefined;
  const [first, ...rest] = parseAll(value.texts, parsePageText) ?? [];
  const images = parseAll(value.images, parsePlacedImage);
  return first && images && { texts: [first, ...rest], images };
}

function parseFound(value: unknown): DocumentFound | undefined {
  if (!isRecord(value)) return undefined;
  const { document, key, page, start, end } = value;
  return isOffset(document) && isOffset(key) && isPageIndex(page) && isOffset(start) && isOffset(end) && start < end
    ? { document, key, page, start, end }
    : undefined;
}

function parseEngineError(value: unknown): EngineError | undefined {
  if (!isRecord(value) || typeof value.message !== "string") return undefined;
  const code = engineErrorCodes.find((known) => known === value.code);
  return code && { code, message: value.message };
}

/** A reply about one open file: everything but `ready` and `error`. */
function parseFileMessage(data: Record<string, unknown>, file: FileNumber): EngineMessage | undefined {
  switch (data.type) {
    case "opened": {
      const document = parseDocumentModel(data.document);
      return document && { type: "opened", file, document };
    }
    case "rendered":
      return isSource(data.source) && isPageIndex(data.page) && data.image instanceof ImageData
        ? { type: "rendered", file, source: data.source, page: data.page, image: data.image }
        : undefined;
    case "text": {
      const text = parsePageText(data.text);
      return text && isPageIndex(data.page) ? { type: "text", file, page: data.page, text } : undefined;
    }
    case "applied": {
      const output = parseDocumentModel(data.output);
      return output && data.bytes instanceof ArrayBuffer
        ? { type: "applied", file, bytes: data.bytes, output }
        : undefined;
    }
    default:
      return undefined;
  }
}

/** An answer to an inspection: `inspected` or `refused`. */
function parseInspectionMessage(data: Record<string, unknown>): EngineMessage | undefined {
  const { inspection } = data;
  if (!isInspectionNumber(inspection)) return undefined;
  if (data.type === "inspected") {
    const reading = parseReading(data.reading);
    return reading && { type: "inspected", inspection, reading };
  }
  const error = parseEngineError(data.error);
  return error && { type: "refused", inspection, error };
}

export function parseEngineMessage(data: unknown): EngineMessage | undefined {
  if (!isRecord(data)) return undefined;
  const { file } = data;
  if (data.type === "ready") return { type: "ready" };
  if (data.type === "inspected" || data.type === "refused") return parseInspectionMessage(data);
  if (data.type === "matched") {
    const found = parseAll(data.found, parseFound);
    return found && isMatchNumber(data.match) ? { type: "matched", match: data.match, found } : undefined;
  }
  if (data.type === "error") {
    const error = parseEngineError(data.error);
    return error && (file === undefined || isFileNumber(file)) ? { type: "error", file, error } : undefined;
  }
  return isFileNumber(file) ? parseFileMessage(data, file) : undefined;
}

export const isAboutOlderFile = (message: EngineMessage, latestFile: number): boolean =>
  "file" in message && message.file !== undefined && message.file !== latestFile;
