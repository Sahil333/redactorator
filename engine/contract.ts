// The engine's shared types and the messages between the UI and the engine worker.

declare const brand: unique symbol;
type Brand<T, Name extends string> = T & { readonly [brand]: Name };

/** Zero-based page index. A page number shown to a user is this plus one. */
export type PageIndex = Brand<number, "PageIndex">;

/**
 * A length in PDF points in MuPDF's page space: origin top-left, y grows down,
 * page rotation and crop box already applied. Every box in the engine uses it.
 */
export type Points = Brand<number, "Points">;

export const isPageIndex = (value: unknown): value is PageIndex =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

export const isPoints = (value: unknown): value is Points =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

export interface PageModel {
  readonly index: PageIndex;
  readonly width: Points;
  readonly height: Points;
}

export interface DocumentModel {
  readonly pages: readonly [PageModel, ...PageModel[]];
}

// `file` numbers each file the UI opens; the worker echoes it in every reply so
// the UI can drop a reply about a file the user has since replaced.
export type EngineRequest =
  | { readonly type: "open"; readonly file: number; readonly bytes: ArrayBuffer }
  | { readonly type: "render"; readonly file: number; readonly page: PageIndex; readonly scale: number };

const engineErrorCodes = ["open-failed", "render-failed", "bad-message"] as const;

export interface EngineError {
  readonly code: (typeof engineErrorCodes)[number];
  readonly message: string;
}

export type EngineMessage =
  | { readonly type: "ready" }
  | { readonly type: "opened"; readonly file: number; readonly document: DocumentModel }
  | { readonly type: "rendered"; readonly file: number; readonly page: PageIndex; readonly image: ImageData }
  // `file` is undefined only for a request the worker could not read.
  | { readonly type: "error"; readonly file: number | undefined; readonly error: EngineError };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isPositiveNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const isFileNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

export function parseEngineRequest(data: unknown): EngineRequest | undefined {
  if (!isRecord(data) || !isFileNumber(data.file)) return undefined;
  const { file } = data;
  if (data.type === "open" && data.bytes instanceof ArrayBuffer) {
    return { type: "open", file, bytes: data.bytes };
  }
  if (data.type === "render" && isPageIndex(data.page) && isPositiveNumber(data.scale)) {
    return { type: "render", file, page: data.page, scale: data.scale };
  }
  return undefined;
}

function parsePageModel(value: unknown): PageModel | undefined {
  if (!isRecord(value)) return undefined;
  const { index, width, height } = value;
  if (!isPageIndex(index) || !isPoints(width) || !isPoints(height)) return undefined;
  return { index, width, height };
}

function parseDocumentModel(value: unknown): DocumentModel | undefined {
  if (!isRecord(value) || !Array.isArray(value.pages)) return undefined;
  const pages: PageModel[] = [];
  for (const page of value.pages) {
    const model = parsePageModel(page);
    if (model === undefined) return undefined;
    pages.push(model);
  }
  const [first, ...rest] = pages;
  return first && { pages: [first, ...rest] };
}

function parseEngineError(value: unknown): EngineError | undefined {
  if (!isRecord(value) || typeof value.message !== "string") return undefined;
  const code = engineErrorCodes.find((known) => known === value.code);
  return code && { code, message: value.message };
}

export function parseEngineMessage(data: unknown): EngineMessage | undefined {
  if (!isRecord(data)) return undefined;
  const { file } = data;
  switch (data.type) {
    case "ready":
      return { type: "ready" };
    case "opened": {
      const document = parseDocumentModel(data.document);
      return isFileNumber(file) && document ? { type: "opened", file, document } : undefined;
    }
    case "rendered":
      return isFileNumber(file) && isPageIndex(data.page) && data.image instanceof ImageData
        ? { type: "rendered", file, page: data.page, image: data.image }
        : undefined;
    case "error": {
      const error = parseEngineError(data.error);
      return error && (file === undefined || isFileNumber(file)) ? { type: "error", file, error } : undefined;
    }
    default:
      return undefined;
  }
}

/** True for a reply about a file the user has since replaced. */
export const isAboutOlderFile = (message: EngineMessage, latestFile: number): boolean =>
  message.type !== "ready" && message.file !== undefined && message.file !== latestFile;
