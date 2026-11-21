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
  /** Removes the file or folder at `path`, with everything in it. */
  remove(path: string): Promise<void>;
}

const isNotFound = (error: unknown) => error instanceof DOMException && error.name === "NotFoundError";

const segments = (path: string) => path.split("/").filter((segment) => segment !== "");

function directoryStore(root: FileSystemDirectoryHandle): Store {
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
      // A writable writes to a copy that replaces the file only when it closes.
      const writable = await (await handle.getFileHandle(name, { create: true })).createWritable();
      try {
        await writable.write(data);
        await writable.close();
      } catch (error) {
        await writable.abort();
        throw error;
      }
    },
    async folders(path) {
      const names: string[] = [];
      for await (const [name, handle] of (await folder(segments(path), false)).entries()) {
        if (handle.kind === "directory") names.push(name);
      }
      return names;
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
