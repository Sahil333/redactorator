// Projects in a store: each is a folder holding its originals under their own names and its
// records in a hidden `.redactorator/` folder.
import {
  defaultSettings,
  newDocumentId,
  parseProject,
  parseSettings,
  projectJson,
  settingsJson,
  type Project,
  type ProjectDocument,
  type Settings,
  type StoredFileProblem,
} from "./project";
import type { Store } from "./storage";

const RECORDS = ".redactorator";
const PROJECT_FILE = `${RECORDS}/project.json`;
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
  readonly file: string;
  readonly bytes: ArrayBuffer;
  readonly sha256: string;
  readonly pages: number;
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
 * Writes each new original into the project's folder and returns the documents to add to it.
 * If one fails, every file it started to write is removed again, the failed one included (the
 * browser creates a file before writing it), so no file is left that the project does not list.
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
    for (const { file, bytes, sha256, pages } of added) {
      const name = unique(safeName(file, "Document.pdf"), [...taken, RECORDS]);
      taken.push(name);
      started.push(name);
      await store.write(`${folder}/${name}`, bytes);
      documents.push({ id: newDocumentId(), file: name, sha256, pages, marks: [] });
    }
  } catch (error) {
    await Promise.all(started.map((name) => store.remove(`${folder}/${name}`)));
    throw error;
  }
  return documents;
}

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
    const project: Project = { id: crypto.randomUUID(), name, created: new Date().toISOString(), archived: false, documents: [] };
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
    }
    const copy = { folder: copyFolder, project: { ...project, id: crypto.randomUUID(), name, created: new Date().toISOString() } };
    await saveProject(store, copy);
    return copy;
  });
}

export async function readOriginal(store: Store, folder: string, document: ProjectDocument): Promise<File> {
  const file = await store.read(`${folder}/${document.file}`);
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
