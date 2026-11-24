import type { Refusal } from "../api/errors";
import type { IncomingFile } from "../api/facade";
import { newDocumentId } from "../model/project";
import type { PdfClient } from "./pdf-client/client";
import type { NewDocument } from "./stored/projects";

/** The chosen files that can join a project, and those that can't, with why. */
export interface Intake {
  readonly added: readonly NewDocument[];
  readonly refused: readonly Refusal[];
}

const isPdf = (file: IncomingFile) => file.type === "application/pdf" || /\.pdf$/i.test(file.name);

// A folder's own files, such as .DS_Store, are not documents the user chose.
const isHidden = (file: IncomingFile) => file.name.startsWith(".");

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Reads each chosen file and has the PDF worker inspect it, in the order a folder lists them. */
export async function intake(files: readonly IncomingFile[], client: PdfClient): Promise<Intake> {
  const added: NewDocument[] = [];
  const refused: Refusal[] = [];
  const chosen = files.filter((file) => !isHidden(file)).toSorted((a, b) => a.path.localeCompare(b.path));
  for (const file of chosen) {
    if (!isPdf(file)) {
      refused.push({ file: file.name, error: { code: "not-pdf" } });
      continue;
    }
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = await file.read();
    } catch {
      refused.push({ file: file.name, error: { code: "unreadable-file" } });
      continue;
    }
    const inspection = await client.inspect(bytes);
    if ("code" in inspection) refused.push({ file: file.name, error: inspection });
    else added.push({ id: newDocumentId(), file: file.name, bytes, sha256: await sha256(bytes), reading: inspection.reading });
  }
  return { added, refused };
}
