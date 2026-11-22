// Where projects are kept. The app reaches storage only through `Store`, so another backend
// (a folder on the user's disk, another browser's storage, a cloud) can take its place.

/** Files and folders under one root, addressed by paths like `Folder/.redactorator/project.json`. */
export interface Store {
  /** The file at `path`, or undefined when there is none. */
  read(path: string): Promise<File | undefined>;
  /** Writes `data` to `path`, making its folders. The file changes only once the whole write lands. */
  write(path: string, data: BufferSource | Blob | string): Promise<void>;
  /** The names of the folders directly inside `path` ("" for the root). */
  folders(path: string): Promise<string[]>;
  /** The names of the files directly inside `path` ("" for the root). */
  files(path: string): Promise<string[]>;
  /** Removes the file or folder at `path`, with everything in it. */
  remove(path: string): Promise<void>;
}

/** Writes `data` to `file`, which changes only once the whole write lands. */
export async function writeWhole(file: FileSystemFileHandle, data: BufferSource | Blob | string): Promise<void> {
  // A writable writes to a copy that replaces the file only when it closes.
  const writable = await file.createWritable();
  try {
    await writable.write(data);
    await writable.close();
  } catch (error) {
    await writable.abort();
    throw error;
  }
}

const isNotFound = (error: unknown) => error instanceof DOMException && error.name === "NotFoundError";

const segments = (path: string) => path.split("/").filter((segment) => segment !== "");

async function names(folder: FileSystemDirectoryHandle, kind: FileSystemHandleKind): Promise<string[]> {
  const found: string[] = [];
  for await (const [name, handle] of folder.entries()) {
    if (handle.kind === kind) found.push(name);
  }
  return found;
}

/** The files and folders under `root`: Chrome's private storage, or a folder the user picked. */
export function directoryStore(root: FileSystemDirectoryHandle): Store {
  async function folder(names: readonly string[], create: boolean): Promise<FileSystemDirectoryHandle> {
    let handle = root;
    for (const name of names) handle = await handle.getDirectoryHandle(name, { create });
    return handle;
  }

  async function parent(path: string, create: boolean): Promise<[FileSystemDirectoryHandle, string]> {
    const names = segments(path);
    const last = names.pop();
    if (last === undefined) throw new Error("A path names no file");
    return [await folder(names, create), last];
  }

  return {
    async read(path) {
      try {
        const [handle, name] = await parent(path, false);
        return await (await handle.getFileHandle(name)).getFile();
      } catch (error) {
        if (isNotFound(error)) return undefined;
        throw error;
      }
    },
    async write(path, data) {
      const [handle, name] = await parent(path, true);
      await writeWhole(await handle.getFileHandle(name, { create: true }), data);
    },
    async folders(path) {
      return names(await folder(segments(path), false), "directory");
    },
    async files(path) {
      return names(await folder(segments(path), false), "file");
    },
    async remove(path) {
      try {
        const [handle, name] = await parent(path, false);
        await handle.removeEntry(name, { recursive: true });
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    },
  };
}

/** The browser's private storage for this site. */
export async function privateStore(): Promise<Store> {
  return directoryStore(await navigator.storage.getDirectory());
}
