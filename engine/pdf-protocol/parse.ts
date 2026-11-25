import { isReaderTag, type Pixels, type Source } from "../model/document";
import { isPageIndex, parseBox } from "../model/geometry";
import { isOffset, isPositiveNumber, isRecord, isText, parseAll } from "../model/guards";
import { parseAppearance, parseDocumentModel, parseEdit, parsePageText, parseReading, parseRemovalKind } from "../model/parse";
import {
  engineErrorCodes,
  isFileNumber,
  isMatchNumber,
  isPreparationNumber,
  type DocumentFound,
  type FileNumber,
  type PdfError,
  type PdfErrorData,
  type PdfReply,
  type PdfRequest,
} from "./messages";

const isSource = (value: unknown): value is Source => value === "original" || value === "output";

function parsePrepareRequest({ preparation, bytes }: Record<string, unknown>): PdfRequest | undefined {
  return isPreparationNumber(preparation) && bytes instanceof ArrayBuffer ? { type: "prepare", preparation, bytes } : undefined;
}

function parseMatchRequest({ match, keys, documents }: Record<string, unknown>): PdfRequest | undefined {
  const parsedKeys = parseAll(keys, (key) => (isText(key) ? key : undefined));
  const parsedDocuments = parseAll(documents, (pages) => parseAll(pages, (chars) => parseAll(chars, (c) => (isText(c) ? c : undefined))));
  return isMatchNumber(match) && parsedKeys && parsedDocuments
    ? { type: "match", match, keys: parsedKeys, documents: parsedDocuments }
    : undefined;
}

export function parsePdfRequest(data: unknown): PdfRequest | undefined {
  if (isRecord(data) && data.type === "prepare") return parsePrepareRequest(data);
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

function parseFound(value: unknown): DocumentFound | undefined {
  if (!isRecord(value)) return undefined;
  const { document, key, page, start, end } = value;
  return isOffset(document) && isOffset(key) && isPageIndex(page) && isOffset(start) && isOffset(end) && start < end
    ? { document, key, page, start, end }
    : undefined;
}

const DATA_KEYS = new Set(["page", "boxes"]);

/** A refusal's data: only a page and boxes, so no document text can ride along. */
function parseErrorData(value: unknown): PdfErrorData | undefined {
  if (!isRecord(value) || Object.keys(value).some((key) => !DATA_KEYS.has(key))) return undefined;
  const page = value.page === undefined || isPageIndex(value.page) ? value.page : null;
  const boxes = value.boxes === undefined ? undefined : (parseAll(value.boxes, parseBox) ?? null);
  if (page === null || boxes === null) return undefined;
  return { ...(page === undefined ? {} : { page }), ...(boxes === undefined ? {} : { boxes }) };
}

function parseEngineError(value: unknown): PdfError | undefined {
  if (!isRecord(value) || (value.message !== undefined && typeof value.message !== "string")) return undefined;
  const code = engineErrorCodes.find((known) => known === value.code);
  const data = value.data === undefined ? undefined : parseErrorData(value.data);
  if (code === undefined || (value.data !== undefined && data === undefined)) return undefined;
  return { code, ...(value.message === undefined ? {} : { message: value.message }), ...(data === undefined ? {} : { data }) };
}

const isPixelCount = (value: unknown): value is number => isPositiveNumber(value) && Number.isInteger(value);

const isRgba = (value: unknown): value is Uint8ClampedArray<ArrayBuffer> =>
  value instanceof Uint8ClampedArray && value.buffer instanceof ArrayBuffer;

function parsePixels(value: unknown): Pixels | undefined {
  if (!isRecord(value)) return undefined;
  const { width, height, rgba } = value;
  return isPixelCount(width) && isPixelCount(height) && isRgba(rgba) && rgba.length === width * height * 4
    ? { width, height, rgba }
    : undefined;
}

/** A reply about one open file: everything but `ready` and `error`. */
function parseFileMessage(data: Record<string, unknown>, file: FileNumber): PdfReply | undefined {
  switch (data.type) {
    case "opened": {
      const document = parseDocumentModel(data.document);
      return document && { type: "opened", file, document };
    }
    case "rendered": {
      const image = parsePixels(data.image);
      return image && isSource(data.source) && isPageIndex(data.page)
        ? { type: "rendered", file, source: data.source, page: data.page, image }
        : undefined;
    }
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

/** An answer to a preparation: `prepared` or `refused`. */
function parsePreparationMessage(data: Record<string, unknown>): PdfReply | undefined {
  const { preparation, preparedBytes } = data;
  if (!isPreparationNumber(preparation)) return undefined;
  if (data.type === "prepared") {
    const reading = parseReading(data.reading);
    const removed = parseAll(data.removed, parseRemovalKind);
    return reading && removed && preparedBytes instanceof ArrayBuffer ? { type: "prepared", preparation, preparedBytes, reading, removed } : undefined;
  }
  const error = parseEngineError(data.error);
  return error && { type: "refused", preparation, error };
}

/** A reply that names no file it is about: `ready`, `matched`, or an `error`, which may name one. */
function parseEngineMessage(data: Record<string, unknown>): PdfReply | undefined {
  const { file } = data;
  switch (data.type) {
    case "ready":
      return isReaderTag(data.readerTag) ? { type: "ready", readerTag: data.readerTag } : undefined;
    case "matched": {
      const found = parseAll(data.found, parseFound);
      return found && isMatchNumber(data.match) ? { type: "matched", match: data.match, found } : undefined;
    }
    default: {
      const error = parseEngineError(data.error);
      return error && (file === undefined || isFileNumber(file)) ? { type: "error", file, error } : undefined;
    }
  }
}

export function parsePdfReply(data: unknown): PdfReply | undefined {
  if (!isRecord(data)) return undefined;
  if (data.type === "ready" || data.type === "matched" || data.type === "error") return parseEngineMessage(data);
  if (data.type === "prepared" || data.type === "refused") return parsePreparationMessage(data);
  return isFileNumber(data.file) ? parseFileMessage(data, data.file) : undefined;
}
