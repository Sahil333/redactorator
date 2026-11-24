import type { Source } from "../model/document";
import { isPageIndex } from "../model/geometry";
import { isOffset, isPositiveNumber, isRecord, isText, parseAll } from "../model/guards";
import { parseAppearance, parseDocumentModel, parseEdit, parsePageText, parseReading } from "../model/parse";
import {
  engineErrorCodes,
  isFileNumber,
  isInspectionNumber,
  isMatchNumber,
  type DocumentFound,
  type FileNumber,
  type PdfError,
  type PdfReply,
  type PdfRequest,
  type Pixels,
} from "./messages";

const isSource = (value: unknown): value is Source => value === "original" || value === "output";

function parseInspectRequest({ inspection, bytes }: Record<string, unknown>): PdfRequest | undefined {
  return isInspectionNumber(inspection) && bytes instanceof ArrayBuffer ? { type: "inspect", inspection, bytes } : undefined;
}

function parseMatchRequest({ match, keys, documents }: Record<string, unknown>): PdfRequest | undefined {
  const parsedKeys = parseAll(keys, (key) => (isText(key) ? key : undefined));
  const parsedDocuments = parseAll(documents, (pages) => parseAll(pages, (chars) => parseAll(chars, (c) => (isText(c) ? c : undefined))));
  return isMatchNumber(match) && parsedKeys && parsedDocuments
    ? { type: "match", match, keys: parsedKeys, documents: parsedDocuments }
    : undefined;
}

export function parsePdfRequest(data: unknown): PdfRequest | undefined {
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

function parseFound(value: unknown): DocumentFound | undefined {
  if (!isRecord(value)) return undefined;
  const { document, key, page, start, end } = value;
  return isOffset(document) && isOffset(key) && isPageIndex(page) && isOffset(start) && isOffset(end) && start < end
    ? { document, key, page, start, end }
    : undefined;
}

function parseEngineError(value: unknown): PdfError | undefined {
  if (!isRecord(value) || typeof value.message !== "string") return undefined;
  const code = engineErrorCodes.find((known) => known === value.code);
  return code && { code, message: value.message };
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

/** An answer to an inspection: `inspected` or `refused`. */
function parseInspectionMessage(data: Record<string, unknown>): PdfReply | undefined {
  const { inspection } = data;
  if (!isInspectionNumber(inspection)) return undefined;
  if (data.type === "inspected") {
    const reading = parseReading(data.reading);
    return reading && { type: "inspected", inspection, reading };
  }
  const error = parseEngineError(data.error);
  return error && { type: "refused", inspection, error };
}

export function parsePdfReply(data: unknown): PdfReply | undefined {
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
