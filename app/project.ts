// The stored formats: a project's `project.json`, the text of each of its documents, and the
// app's `settings.json`. All are read from storage the user's browser keeps across app
// versions, so each carries a version and is checked whole when read.
import type { Appearance, PageChar, PageText, PlacedImage } from "../engine/model/document";
import { isPageIndex, parseBox, pointBox } from "../engine/model/geometry";
import { isOffset, isPositiveNumber, isRecord, isText, parseAll } from "../engine/model/guards";
import { isFingerprint, parseAppearance, parsePlacedImage } from "../engine/model/parse";
import type { ImageAnchor } from "../engine/model/images";
import type { Mark, MarkTarget, TextPiece } from "./marks";
import type { MarkType } from "../engine/model/markTypes";

declare const brand: unique symbol;

/** Names one document in a project. */
export type DocumentId = string & { readonly [brand]: "DocumentId" };

const isDocumentId = (value: unknown): value is DocumentId => typeof value === "string" && value !== "";

export const newDocumentId = (): DocumentId => {
  const id = crypto.randomUUID();
  if (!isDocumentId(id)) throw new Error("No id");
  return id;
};

const reviewStates = ["not-started", "in-review", "approved"] as const;
/** How far the user has got in checking a document's marks. A mark puts it in review. */
export type ReviewState = (typeof reviewStates)[number];

const downloadStates = ["none", "downloaded", "changed"] as const;
/**
 * Whether a cleaned file has been downloaded from this project, and whether its marks have
 * changed since. A browser can't tell where the download went, or whether it is still there.
 */
export type DownloadState = (typeof downloadStates)[number];

export interface ProjectDocument {
  readonly id: DocumentId;
  /** The original's file name in the project folder. */
  readonly file: string;
  readonly sha256: string;
  readonly pages: number;
  readonly marks: readonly Mark[];
  readonly review: ReviewState;
  readonly download: DownloadState;
  /** Keys of hidden values the user chose not to hide in this document ("Don't hide here"). */
  readonly shown: readonly string[];
}

/**
 * A value, or a part of an image, hidden in every document of the project; set when a document
 * that marks it is approved.
 */
export interface HiddenValue {
  /** A value's normalised form (engine/model/match.ts), which every spelling of it shares, or an image part's key (engine/model/images.ts). */
  readonly key: string;
  /** As it was marked, to show. */
  readonly text: string;
  readonly type: MarkType;
  /** The document whose approval set it. */
  readonly from: DocumentId;
  /** For a part of an image: the image and the part. */
  readonly image?: ImageAnchor;
}

export interface Project {
  readonly id: string;
  readonly name: string;
  readonly created: string;
  readonly archived: boolean;
  readonly documents: readonly ProjectDocument[];
  readonly hidden: readonly HiddenValue[];
}

export interface Settings {
  readonly appearance: Appearance;
  /** Mark types the user typed in, by name, offered on every later mark. */
  readonly customTypes: readonly string[];
}

export const defaultSettings: Settings = { appearance: { colour: "#000000", label: false }, customTypes: [] };

const PROJECT_FORMAT = "redactorator-project";
const TEXT_FORMAT = "redactorator-text";
const IMAGES_FORMAT = "redactorator-images";
const SETTINGS_FORMAT = "redactorator-settings";
// Raise a version only with a migration from every earlier one in the parser below.
// Version 1 (phase 2 slice 1) had no review states and no hidden values; version 2 (slice 2) no
// image anchors, so its boxes are anchored when their document is next approved.
const PROJECT_VERSION = 3;
const TEXT_VERSION = 1;
const IMAGES_VERSION = 1;
const SETTINGS_VERSION = 1;

/** Why a stored file could not be used. Shown to the user. */
export type StoredFileProblem = "damaged" | "newer";

const oneOf = <T extends string>(options: readonly T[], value: unknown): T | undefined => options.find((option) => option === value);
const parseStrings = (value: unknown) => parseAll(value, (each) => (isText(each) ? each : undefined));

function parsePiece(value: unknown): TextPiece | undefined {
  if (!isRecord(value) || !isPageIndex(value.page) || !isOffset(value.start) || !isOffset(value.end)) return undefined;
  const boxes = parseAll(value.boxes, parseBox);
  return boxes && value.start < value.end ? { page: value.page, start: value.start, end: value.end, boxes } : undefined;
}

const isUnit = (value: unknown): value is number => typeof value === "number" && value >= 0 && value <= 1;

function parseFrame(value: unknown): ImageAnchor["frame"] | undefined {
  const units = parseAll(value, (n) => (isUnit(n) ? n : undefined));
  if (units?.length !== 4) return undefined;
  const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = units;
  return x0 <= x1 && y0 <= y1 ? [x0, y0, x1, y1] : undefined;
}

function parseAnchor(value: unknown): ImageAnchor | undefined {
  if (!isRecord(value) || !isFingerprint(value.fingerprint)) return undefined;
  const { aspect } = value;
  const frame = parseFrame(value.frame);
  return frame && isPositiveNumber(aspect) ? { fingerprint: value.fingerprint, aspect, frame } : undefined;
}

/** An optional image anchor: absent, or one that parses. */
function optionalAnchor(value: unknown): { image?: ImageAnchor } | undefined {
  if (value === undefined) return {};
  const image = parseAnchor(value);
  return image && { image };
}

function parseTarget(value: unknown): MarkTarget | undefined {
  if (!isRecord(value)) return undefined;
  if (value.kind === "box") {
    const box = parseBox(value.box);
    const anchor = optionalAnchor(value.image);
    return box && anchor && isPageIndex(value.page) ? { kind: "box", page: value.page, box, ...anchor } : undefined;
  }
  const [first, ...rest] = parseAll(value.pieces, parsePiece) ?? [];
  return value.kind === "text" && isText(value.text) && first ? { kind: "text", text: value.text, pieces: [first, ...rest] } : undefined;
}

function parseMark(value: unknown, version: number): Mark | undefined {
  if (!isRecord(value) || !isOffset(value.id) || !isText(value.type) || !isText(value.linkId)) return undefined;
  const target = parseTarget(value.target);
  // Version 1 had no spreading, so no mark was new.
  const isNew = version === 1 ? false : value.isNew;
  return target && typeof isNew === "boolean" ? { id: value.id, type: value.type, target, linkId: value.linkId, isNew } : undefined;
}

/** A document's review fields. Version 1 had none: its marks stay its own, and a marked document is in review. */
function parseReview(value: Record<string, unknown>, version: number, marks: readonly Mark[]) {
  if (version === 1) return { review: marks.length > 0 ? "in-review" : "not-started", download: "none", shown: [] } as const;
  const review = oneOf(reviewStates, value.review);
  const download = oneOf(downloadStates, value.download);
  const shown = parseStrings(value.shown);
  return review && download && shown && { review, download, shown };
}

function parseDocument(value: unknown, version: number): ProjectDocument | undefined {
  if (!isRecord(value) || !isDocumentId(value.id) || !isText(value.file) || !isText(value.sha256)) return undefined;
  const { pages } = value;
  const marks = parseAll(value.marks, (mark) => parseMark(mark, version));
  const review = marks && parseReview(value, version, marks);
  return marks && review && isOffset(pages) && pages > 0
    ? { id: value.id, file: value.file, sha256: value.sha256, pages, marks, ...review }
    : undefined;
}

function parseHiddenValue(value: unknown): HiddenValue | undefined {
  if (!isRecord(value)) return undefined;
  const { key, text, type, from } = value;
  const anchor = optionalAnchor(value.image);
  return anchor && isText(key) && key !== "" && isText(text) && isText(type) && isDocumentId(from) ? { key, text, type, from, ...anchor } : undefined;
}

/** The record inside a stored file of `format`, and its version, once that is one this app reads. */
function versioned(text: string, format: string, newest: number): { data: Record<string, unknown>; version: number } | StoredFileProblem {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return "damaged";
  }
  if (!isRecord(data) || data.format !== format || !isOffset(data.version)) return "damaged";
  if (data.version > newest) return "newer";
  return data.version >= 1 ? { data, version: data.version } : "damaged";
}

export function parseProject(text: string): Project | StoredFileProblem {
  const stored = versioned(text, PROJECT_FORMAT, PROJECT_VERSION);
  if (typeof stored === "string") return stored;
  const { data, version } = stored;
  const documents = parseAll(data.documents, (document) => parseDocument(document, version));
  const hidden = version === 1 ? [] : parseAll(data.hidden, parseHiddenValue);
  const { id, name, created, archived } = data;
  if (!documents || !hidden || !isText(id) || !isText(name) || !isText(created) || typeof archived !== "boolean") return "damaged";
  return { id, name, created, archived, documents, hidden };
}

export const projectJson = (project: Project): string =>
  JSON.stringify({ format: PROJECT_FORMAT, version: PROJECT_VERSION, ...project });

// A page's text as stored: its characters, and four numbers for the box of each that has one.
// Boxes are kept to a hundredth of a point; they only draw marks, and apply reads the original.
interface StoredPage {
  readonly chars: readonly string[];
  readonly boxes: readonly number[];
}

const hundredths = (n: number) => Math.round(n * 100) / 100;

export const textsJson = (texts: readonly PageText[]): string =>
  JSON.stringify({
    format: TEXT_FORMAT,
    version: TEXT_VERSION,
    pages: texts.map(({ chars }): StoredPage => ({
      chars: chars.map((char) => char.c),
      boxes: chars.flatMap(({ box }) => (box === undefined ? [] : [box.x0, box.y0, box.x1, box.y1].map(hundredths))),
    })),
  });

function parseStoredPage(value: unknown): PageText | undefined {
  if (!isRecord(value)) return undefined;
  const chars = parseStrings(value.chars);
  const boxes = parseAll(value.boxes, (n) => (typeof n === "number" ? n : undefined));
  if (chars === undefined || boxes === undefined) return undefined;
  const parsed: PageChar[] = [];
  let at = 0;
  for (const c of chars) {
    if (c === "\n") {
      parsed.push({ c, box: undefined });
      continue;
    }
    const box = parseBox(pointBox(boxes[at] ?? NaN, boxes[at + 1] ?? NaN, boxes[at + 2] ?? NaN, boxes[at + 3] ?? NaN));
    if (box === undefined) return undefined;
    parsed.push({ c, box });
    at += 4;
  }
  return at === boxes.length ? { chars: parsed } : undefined;
}

export function parseTexts(text: string, pages: number): PageText[] | StoredFileProblem {
  const stored = versioned(text, TEXT_FORMAT, TEXT_VERSION);
  if (typeof stored === "string") return stored;
  const texts = parseAll(stored.data.pages, parseStoredPage);
  return texts && texts.length === pages ? texts : "damaged";
}

export const imagesJson = (images: readonly PlacedImage[]): string => JSON.stringify({ format: IMAGES_FORMAT, version: IMAGES_VERSION, images });

export function parseImages(text: string, pages: number): PlacedImage[] | StoredFileProblem {
  const stored = versioned(text, IMAGES_FORMAT, IMAGES_VERSION);
  if (typeof stored === "string") return stored;
  const images = parseAll(stored.data.images, parsePlacedImage);
  return images && images.every((image) => image.page < pages) ? images : "damaged";
}

export function parseSettings(text: string): Settings | StoredFileProblem {
  const stored = versioned(text, SETTINGS_FORMAT, SETTINGS_VERSION);
  if (typeof stored === "string") return stored;
  const { data } = stored;
  const appearance = parseAppearance(data.appearance);
  const customTypes = parseAll(data.customTypes, (value) => (isText(value) && value.trim() !== "" ? value : undefined));
  return appearance && customTypes ? { appearance, customTypes } : "damaged";
}

export const settingsJson = (settings: Settings): string =>
  JSON.stringify({ format: SETTINGS_FORMAT, version: SETTINGS_VERSION, ...settings });
