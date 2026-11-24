// What the app's hooks that have not moved into the engine yet take from it, until step 6d.
import type { EngineInterim } from "../core/createEngine";
import {
  findOriginal,
  readImages,
  readOriginal,
  readTexts,
  saveImages,
  saveProject,
  saveTexts,
  writeOriginals,
} from "../core/stored/projects";

export type { Applied, PdfClient, WorkerStatus } from "../core/pdf-client/client";
export type { ClientError } from "../core/pdf-client/errors";
export type { StoredProject } from "../core/stored/projects";
export type { Pixels } from "../pdf-protocol/messages";

/** The stored-file functions the app still calls itself. */
const storedFiles = {
  findOriginal,
  readImages,
  readOriginal,
  readTexts,
  saveImages,
  saveProject,
  saveTexts,
  writeOriginals,
};

export type StoredFiles = typeof storedFiles;

export interface Interim extends EngineInterim {
  readonly stored: StoredFiles;
}

export const interimOf = (core: EngineInterim): Interim => ({ ...core, stored: storedFiles });
