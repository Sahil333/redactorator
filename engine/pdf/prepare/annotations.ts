// Preparation steps 2 to 4: annotations and form fields that are not shown are deleted, the rest
// are flattened into their pages, and the document is saved and opened again.
import * as mupdf from "mupdf";
import type { RemovalKind } from "../../model/document";
import { nameAt, objectAt, valuesOf } from "../objects";
import { layersOf } from "./layers";
import { reopen } from "./reopen";

// Annotation flags (ISO 32000-2, 12.5.3).
const HIDDEN = 2;
const PRINT = 4;
const NO_VIEW = 32;

/** The kinds an annotation or widget belongs to, whether it is flattened or removed. */
function kindsOf(annotation: mupdf.PDFAnnotation): RemovalKind[] {
  if (annotation instanceof mupdf.PDFWidget) return annotation.getFieldType() === "signature" ? ["form-data", "signatures"] : ["form-data"];
  switch (annotation.getType()) {
    case "FileAttachment":
      return ["attachments"];
    case "Redact":
      return ["pending-redactions"];
    default:
      return ["annotations"];
  }
}

/** Whether any page still has an annotation or widget. */
function anyAnnotation(document: mupdf.PDFDocument): boolean {
  for (let index = 0; index < document.countPages(); index++) {
    const page = document.loadPage(index);
    try {
      if (page.getAnnotations().length > 0 || page.getWidgets().length > 0) return true;
    } finally {
      page.destroy();
    }
  }
  return false;
}

/** MuPDF lists no link among a page's annotations: they stay, and step 7 deletes them with `/Annots`. */
const holdsLinks = (page: mupdf.PDFObject) => valuesOf(objectAt(page, "Annots")).some((annotation) => nameAt(annotation.resolve(), "Subtype") === "Link");

/**
 * Deletes what must not be flattened, since flattening would show it: annotations and widgets
 * that are hidden, not shown on screen or printed, or on a layer that is off, and Redact and
 * Popup annotations. Then flattens the rest, saves, and returns the document opened again, as
 * pages open before still list their old annotations. Throws when one is left after that, since
 * MuPDF's flattening hides its own failures. `document` is used up.
 */
export function flattenAnnotations(document: mupdf.PDFDocument, removed: Set<RemovalKind>): mupdf.PDFDocument {
  const layers = layersOf(document);
  const shown = (annotation: mupdf.PDFAnnotation) => {
    const flags = annotation.getFlags();
    const oc = annotation.getObject().get("OC");
    return (flags & HIDDEN) === 0 && !((flags & NO_VIEW) !== 0 && (flags & PRINT) === 0) && (oc.isNull() || !layers.isOff(oc));
  };
  for (let index = 0; index < document.countPages(); index++) {
    if (holdsLinks(document.findPage(index))) removed.add("links");
    const page = document.loadPage(index);
    try {
      for (const annotation of [...page.getAnnotations(), ...page.getWidgets()]) {
        for (const kind of kindsOf(annotation)) removed.add(kind);
        const type = annotation.getType();
        if (type === "Redact" || type === "Popup" || !shown(annotation)) page.deleteAnnotation(annotation);
      }
    } finally {
      page.destroy();
    }
  }
  if (!document.getTrailer().get("Root").get("AcroForm").isNull()) removed.add("form-data");
  document.bake(true, true);
  const flattened = reopen(document, "");
  if (anyAnnotation(flattened)) {
    flattened.destroy();
    throw new Error("An annotation was left after flattening");
  }
  return flattened;
}
