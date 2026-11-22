import { newDocumentId } from "./project";
import type { NewDocument } from "./projects";
import type { Inspection } from "./useEngine";

/** A file the user chose that was not added, and why. DOC-4: nothing is left out silently. */
export interface Refusal {
  readonly file: string;
  readonly reason: string;
}

const isPdf = (file: File) => file.type === "application/pdf" || /\.pdf$/i.test(file.name);

// A folder's own files, such as .DS_Store, are not documents the user chose.
const isHidden = (file: File) => file.name.startsWith(".");

const pathOf = (file: File) => file.webkitRelativePath || file.name;

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Reads each chosen file and has the engine inspect it, in the order a folder lists them. */
export async function prepareFiles(
  files: readonly File[],
  inspect: (bytes: ArrayBuffer) => Promise<Inspection>,
): Promise<{ readonly added: NewDocument[]; readonly refused: Refusal[] }> {
  const added: NewDocument[] = [];
  const refused: Refusal[] = [];
  const chosen = files.filter((file) => !isHidden(file)).toSorted((a, b) => pathOf(a).localeCompare(pathOf(b)));
  for (const file of chosen) {
    if (!isPdf(file)) {
      refused.push({ file: file.name, reason: "This is not a PDF." });
      continue;
    }
    let bytes: ArrayBuffer;
    try {
      bytes = await file.arrayBuffer();
    } catch {
      refused.push({ file: file.name, reason: "This file could not be read. Choose it again." });
      continue;
    }
    const inspection = await inspect(bytes.slice(0));
    if ("error" in inspection) refused.push({ file: file.name, reason: inspection.error.message });
    else added.push({ id: newDocumentId(), file: file.name, bytes, sha256: await sha256(bytes), reading: inspection });
  }
  return { added, refused };
}
