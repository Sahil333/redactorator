// Projects in a store: each is a folder holding its originals under their own names and its
// records in a hidden `.redactorator/` folder. Each reader tag has its own folder there, holding
// that build's project file and what it derived from the originals; files are only ever added, so
// an older build still finds the project as it last saw it (docs/designs/pdf-leak-suite.md, part 3).
import { isReaderTag, type PageText, type PlacedImage, type Reading, type ReaderTag, type RemovalKind } from "../../model/document";
import type { PageIndex } from "../../model/geometry";
import { isPageIndex } from "../../model/geometry";
import type { Mark } from "../../model/marks";
import { migratePieces } from "../../model/textAnchor";
import {
  imagesJson,
  parseImages,
  parseProject,
  parseSettings,
  parseTexts,
  projectJson,
  settingsJson,
  textsJson,
  type StoredFileProblem,
  type StoredTexts,
} from "../formats/project";
import {
  defaultSettings,
  type DocumentId,
  type Project,
  type ProjectDocument,
  type Settings,
} from "../../model/project";
import type { LockPort } from "../ports";
import type { Store } from "../../storage/store";
import { stateJson } from "../formats/findings";
import { findingsFiles, readHits } from "./findings";

const RECORDS = ".redactorator";
const SETTINGS_FILE = `${RECORDS}/settings.json`;
// `folder` is "" for the store's root, as when one project's own folder is imported.
const inFolder = (folder: string, name: string) => (folder === "" ? name : `${folder}/${name}`);
const decoder = new TextDecoder();

/** Where a project's records were read from: a reader tag's folder, or `.redactorator/` itself, as builds before reader tags wrote them. */
export type ProjectSource = ReaderTag | "root";

/** The folder of a project's records from `source`: its reader folder, or `.redactorator/` itself. */
export const recordsIn = (folder: string, source: ProjectSource) => inFolder(folder, source === "root" ? RECORDS : `${RECORDS}/${source}`);
const projectFile = (folder: string, source: ProjectSource) => `${recordsIn(folder, source)}/project.json`;
const textFile = (folder: string, source: ProjectSource, id: DocumentId) => `${recordsIn(folder, source)}/text/${id}.json`;
const imagesFile = (folder: string, source: ProjectSource, id: DocumentId) => `${recordsIn(folder, source)}/images/${id}.json`;
/** The working copy holds every marked value until export, so its name says so. */
const workingFile = (folder: string, tag: ReaderTag, id: DocumentId) => `${recordsIn(folder, tag)}/working/${id}.not-redacted.pdf`;

/** A project and the folder it lives in. */
export interface StoredProject {
  readonly folder: string;
  readonly project: Project;
}

/** A stored project as read, and where its records were read from. */
export interface ReadProject extends StoredProject {
  readonly source: ProjectSource;
}

/** A project folder whose records this app cannot read. It is shown, and never written over. */
interface UnreadableProject {
  readonly folder: string;
  readonly problem: StoredFileProblem;
}

/** What the PDF worker's preparation made of one document, for the tag folder. */
export interface PreparedFiles {
  /** The working copy, which the app shows, reads, marks and writes from. */
  readonly preparedBytes: Uint8Array<ArrayBuffer>;
  /** Its pages' text and images, which the project keeps so values and images can be found in it later. */
  readonly reading: Reading;
  readonly removed: readonly RemovalKind[];
}

/** A file that passed the engine's preparation, ready to be added to a project. */
export interface NewDocument extends PreparedFiles {
  readonly id: DocumentId;
  readonly file: string;
  /** The file as the user picked it. */
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly sha256: string;
}

const sameName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0;

/** `name`, or `name (2)`, `name (3)` and so on before its extension, whichever is not taken. Ignores case, as macOS and Windows do. */
function unique(name: string, taken: readonly string[]): string {
  const dot = name.lastIndexOf(".");
  const [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  let candidate = name;
  for (let n = 2; taken.some((each) => sameName(each, candidate)); n++) candidate = `${stem} (${n})${extension}`;
  return candidate;
}

// Characters Windows or macOS refuse in a file name, and control characters.
const UNSAFE = /[<>:"/\\|?*\u0000-\u001f]/g;

/** A file or folder name made safe for every desktop, never hidden by a leading dot. */
function safeName(name: string, fallback: string): string {
  const cleaned = name.replace(UNSAFE, "-").replace(/^[.\s]+|[.\s]+$/g, "").slice(0, 120);
  return cleaned === "" ? fallback : cleaned;
}

export const nameFromFile = (file: string): string => file.replace(/\.pdf$/i, "");

/** A reader tag's format and number: `pdf` and 3 for `pdf-3`. */
function tagParts(tag: ReaderTag): { readonly format: string; readonly number: number } {
  const dash = tag.lastIndexOf("-");
  return { format: tag.slice(0, dash), number: Number(tag.slice(dash + 1)) };
}

/**
 * The project file in `folder`, and where it is: this build's tag folder; else the newest older
 * one, the highest number below this build's; else `.redactorator/` itself. Undefined when there
 * is none.
 */
async function findProjectFile(store: Store, folder: string, tag: ReaderTag): Promise<{ readonly source: ProjectSource; readonly file: Uint8Array } | undefined> {
  if (!(await store.folders(folder)).includes(RECORDS)) return undefined;
  const own = tagParts(tag);
  const tags = (await store.folders(inFolder(folder, RECORDS))).filter(isReaderTag).filter((name) => {
    const { format, number } = tagParts(name);
    return format === own.format && number <= own.number;
  });
  for (const source of [...tags.toSorted((a, b) => tagParts(b).number - tagParts(a).number), "root" as const]) {
    const file = await store.read(projectFile(folder, source));
    if (file !== undefined) return { source, file };
  }
  return undefined;
}

/** The project in `folder` as this build sees it now, or why it can't be read; undefined when there is none. */
export async function readProject(store: Store, folder: string, tag: ReaderTag): Promise<ReadProject | UnreadableProject | undefined> {
  const found = await findProjectFile(store, folder, tag);
  if (found === undefined) return undefined;
  const project = parseProject(decoder.decode(found.file));
  return typeof project === "string" ? { folder, problem: project } : { folder, project, source: found.source };
}

export type ProjectEntries = readonly (ReadProject | UnreadableProject)[];

export async function listProjects(store: Store, tag: ReaderTag): Promise<ProjectEntries> {
  const folders = (await store.folders("")).filter((folder) => folder !== RECORDS);
  const entries = await Promise.all(folders.map((folder) => readProject(store, folder, tag)));
  return entries.filter((entry) => entry !== undefined);
}

/** Writes the project into this build's tag folder; no older build's file is written again. */
export const saveProject = (store: Store, { folder, project }: StoredProject, tag: ReaderTag): Promise<void> =>
  store.write(projectFile(folder, tag), projectJson(project));

/** Each page's text a document's record at `source` holds, by page; undefined when it is missing or damaged. */
async function oldTexts(store: Store, folder: string, source: ProjectSource, document: ProjectDocument): Promise<ReadonlyMap<PageIndex, PageText> | undefined> {
  const file = await store.read(textFile(folder, source, document.id));
  const stored = file === undefined ? undefined : parseTexts(decoder.decode(file), document.pages);
  if (stored === undefined || typeof stored === "string") return undefined;
  return new Map(stored.pages.flatMap((text, index) => (isPageIndex(index) ? [[index, text] as const] : [])));
}

/**
 * Copies the project read from an older `source` into this build's tag folder, with each text
 * piece's letters filled from the older build's stored text (`migratePieces`). The older files
 * are left as they are. No findings file is copied, since its positions belong to the older
 * reader: a document whose older folder holds a readable hits file gets a state file of kind
 * `dropped` instead, the notice the user sees on opening it. No run starts.
 */
export async function migrateToTag(store: Store, { folder, project, source }: ReadProject, tag: ReaderTag): Promise<ReadProject> {
  const documents = await Promise.all(
    project.documents.map(async (document): Promise<ProjectDocument> => {
      const texts = await oldTexts(store, folder, source, document);
      const marks = document.marks.map((mark): Mark => (mark.target.kind === "text" ? { ...mark, target: migratePieces(mark.target, texts) } : mark));
      return { ...document, marks };
    }),
  );
  for (const { id } of project.documents) {
    if ((await readHits(store, recordsIn(folder, source), id)) !== undefined)
      await store.write(findingsFiles(recordsIn(folder, tag), id).state, stateJson({ kind: "dropped", reason: "reader-changed" }));
  }
  const migrated = { folder, project: { ...project, documents } };
  await saveProject(store, migrated, tag);
  return { ...migrated, source: tag };
}

/** The project as kept in this build's tag folder, migrated there first when it was read from an older one. */
export const inTag = async (store: Store, read: ReadProject, tag: ReaderTag): Promise<Project> =>
  read.source === tag ? read.project : (await migrateToTag(store, read, tag)).project;

/** The paths a document's prepared files take in the tag folder: its working copy, text and images. */
const preparedPaths = (folder: string, tag: ReaderTag, id: DocumentId) => [workingFile(folder, tag, id), textFile(folder, tag, id), imagesFile(folder, tag, id)] as const;

/** Writes a document's working copy, text and images into the tag folder. */
export async function savePrepared(store: Store, folder: string, tag: ReaderTag, id: DocumentId, { preparedBytes, reading, removed }: PreparedFiles): Promise<void> {
  const [working, text, images] = preparedPaths(folder, tag, id);
  await store.write(working, preparedBytes);
  await store.write(text, textsJson(reading.texts, tag, removed));
  await store.write(images, imagesJson(reading.images));
}

/**
 * Writes each new original, and its prepared files into the tag folder, and returns the documents
 * to add to the project. If one fails, every file it started to write is removed again, the
 * failed one included (the browser creates a file before writing it), so no file is left that
 * the project does not list.
 */
export async function writeOriginals(
  store: Store,
  { folder, project }: StoredProject,
  added: readonly NewDocument[],
  tag: ReaderTag,
): Promise<ProjectDocument[]> {
  const taken = project.documents.map((document) => document.file);
  const started: string[] = [];
  const documents: ProjectDocument[] = [];
  try {
    for (const each of added) {
      const { id, file, bytes, sha256, reading } = each;
      const name = unique(safeName(file, "Document.pdf"), [...taken, RECORDS]);
      taken.push(name);
      started.push(`${folder}/${name}`, ...preparedPaths(folder, tag, id));
      await store.write(`${folder}/${name}`, bytes);
      await savePrepared(store, folder, tag, id, each);
      const document: ProjectDocument = { id, file: name, sha256, pages: reading.texts.length, marks: [], review: "not-started", download: "none", shown: [], removedSeen: [], rejected: [] };
      documents.push(document);
    }
  } catch (error) {
    await Promise.all(started.map((path) => store.remove(path)));
    throw error;
  }
  return documents;
}

/** A document's text as this build stored it, or why it can't be used; undefined when there is none. */
export async function readTexts(store: Store, folder: string, tag: ReaderTag, document: ProjectDocument): Promise<StoredTexts | StoredFileProblem | undefined> {
  const file = await store.read(textFile(folder, tag, document.id));
  return file === undefined ? undefined : parseTexts(decoder.decode(file), document.pages);
}

/** A document's images as this build stored them, or why they can't be used; undefined when there are none. */
export async function readImages(store: Store, folder: string, tag: ReaderTag, document: ProjectDocument): Promise<PlacedImage[] | StoredFileProblem | undefined> {
  const file = await store.read(imagesFile(folder, tag, document.id));
  return file === undefined ? undefined : parseImages(decoder.decode(file), document.pages);
}

/** A document's working copy, or undefined when it is not in the tag folder. */
export const readWorking = (store: Store, folder: string, tag: ReaderTag, document: ProjectDocument): Promise<Uint8Array<ArrayBuffer> | undefined> =>
  store.read(workingFile(folder, tag, document.id));

/** Runs `fill` on a new folder, and removes the folder again if it fails part way. */
async function intoNewFolder<T>(store: Store, name: string, fill: (folder: string) => Promise<T>): Promise<T> {
  const folder = unique(safeName(name, "Project"), [...(await store.folders("")), RECORDS]);
  try {
    return await fill(folder);
  } catch (error) {
    await store.remove(folder);
    throw error;
  }
}

export function createProject(store: Store, name: string, added: readonly NewDocument[], tag: ReaderTag): Promise<StoredProject> {
  return intoNewFolder(store, name, async (folder) => {
    const project: Project = { id: crypto.randomUUID(), name, created: new Date().toISOString(), archived: false, documents: [], hidden: [] };
    const documents = await writeOriginals(store, { folder, project }, added, tag);
    const stored = { folder, project: { ...project, documents } };
    await saveProject(store, stored, tag);
    return stored;
  });
}

/**
 * Copies a project's originals and its whole `.redactorator/` folder, older tag folders
 * included, then gives the copy its own id and name in this build's tag folder only.
 */
export function duplicateProject(store: Store, read: ReadProject, tag: ReaderTag): Promise<StoredProject> {
  const { folder, project } = read;
  const name = `${project.name} (copy)`;
  return intoNewFolder(store, name, async (target) => {
    for (const document of project.documents) await store.write(`${target}/${document.file}`, await readOriginal(store, folder, document));
    await copyFolder(store, `${folder}/${RECORDS}`, store, `${target}/${RECORDS}`);
    const copied = await inTag(store, { ...read, folder: target }, tag);
    const copy = { folder: target, project: { ...copied, id: crypto.randomUUID(), name, created: new Date().toISOString() } };
    await saveProject(store, copy, tag);
    return copy;
  });
}

/** `name`, or `name (2)`, `name (3)` and so on, whichever no project in `taken` has. */
function copyName(name: string, taken: readonly string[]): string {
  let candidate = name;
  for (let n = 2; taken.includes(candidate); n++) candidate = `${name} (${n})`;
  return candidate;
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, at) => byte === b[at]);

/** Copies the folder at `fromPath` into `intoPath`, file by file, each read back and checked whole. */
async function copyFolder(from: Store, fromPath: string, into: Store, intoPath: string): Promise<void> {
  for (const name of await from.files(fromPath)) {
    const file = await from.read(inFolder(fromPath, name));
    if (file === undefined) throw new Error("A file went while it was copied");
    await into.write(`${intoPath}/${name}`, file);
    const copy = await into.read(`${intoPath}/${name}`);
    if (copy === undefined || !sameBytes(file, copy)) throw new Error("A copied file does not match its original");
  }
  for (const name of await from.folders(fromPath)) await copyFolder(from, inFolder(fromPath, name), into, `${intoPath}/${name}`);
}

/**
 * Copies the project folder at `folder` in `from` into `into`, in a new folder named after the
 * project as it is called now (`name`, for one whose project file can't be read). A project whose
 * id is already there becomes a separate copy, with its own id and a name like "Name (2)", so
 * nothing there is ever written over.
 */
async function copyProjectInto(from: Store, folder: string, into: Store, name: string, tag: ReaderTag): Promise<void> {
  const there = (await listProjects(into, tag)).flatMap((entry) => ("project" in entry ? [entry.project] : []));
  await intoNewFolder(into, name, async (target) => {
    await copyFolder(from, folder, into, target);
    const copied = await readProject(into, target, tag);
    if (copied === undefined || !("project" in copied) || !there.some(({ id }) => id === copied.project.id)) return;
    // Given its own id in this build's tag folder only; the older builds' files stay as copied.
    const current = await inTag(into, copied, tag);
    const project = { ...current, id: crypto.randomUUID(), name: copyName(current.name, there.map((each) => each.name)) };
    await saveProject(into, { folder: target, project }, tag);
  });
}

/** Whether two folders hold the same files, byte for byte, and the same folders, all the way down. */
async function sameFolder(a: Store, aPath: string, b: Store, bPath: string): Promise<boolean> {
  const sorted = (names: string[]) => names.toSorted().join("/");
  const [aFiles, bFiles, aFolders, bFolders] = await Promise.all([a.files(aPath), b.files(bPath), a.folders(aPath), b.folders(bPath)]);
  if (sorted(aFiles) !== sorted(bFiles) || sorted(aFolders) !== sorted(bFolders)) return false;
  for (const name of aFiles) {
    const [x, y] = await Promise.all([a.read(`${aPath}/${name}`), b.read(`${bPath}/${name}`)]);
    if (x === undefined || y === undefined || !sameBytes(x, y)) return false;
  }
  for (const name of aFolders) if (!(await sameFolder(a, `${aPath}/${name}`, b, `${bPath}/${name}`))) return false;
  return true;
}

/** Whether `into` already holds this very project, unchanged: the same id, file for file. */
async function alreadyThere(from: Store, entry: StoredProject, into: Store, tag: ReaderTag): Promise<boolean> {
  const twin = (await listProjects(into, tag)).find((each) => "project" in each && each.project.id === entry.project.id);
  return twin !== undefined && (await sameFolder(from, entry.folder, into, twin.folder));
}

/** Moves a project folder: copies it in under `name`, checked, then removes the old copy. */
async function moveFolder(from: Store, folder: string, into: Store, name: string, tag: ReaderTag): Promise<void> {
  await copyProjectInto(from, folder, into, name, tag);
  await from.remove(folder);
}

/** Moves one readable project, while no other tab has it open; false when one does. */
async function moveProject(from: Store, entry: StoredProject, into: Store, locks: LockPort, tag: ReaderTag): Promise<boolean> {
  const hold = await locks.acquire(entry.project.id);
  if (hold === undefined) return false;
  try {
    // Another tab, starting at the same time, may have moved it while this one waited.
    if ((await readProject(from, entry.folder, tag)) === undefined) return true;
    if (await alreadyThere(from, entry, into, tag)) await from.remove(entry.folder);
    else await moveFolder(from, entry.folder, into, entry.project.name, tag);
    return true;
  } finally {
    hold.release();
  }
}

/**
 * Moves the app's settings: into `into` when it has none, and otherwise only the custom mark
 * types `into` lacks, so its own settings stay as they were.
 */
async function moveSettings(from: Store, into: Store): Promise<void> {
  if ((await from.read(SETTINGS_FILE)) === undefined) return;
  const [moving, there] = await Promise.all([loadSettings(from), loadSettings(into)]);
  if (typeof moving !== "string" && typeof there !== "string") {
    const customTypes = [...new Set([...there.customTypes, ...moving.customTypes])];
    if ((await into.read(SETTINGS_FILE)) === undefined) await saveSettings(into, moving);
    else if (customTypes.length > there.customTypes.length) await saveSettings(into, { ...there, customTypes });
  }
  await from.remove(RECORDS);
}

/**
 * Moves every project in `from` into `into`, one at a time: each is copied and checked before
 * its old copy is removed; one already there unchanged, as after browser data was cleared and
 * the project imported again, is only removed. A project open in another tab can't be moved
 * now; the names of those left behind are returned. The app's settings go too, unless `into`
 * has its own.
 */
export async function moveProjects(from: Store, into: Store, locks: LockPort, tag: ReaderTag): Promise<string[]> {
  const left: string[] = [];
  for (const entry of await listProjects(from, tag)) {
    if ("problem" in entry) await moveFolder(from, entry.folder, into, entry.folder, tag);
    else if (!(await moveProject(from, entry, into, locks, tag))) left.push(entry.project.name);
  }
  await moveSettings(from, into);
  return left;
}

/**
 * Copies in the project folder `from`, as picked to import; or says why it can't: "projects"
 * when it is a folder of projects rather than one, "missing" when it holds none, or its project
 * file's problem.
 */
export async function importProject(from: Store, into: Store, tag: ReaderTag): Promise<StoredFileProblem | "projects" | "missing" | undefined> {
  const found = await readProject(from, "", tag);
  if (found === undefined) return (await listProjects(from, tag)).length > 0 ? "projects" : "missing";
  if ("problem" in found) return found.problem;
  await copyProjectInto(from, "", into, found.project.name, tag);
  return undefined;
}

/** A document's original, or undefined when it is gone from the project's folder. */
export const findOriginal = (store: Store, folder: string, document: ProjectDocument): Promise<Uint8Array<ArrayBuffer> | undefined> =>
  store.read(`${folder}/${document.file}`);

async function readOriginal(store: Store, folder: string, document: ProjectDocument): Promise<Uint8Array<ArrayBuffer>> {
  const file = await findOriginal(store, folder, document);
  if (file === undefined) throw new Error("The original is missing");
  return file;
}

export async function loadSettings(store: Store): Promise<Settings | StoredFileProblem> {
  const file = await store.read(SETTINGS_FILE);
  return file === undefined ? defaultSettings : parseSettings(decoder.decode(file));
}

export const saveSettings = (store: Store, settings: Settings): Promise<void> => store.write(SETTINGS_FILE, settingsJson(settings));

