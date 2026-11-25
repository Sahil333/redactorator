// The structural check that preparation's check and the writer's gate share: what a prepared or
// cleaned file must be, judged with MuPDF alone. Independent proof is the outside checker's job.
import type * as mupdf from "mupdf";
import { keyOutsideAllowlist } from "./allowlist";
import { objectAt } from "./objects";

/** What is wrong with the file's structure, or undefined when nothing is. */
export type StructureProblem = "revisions" | "encrypted" | "annotations" | "form" | "allowlist";

/** One unencrypted revision, no annotations or form, and no key outside the allowlist. */
export function checkStructure(document: mupdf.PDFDocument): StructureProblem | undefined {
  if (document.countVersions() !== 1) return "revisions";
  const trailer = document.getTrailer();
  if (!trailer.get("Encrypt").isNull()) return "encrypted";
  for (let index = 0; index < document.countPages(); index++) {
    const annotations = objectAt(document.findPage(index), "Annots");
    if (annotations !== undefined && (!annotations.isArray() || annotations.length > 0)) return "annotations";
  }
  if (!trailer.get("Root").get("AcroForm").isNull()) return "form";
  return keyOutsideAllowlist(document) === undefined ? undefined : "allowlist";
}
