// Projects in a store: each is a folder holding its originals under their own names and its
// records in a hidden `.redactorator/` folder.
import type { PageText, PlacedImage, Reading } from "../engine/contract";
import {
  defaultSettings,
  imagesJson,
  parseImages,
  parseProject,
  parseSettings,
  parseTexts,
  projectJson,
  settingsJson,
  textsJson,
  type DocumentId,
  type Project,
  type ProjectDocument,
  type Settings,
  type StoredFileProblem,
} from "./project";
import type { Store } from "./storage";

const RECORDS = ".redactorator";
const PROJECT_FILE = `${RECORDS}/project.json`;
const textFile = (folder: string, id: DocumentId) => `${folder}/${RECORDS}/text/${id}.json`;
const imagesFile = (folder: string, id: DocumentId) => `${folder}/${RECORDS}/images/${id}.json`;
const SETTINGS_FILE = `${RECORDS}/settings.json`;

/** A project and the folder it lives in. */
export interface StoredProject {
  readonly folder: string;
  readonly project: Project;
}

/** A project folder whose records this app cannot read. It is shown, and never written over. */
export interface UnreadableProject {
  readonly folder: string;
  readonly problem: StoredFileProblem;
}

/** A file that passed the engine's inspection, ready to be added to a project. */
export interface NewDocument {
  readonly id: DocumentId;
  readonly file: string;
  readonly bytes: ArrayBuffer;
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
  const file = await store.read(`${folder}/${PROJECT_FILE}`);
  if (file === undefined) return undefined;
  const project = parseProject(await file.text());
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
  return file === undefined ? undefined : parseTexts(await file.text(), document.pages);
}

export const saveTexts = (store: Store, folder: string, id: DocumentId, texts: readonly PageText[]): Promise<void> =>
  store.write(textFile(folder, id), textsJson(texts));

/** A document's stored images, or why they can't be used; undefined when there are none, as for a project from before images were kept. */
export async function readImages(store: Store, folder: string, document: ProjectDocument): Promise<PlacedImage[] | StoredFileProblem | undefined> {
  const file = await store.read(imagesFile(folder, document.id));
  return file === undefined ? undefined : parseImages(await file.text(), document.pages);
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

/** A document's original, or undefined when it is gone from the project's folder. */
export const findOriginal = (store: Store, folder: string, document: ProjectDocument): Promise<File | undefined> =>
  store.read(`${folder}/${document.file}`);

export async function readOriginal(store: Store, folder: string, document: ProjectDocument): Promise<File> {
  const file = await findOriginal(store, folder, document);
  if (file === undefined) throw new Error("The original is missing");
  return file;
}

export async function loadSettings(store: Store): Promise<Settings | StoredFileProblem> {
  const file = await store.read(SETTINGS_FILE);
  return file === undefined ? defaultSettings : parseSettings(await file.text());
}

export const saveSettings = (store: Store, settings: Settings): Promise<void> => store.write(SETTINGS_FILE, settingsJson(settings));

/**
 * Holds the project's lock while it is open, so a second tab cannot open it and write over it.
 * Resolves to the function that lets the lock go, or undefined when another tab holds it.
 */
export function lockProject(id: string): Promise<(() => void) | undefined> {
  return new Promise((resolve) => {
    void navigator.locks.request(`redactorator-project:${id}`, { ifAvailable: true }, (lock) => {
      if (lock === null) {
        resolve(undefined);
        return undefined;
      }
      return new Promise<void>((release) => resolve(() => release()));
    });
  });
}
