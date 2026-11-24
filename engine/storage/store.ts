// Where projects are kept. The engine reaches storage only through `Store`, so another backend
// (a folder on the user's disk, another browser's storage, a cloud) can take its place.

/**
 * Files and folders under one root, addressed by paths like `Folder/.redactorator/project.json`:
 * relative to the root and `/`-separated. A store refuses a path with a `..` segment or a leading `/`.
 */
export interface Store {
  /** The file at `path`, as a fresh array the caller owns, or undefined when there is none. */
  read(path: string): Promise<Uint8Array<ArrayBuffer> | undefined>;
  /** Writes `data` to `path`, making its folders. The file changes only once the whole write lands. */
  write(path: string, data: Uint8Array<ArrayBuffer> | string): Promise<void>;
  /** The names of the folders directly inside `path` ("" for the root). */
  folders(path: string): Promise<string[]>;
  /** The names of the files directly inside `path` ("" for the root). */
  files(path: string): Promise<string[]>;
  /** Removes the file or folder at `path`, with everything in it. */
  remove(path: string): Promise<void>;
}
