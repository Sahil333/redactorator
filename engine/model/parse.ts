import { removalKinds, type Appearance, type DocumentModel, type Edit, type PageChar, type PageModel, type PageText, type PlacedImage, type Reading, type RemovalKind } from "./document";
import { isMatrix, isPageIndex, isPoints, parseBox } from "./geometry";
import { isOffset, isPositiveNumber, isRecord, parseAll } from "./guards";

const isColour = (value: unknown): value is string => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);

export function parseEdit(value: unknown): Edit | undefined {
  if (!isRecord(value) || !isPageIndex(value.page) || typeof value.label !== "string") return undefined;
  const { page, label } = value;
  if (value.kind === "text" && isOffset(value.start) && isOffset(value.end) && value.start < value.end && typeof value.text === "string") {
    return { kind: "text", page, start: value.start, end: value.end, text: value.text, label };
  }
  const box = value.kind === "box" ? parseBox(value.box) : undefined;
  return box && { kind: "box", page, box, label };
}

export function parseAppearance(value: unknown): Appearance | undefined {
  if (!isRecord(value) || !isColour(value.colour) || typeof value.label !== "boolean") return undefined;
  return { colour: value.colour, label: value.label };
}

function parsePageModel(value: unknown): PageModel | undefined {
  if (!isRecord(value)) return undefined;
  const { index, width, height } = value;
  if (!isPageIndex(index) || !isPoints(width) || !isPoints(height) || width <= 0 || height <= 0) return undefined;
  return { index, width, height };
}

export function parseDocumentModel(value: unknown): DocumentModel | undefined {
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

export function parsePageText(value: unknown): PageText | undefined {
  const chars = isRecord(value) ? parseAll(value.chars, parsePageChar) : undefined;
  return chars && { chars };
}

export const isFingerprint = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{16}$/.test(value);

export function parsePlacedImage(value: unknown): PlacedImage | undefined {
  if (!isRecord(value)) return undefined;
  const { page, matrix, aspect, fingerprint } = value;
  return isPageIndex(page) && isMatrix(matrix) && isPositiveNumber(aspect) && isFingerprint(fingerprint)
    ? { page, matrix, aspect, fingerprint }
    : undefined;
}

export function parseReading(value: unknown): Reading | undefined {
  if (!isRecord(value)) return undefined;
  const [first, ...rest] = parseAll(value.texts, parsePageText) ?? [];
  const images = parseAll(value.images, parsePlacedImage);
  return first && images && { texts: [first, ...rest], images };
}

export const parseRemovalKind = (value: unknown): RemovalKind | undefined => removalKinds.find((kind) => kind === value);
