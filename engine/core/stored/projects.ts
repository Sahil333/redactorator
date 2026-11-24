// Projects in a store: each is a folder holding its originals under their own names and its
// records in a hidden `.redactorator/` folder.
import type { PageText, PlacedImage, Reading } from "../../model/document";
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

const RECORDS = ".redactorator";
const PROJECT_FILE = `${RECORDS}/project.json`;
const textFile = (folder: string, id: DocumentId) => `${folder}/${RECORDS}/text/${id}.json`;
const imagesFile = (folder: string, id: DocumentId) => `${folder}/${RECORDS}/images/${id}.json`;
const SETTINGS_FILE = `${RECORDS}/settings.json`;
// `folder` is "" for the store's root, as when one project's own folder is imported.
const inFolder = (folder: string, name: string) => (folder === "" ? name : `${folder}/${name}`);
const decoder = new TextDecoder();

/** A project and the folder it lives in. */
export interface StoredProject {
  readonly folder: string;
  readonly project: Project;
}

/** A project folder whose records this app cannot read. It is shown, and never written over. */
interface UnreadableProject {
  readonly folder: string;
  readonly problem: StoredFileProblem;
}

/** A file that passed the engine's inspection, ready to be added to a project. */
export interface NewDocument {
  readonly id: DocumentId;
  readonly file: string;
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly sha256: string;
  /** Its pages' text and images, which the project keeps so values and images can be found in it later. */
  readonly reading: Reading;
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

/** The project in `folder` as it is stored now, or why it can't be read; undefined when there is none. */
export async function readProject(store: Store, folder: string): Promise<StoredProject | UnreadableProject | undefined> {
  const file = await store.read(inFolder(folder, PROJECT_FILE));
  if (file === undefined) return undefined;
  const project = parseProject(decoder.decode(file));
  return typeof project === "string" ? { folder, problem: project } : { folder, project };
}

export type ProjectEntries = readonly (StoredProject | UnreadableProject)[];

export async function listProjects(store: Store): Promise<ProjectEntries> {
  const folders = (await store.folders("")).filter((folder) => folder !== RECORDS);
  const entries = await Promise.all(folders.map((folder) => readProject(store, folder)));
  return entries.filter((entry) => entry !== undefined);
}

export const saveProject = (store: Store, { folder, project }: StoredProject): Promise<void> =>
  store.write(`${folder}/${PROJECT_FILE}`, projectJson(project));

/**
 * Writes each new original and its text into the project's folder and returns the documents to
 * add to it. If one fails, every file it started to write is removed again, the failed one
 * included (the browser creates a file before writing it), so no file is left that the project
 * does not list.
 */
export async function writeOriginals(
  store: Store,
  { folder, project }: StoredProject,
  added: readonly NewDocument[],
): Promise<ProjectDocument[]> {
  const taken = project.documents.map((document) => document.file);
  const started: string[] = [];
  const documents: ProjectDocument[] = [];
  try {
    for (const { id, file, bytes, sha256, reading } of added) {
      const name = unique(safeName(file, "Document.pdf"), [...taken, RECORDS]);
      taken.push(name);
      started.push(`${folder}/${name}`, textFile(folder, id), imagesFile(folder, id));
      await store.write(`${folder}/${name}`, bytes);
      await store.write(textFile(folder, id), textsJson(reading.texts));
      await store.write(imagesFile(folder, id), imagesJson(reading.images));
      const document: ProjectDocument = { id, file: name, sha256, pages: reading.texts.length, marks: [], review: "not-started", download: "none", shown: [] };
      documents.push(document);
    }
  } catch (error) {
    await Promise.all(started.map((path) => store.remove(path)));
    throw error;
  }
  return documents;
}

/** A document's stored text, or why it can't be used; undefined when there is none, as for a project from before texts were kept. */
export async function readTexts(store: Store, folder: string, document: ProjectDocument): Promise<PageText[] | StoredFileProblem | undefined> {
  const file = await store.read(textFile(folder, document.id));
  return file === undefined ? undefined : parseTexts(decoder.decode(file), document.pages);
}

export const saveTexts = (store: Store, folder: string, id: DocumentId, texts: readonly PageText[]): Promise<void> =>
  store.write(textFile(folder, id), textsJson(texts));

/** A document's stored images, or why they can't be used; undefined when there are none, as for a project from before images were kept. */
export async function readImages(store: Store, folder: string, document: ProjectDocument): Promise<PlacedImage[] | StoredFileProblem | undefined> {
  const file = await store.read(imagesFile(folder, document.id));
  return file === undefined ? undefined : parseImages(decoder.decode(file), document.pages);
}

export const saveImages = (store: Store, folder: string, id: DocumentId, images: readonly PlacedImage[]): Promise<void> =>
  store.write(imagesFile(folder, id), imagesJson(images));

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

export function createProject(store: Store, name: string, added: readonly NewDocument[]): Promise<StoredProject> {
  return intoNewFolder(store, name, async (folder) => {
    const project: Project = { id: crypto.randomUUID(), name, created: new Date().toISOString(), archived: false, documents: [], hidden: [] };
    const documents = await writeOriginals(store, { folder, project }, added);
    const stored = { folder, project: { ...project, documents } };
    await saveProject(store, stored);
    return stored;
  });
}

export function duplicateProject(store: Store, { folder, project }: StoredProject): Promise<StoredProject> {
  const name = `${project.name} (copy)`;
  return intoNewFolder(store, name, async (copyFolder) => {
    for (const document of project.documents) {
      await store.write(`${copyFolder}/${document.file}`, await readOriginal(store, folder, document));
      for (const record of [textFile, imagesFile]) {
        const file = await store.read(record(folder, document.id));
        if (file !== undefined) await store.write(record(copyFolder, document.id), file);
      }
    }
    const copy = { folder: copyFolder, project: { ...project, id: crypto.randomUUID(), name, created: new Date().toISOString() } };
    await saveProject(store, copy);
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
async function copyProjectInto(from: Store, folder: string, into: Store, name: string): Promise<void> {
  const there = (await listProjects(into)).flatMap((entry) => ("project" in entry ? [entry.project] : []));
  await intoNewFolder(into, name, async (target) => {
    await copyFolder(from, folder, into, target);
    const copied = await readProject(into, target);
    if (copied === undefined || !("project" in copied) || !there.some(({ id }) => id === copied.project.id)) return;
    const project = { ...copied.project, id: crypto.randomUUID(), name: copyName(copied.project.name, there.map((each) => each.name)) };
    await saveProject(into, { folder: target, project });
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
async function alreadyThere(from: Store, entry: StoredProject, into: Store): Promise<boolean> {
  const twin = (await listProjects(into)).find((each) => "project" in each && each.project.id === entry.project.id);
  return twin !== undefined && (await sameFolder(from, entry.folder, into, twin.folder));
}

/** Moves a project folder: copies it in under `name`, checked, then removes the old copy. */
async function moveFolder(from: Store, folder: string, into: Store, name: string): Promise<void> {
  await copyProjectInto(from, folder, into, name);
  await from.remove(folder);
}

/** Moves one readable project, while no other tab has it open; false when one does. */
async function moveProject(from: Store, entry: StoredProject, into: Store, locks: LockPort): Promise<boolean> {
  const hold = await locks.acquire(entry.project.id);
  if (hold === undefined) return false;
  try {
    // Another tab, starting at the same time, may have moved it while this one waited.
    if ((await readProject(from, entry.folder)) === undefined) return true;
    if (await alreadyThere(from, entry, into)) await from.remove(entry.folder);
    else await moveFolder(from, entry.folder, into, entry.project.name);
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
export async function moveProjects(from: Store, into: Store, locks: LockPort): Promise<string[]> {
  const left: string[] = [];
  for (const entry of await listProjects(from)) {
    if ("problem" in entry) await moveFolder(from, entry.folder, into, entry.folder);
    else if (!(await moveProject(from, entry, into, locks))) left.push(entry.project.name);
  }
  await moveSettings(from, into);
  return left;
}

/**
 * Copies in the project folder `from`, as picked to import; or says why it can't: "projects"
 * when it is a folder of projects rather than one, "missing" when it holds none, or its project
 * file's problem.
 */
export async function importProject(from: Store, into: Store): Promise<StoredFileProblem | "projects" | "missing" | undefined> {
  const found = await readProject(from, "");
  if (found === undefined) return (await listProjects(from)).length > 0 ? "projects" : "missing";
  if ("problem" in found) return found.problem;
  await copyProjectInto(from, "", into, found.project.name);
  return undefined;
}

/** A document's original, or undefined when it is gone from the project's folder. */
export const findOriginal = (store: Store, folder: string, document: ProjectDocument): Promise<Uint8Array<ArrayBuffer> | undefined> =>
  store.read(`${folder}/${document.file}`);

export async function readOriginal(store: Store, folder: string, document: ProjectDocument): Promise<Uint8Array<ArrayBuffer>> {
  const file = await findOriginal(store, folder, document);
  if (file === undefined) throw new Error("The original is missing");
  return file;
}

export async function loadSettings(store: Store): Promise<Settings | StoredFileProblem> {
  const file = await store.read(SETTINGS_FILE);
  return file === undefined ? defaultSettings : parseSettings(decoder.decode(file));
}

export const saveSettings = (store: Store, settings: Settings): Promise<void> => store.write(SETTINGS_FILE, settingsJson(settings));

