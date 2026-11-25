// Whether optional content is off in the document's default configuration, as ISO 32000-2
// 8.11.2 defines it (docs/designs/pdf-leak-suite.md, part 1, step 2).
import type * as mupdf from "mupdf";
import { nameAt, objectAt, valuesOf } from "../objects";

/** A layer rule MuPDF does not judge by its groups: a free-form `/VE` expression, which refuses the document. */
class VisibilityExpression extends Error {}

export interface Layers {
  /** Whether an `/OC` value (a layer or a rule about layers) is off. */
  isOff(oc: mupdf.PDFObject): boolean;
  /** The names of the layers that are off. */
  readonly offNames: ReadonlySet<string>;
}

const numberOf = (ref: mupdf.PDFObject): number | undefined => (ref.isIndirect() ? ref.asIndirect() : undefined);

function numbersIn(array: mupdf.PDFObject): Set<number> {
  const found = new Set<number>();
  if (array.isNull()) return found;
  const resolved = array.resolve();
  if (resolved.isArray()) resolved.forEach((each) => {
    const number = numberOf(each);
    if (number !== undefined) found.add(number);
  });
  return found;
}

export function layersOf(document: mupdf.PDFDocument): Layers {
  const trailer = document.getTrailer();
  const baseOff = nameAt(trailer, "Root", "OCProperties", "D", "BaseState") === "OFF";
  const on = numbersIn(trailer.get("Root", "OCProperties", "D", "ON"));
  const off = numbersIn(trailer.get("Root", "OCProperties", "D", "OFF"));
  const groupOff = (group: mupdf.PDFObject) => {
    const number = numberOf(group);
    if (number === undefined) return false;
    return off.has(number) || (baseOff && !on.has(number));
  };
  function isOff(oc: mupdf.PDFObject): boolean {
    if (oc.isNull()) return false;
    const resolved = oc.resolve();
    if (!resolved.isDictionary()) return false;
    if (nameAt(resolved, "Type") !== "OCMD") return groupOff(oc);
    if (!resolved.get("VE").isNull()) throw new VisibilityExpression();
    const groups = resolved.get("OCGs");
    const list: mupdf.PDFObject[] = [];
    if (!groups.isNull() && groups.resolve().isArray()) groups.resolve().forEach((each) => list.push(each));
    else if (!groups.isNull()) list.push(groups);
    // A rule with no groups has no effect.
    if (list.length === 0) return false;
    const rule = nameAt(resolved, "P") ?? "AnyOn";
    const offs = list.map(groupOff);
    if (rule === "AllOn") return offs.some(Boolean);
    if (rule === "AnyOff") return !offs.some(Boolean);
    if (rule === "AllOff") return !offs.every(Boolean);
    return offs.every(Boolean);
  }
  const offNames = new Set<string>();
  for (const group of valuesOf(objectAt(trailer, "Root", "OCProperties", "OCGs"))) {
    const name = objectAt(group.resolve(), "Name");
    if (groupOff(group) && name?.isString()) offNames.add(name.asString());
  }
  return { isOff, offNames };
}
