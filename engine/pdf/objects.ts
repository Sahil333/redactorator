// Reading PDF objects safely. MuPDF.js's missing object (`PDFObject.Null`) throws on `get` and
// `resolve`, so a lookup that may miss goes through a path, which stops at the first miss.
import type * as mupdf from "mupdf";

/** The name at `path` under `object`, resolving references on the way; undefined when there is none. */
export function nameAt(object: mupdf.PDFObject, ...path: string[]): string | undefined {
  const found = object.get(...path);
  if (found.isNull()) return undefined;
  const resolved = found.resolve();
  return resolved.isName() ? resolved.asName() : undefined;
}

/** A dictionary's values or an array's elements, without the explicit nulls, which throw on `resolve`. */
export function valuesOf(object: mupdf.PDFObject | undefined): mupdf.PDFObject[] {
  const values: mupdf.PDFObject[] = [];
  object?.forEach((value) => {
    if (!value.isNull()) values.push(value);
  });
  return values;
}

/** The object at `path` under `object`, resolved; undefined when there is none. */
export function objectAt(object: mupdf.PDFObject, ...path: string[]): mupdf.PDFObject | undefined {
  const found = object.get(...path);
  return found.isNull() ? undefined : found.resolve();
}
