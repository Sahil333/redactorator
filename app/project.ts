// The stored formats: a project's `project.json` and the app's `settings.json`. Both are read
// from storage the user's browser keeps across app versions, so each carries a version and is
// checked whole when read.
import {
  isOffset,
  isPageIndex,
  isRecord,
  parseAll,
  parseAppearance,
  parseBox,
  type Appearance,
} from "../engine/contract";
import type { Mark, MarkTarget, TextPiece } from "./marks";

declare const brand: unique symbol;

/** Names one document in a project. */
export type DocumentId = string & { readonly [brand]: "DocumentId" };

const isDocumentId = (value: unknown): value is DocumentId => typeof value === "string" && value !== "";

export const newDocumentId = (): DocumentId => {
  const id = crypto.randomUUID();
  if (!isDocumentId(id)) throw new Error("No id");
  return id;
};

export interface ProjectDocument {
  readonly id: DocumentId;
  /** The original's file name in the project folder. */
  readonly file: string;
  readonly sha256: string;
  readonly pages: number;
  readonly marks: readonly Mark[];
}

export interface Project {
  readonly id: string;
  readonly name: string;
  readonly created: string;
  readonly archived: boolean;
  readonly documents: readonly ProjectDocument[];
}

export interface Settings {
  readonly appearance: Appearance;
  /** Mark types the user typed in, by name, offered on every later mark. */
  readonly customTypes: readonly string[];
}

export const defaultSettings: Settings = { appearance: { colour: "#000000", label: false }, customTypes: [] };

const PROJECT_FORMAT = "redactorator-project";
const SETTINGS_FORMAT = "redactorator-settings";
// Raise a version only with a migration from every earlier one in the parser below.
const PROJECT_VERSION = 1;
const SETTINGS_VERSION = 1;

/** Why a stored file could not be used. Shown to the user. */
export type StoredFileProblem = "damaged" | "newer";

const isText = (value: unknown): value is string => typeof value === "string";

function parsePiece(value: unknown): TextPiece | undefined {
  if (!isRecord(value) || !isPageIndex(value.page) || !isOffset(value.start) || !isOffset(value.end)) return undefined;
  const boxes = parseAll(value.boxes, parseBox);
  return boxes && value.start < value.end ? { page: value.page, start: value.start, end: value.end, boxes } : undefined;
}

function parseTarget(value: unknown): MarkTarget | undefined {
  if (!isRecord(value)) return undefined;
  if (value.kind === "box") {
    const box = parseBox(value.box);
    return box && isPageIndex(value.page) ? { kind: "box", page: value.page, box } : undefined;
  }
  const [first, ...rest] = parseAll(value.pieces, parsePiece) ?? [];
  return value.kind === "text" && isText(value.text) && first ? { kind: "text", text: value.text, pieces: [first, ...rest] } : undefined;
}

function parseMark(value: unknown): Mark | undefined {
  if (!isRecord(value) || !isOffset(value.id) || !isText(value.type) || !isText(value.linkId)) return undefined;
  const target = parseTarget(value.target);
  return target && { id: value.id, type: value.type, target, linkId: value.linkId };
}

function parseDocument(value: unknown): ProjectDocument | undefined {
  if (!isRecord(value) || !isDocumentId(value.id) || !isText(value.file) || !isText(value.sha256)) return undefined;
  const { pages } = value;
  const marks = parseAll(value.marks, parseMark);
  return marks && isOffset(pages) && pages > 0
    ? { id: value.id, file: value.file, sha256: value.sha256, pages, marks }
    : undefined;
}

/** The record inside a stored file of `format`, once its version is one this app reads. */
function versioned(text: string, format: string, version: number): Record<string, unknown> | StoredFileProblem {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return "damaged";
  }
  if (!isRecord(data) || data.format !== format || !isOffset(data.version)) return "damaged";
  if (data.version > version) return "newer";
  return data.version === version ? data : "damaged";
}

export function parseProject(text: string): Project | StoredFileProblem {
  const data = versioned(text, PROJECT_FORMAT, PROJECT_VERSION);
  if (typeof data === "string") return data;
  const documents = parseAll(data.documents, parseDocument);
  const { id, name, created, archived } = data;
  if (!documents || !isText(id) || !isText(name) || !isText(created) || typeof archived !== "boolean") return "damaged";
  return { id, name, created, archived, documents };
}

export const projectJson = (project: Project): string =>
  JSON.stringify({ format: PROJECT_FORMAT, version: PROJECT_VERSION, ...project });

export function parseSettings(text: string): Settings | StoredFileProblem {
  const data = versioned(text, SETTINGS_FORMAT, SETTINGS_VERSION);
  if (typeof data === "string") return data;
  const appearance = parseAppearance(data.appearance);
  const customTypes = parseAll(data.customTypes, (value) => (isText(value) && value.trim() !== "" ? value : undefined));
  return appearance && customTypes ? { appearance, customTypes } : "damaged";
}

export const settingsJson = (settings: Settings): string =>
  JSON.stringify({ format: SETTINGS_FORMAT, version: SETTINGS_VERSION, ...settings });
