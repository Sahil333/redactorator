import type { IncomingFile } from "../engine/api/facade";

/** Browser files the user chose, as the engine takes them; a folder's files keep their path within it. */
export const incomingFiles = (files: readonly File[]): IncomingFile[] =>
  files.map((file) => ({
    name: file.name,
    path: file.webkitRelativePath || file.name,
    type: file.type,
    read: async () => new Uint8Array(await file.arrayBuffer()),
  }));
