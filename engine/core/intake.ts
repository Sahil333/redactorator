import type { Refusal } from "../api/errors";
import type { IncomingFile } from "../api/facade";
import { newDocumentId } from "../model/project";
import { sha256 } from "./hash";
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

/** Reads each chosen file and has the PDF worker prepare it, in the order a folder lists them. It stores nothing. */
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
    const prepared = await client.prepare(bytes);
    if ("code" in prepared) refused.push({ file: file.name, error: prepared });
    else added.push({ ...prepared, id: newDocumentId(), file: file.name, bytes, sha256: await sha256(bytes) });
  }
  return { added, refused };
}
