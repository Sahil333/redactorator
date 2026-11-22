// The folder on this computer that holds the projects, once the user picks one. Chrome can
// remember a picked folder only as a handle kept in IndexedDB; that handle is all IndexedDB holds.

// Chrome's folder picker and permission calls, which TypeScript's DOM types leave out.
declare global {
  interface Window {
    showDirectoryPicker(options: { readonly id?: string; readonly mode: FileSystemPermissionMode }): Promise<FileSystemDirectoryHandle>;
  }
  type FileSystemPermissionMode = "read" | "readwrite";
  interface FileSystemHandle {
    queryPermission(options: { readonly mode: FileSystemPermissionMode }): Promise<PermissionState>;
    requestPermission(options: { readonly mode: FileSystemPermissionMode }): Promise<PermissionState>;
  }
}

const DATABASE = "redactorator";
const HANDLES = "handles";
const PROJECTS_FOLDER = "projects-folder";

function request<T>(asking: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    asking.onsuccess = () => resolve(asking.result);
    asking.onerror = () => reject(asking.error ?? new Error("IndexedDB failed"));
  });
}

/** Runs `use` on the handles store, then closes the database, so clearing site data is never held up by it. */
async function withHandles<T>(mode: IDBTransactionMode, use: (handles: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const opening = indexedDB.open(DATABASE, 1);
  opening.onupgradeneeded = () => opening.result.createObjectStore(HANDLES);
  const database = await request(opening);
  try {
    return await request(use(database.transaction(HANDLES, mode).objectStore(HANDLES)));
  } finally {
    database.close();
  }
}

/** The projects folder picked on an earlier visit, if any. */
export async function rememberedFolder(): Promise<FileSystemDirectoryHandle | undefined> {
  const kept: unknown = await withHandles("readonly", (handles) => handles.get(PROJECTS_FOLDER));
  return kept instanceof FileSystemDirectoryHandle ? kept : undefined;
}

/** Remembers `folder` as where the projects are kept, for later visits. */
export const rememberFolder = async (folder: FileSystemDirectoryHandle) =>
  void (await withHandles("readwrite", (handles) => handles.put(folder, PROJECTS_FOLDER)));

/** Asks the user to pick a folder; undefined when they cancel. */
export async function pickFolder(id: string, mode: FileSystemPermissionMode): Promise<FileSystemDirectoryHandle | undefined> {
  try {
    return await window.showDirectoryPicker({ id, mode });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return undefined;
    throw error;
  }
}

/** Whether `folder` is still there: it may have been moved, renamed or deleted since it was picked. */
export async function stillThere(folder: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    await folder.entries().next();
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") return false;
    throw error;
  }
}
