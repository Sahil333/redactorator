import type { Store } from "../storage/store";

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

// A document's file name comes from a stored, possibly imported, project file, so a path must not climb out of the store.
function segments(path: string): string[] {
  const names = path.split("/");
  if (path.startsWith("/") || names.includes("..")) throw new Error("A store path must stay inside the store");
  return names.filter((segment) => segment !== "");
}

async function names(folder: FileSystemDirectoryHandle, kind: FileSystemHandleKind): Promise<string[]> {
  const found: string[] = [];
  for await (const [name, handle] of folder.entries()) {
    if (handle.kind === kind) found.push(name);
  }
  return found;
}

/** The files and folders under `root`: Chrome's private storage, or a folder the user picked. */
export function folderStore(root: FileSystemDirectoryHandle): Store {
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
        return await (await (await handle.getFileHandle(name)).getFile()).bytes();
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
  return folderStore(await navigator.storage.getDirectory());
}
