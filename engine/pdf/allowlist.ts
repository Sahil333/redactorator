// The allowlist by role (docs/designs/pdf-leak-suite.md, Appendix A.1). Every object reachable
// from the trailer has a role, one of the Arlington PDF Model's object types, from the key and the
// parent that lead to it; only the keys its role keeps stay. The roles and what each keeps are
// generated (allowlistRoles.generated.ts). Preparation strips with it (step 7), and the structural
// check runs it to find a key left outside it. Anything it can't place refuses the document: an
// unknown key is deleted, never kept.
import * as mupdf from "mupdf";
import type { RemovalKind } from "../model/document";
import { ROLES, type KeyEntry, type Role } from "./allowlistRoles.generated";
import { cutJpeg, cutJpx } from "./imageData";
import { objectAt } from "./objects";

/** Why the walker can't go on: the document is refused. */
class Unplaced extends Error {}

/** The first key left outside the allowlist, as a path of keys from the trailer. */
class Outside extends Error {}

interface Walk {
  readonly document: mupdf.PDFDocument;
  readonly strip: boolean;
  readonly removed: Set<RemovalKind>;
  /** The roles each indirect object was reached by. */
  readonly reached: Map<number, Set<string>>;
  /** The keys deleted from each indirect object, by the role that reached it first. */
  readonly deleted: Map<number, Set<string>>;
  /** Each page and page-tree node's `/Parent`, which must be a node reached from above. */
  readonly parents: { readonly value: mupdf.PDFObject; readonly path: string }[];
}

// The keys a file chooses are looked up as the table's own keys only: a PDF key such as
// /constructor would otherwise read an Object built-in, and be kept.
const own = <T>(table: Readonly<Record<string, T>>, key: string): T | undefined => (Object.hasOwn(table, key) ? table[key] : undefined);

/** The page tree's own types, which a `/Parent` must point at. */
const PAGE_TREE = new Set(["PageTreeNode", "PageTreeNodeRoot"]);

/** A rectangle is four numbers, a matrix six: the model links them nowhere. */
const SHAPES: Readonly<Record<string, number>> = { rectangle: 4, matrix: 6 };

/** The catalog's name trees, and the kind each records (owner, 25 Nov 2026); any other records `app-data`. */
const NAME_TREES: Readonly<Record<string, RemovalKind>> = { Dests: "links", EmbeddedFiles: "attachments", JavaScript: "scripts-actions" };

type PdfType = keyof KeyEntry;

function pdfType(value: mupdf.PDFObject): PdfType {
  // An explicit `null` throws on `resolve`.
  if (value.isNull()) return "null";
  if (value.isStream()) return "stream";
  const resolved = value.resolve();
  if (resolved.isArray()) return "array";
  if (resolved.isDictionary()) return "dictionary";
  if (resolved.isName()) return "name";
  if (resolved.isString()) return "string";
  if (resolved.isNumber()) return "number";
  if (resolved.isBoolean()) return "boolean";
  return "null";
}

const keysOf = (object: mupdf.PDFObject): string[] => {
  const keys: string[] = [];
  object.forEach((_, key) => keys.push(String(key)));
  return keys;
};

/**
 * What `key` of an object of `role` holds: its own entry, or the entry a map's or an array's `*`
 * gives every key the file chooses. One of the type's own keys that is deleted has none.
 */
function entryOf(role: Role, key: string): KeyEntry | undefined {
  const entry = own(role.keys, key);
  return (entry === undefined ? own(role.keys, "*") : entry) ?? undefined;
}

/** The value at `key` as a candidate's fixed values read it: a name or a number. */
function fixedValue(object: mupdf.PDFObject, key: string): string | undefined {
  const value = object.isArray() ? object.get(Number(key)) : object.get(key);
  if (value.isNull()) return undefined;
  const resolved = value.resolve();
  if (resolved.isName()) return resolved.asName();
  return resolved.isNumber() ? String(resolved.asNumber()) : undefined;
}

/** How many of `candidate`'s fixed values `object` matches; undefined when it has one the candidate does not allow, or the candidate is not in the table. */
function fits(candidate: string, object: mupdf.PDFObject): number | undefined {
  const role = own(ROLES, candidate);
  if (role === undefined) return undefined;
  let matched = 0;
  for (const [key, values] of Object.entries(role.fixed)) {
    const value = fixedValue(object, key);
    if (value === undefined) continue;
    if (!values.includes(value)) return undefined;
    matched++;
  }
  return matched;
}

/** The one candidate that fits best, by the most fixed values it matches; undefined when none does, or two we don't both delete fit as well. */
function candidateFor(candidates: readonly string[], object: mupdf.PDFObject): string | undefined {
  const scored = candidates.flatMap((candidate) => {
    const score = fits(candidate, object);
    return score === undefined ? [] : [{ candidate, score }];
  });
  const best = Math.max(...scored.map(({ score }) => score));
  const top = scored.filter(({ score }) => score === best);
  // Roles we delete need not be told apart: a PostScript XObject with no /Subtype2 fits both of the model's.
  if (top.every(({ candidate }) => own(ROLES, candidate)?.delete === true)) return top[0]?.candidate;
  return top.length === 1 ? top[0]?.candidate : undefined;
}

/** Whether an array is a rectangle or a matrix, the shape its model type names: `size` numbers, and nothing else. */
function isShape(value: mupdf.PDFObject, size: number): boolean {
  const resolved = value.resolve();
  if (!resolved.isArray() || resolved.length !== size) return false;
  let numbers = true;
  resolved.forEach((each) => {
    if (each.isNull() || !each.resolve().isNumber()) numbers = false;
  });
  return numbers;
}

/** How a role compares with the roles the object was reached by before. */
function reachedBefore(walk: Walk, value: mupdf.PDFObject, role: string): "first" | "again" | "other" {
  if (!value.isIndirect()) return "first";
  const number = value.asIndirect();
  const roles = walk.reached.get(number);
  if (roles === undefined) {
    walk.reached.set(number, new Set([role]));
    return "first";
  }
  if (roles.has(role)) return "again";
  roles.add(role);
  return "other";
}

/**
 * A value of a kept key: plain, or a container of the one candidate it fits. "delete" when the
 * key must go instead: its value is of a type the model does not allow there, or of a role we
 * delete. `named` gives the candidate by position where the context decides it rather than the
 * value: a stream's DecodeParms follow its filters, one to one.
 */
function walkValue(walk: Walk, value: mupdf.PDFObject, entry: KeyEntry, path: string, named: readonly string[] = []): "kept" | "delete" {
  const type = pdfType(value);
  const candidates = entry[type];
  if (candidates === undefined) return "delete";
  if (type !== "array" && type !== "dictionary" && type !== "stream") return "kept";
  const [shape] = candidates;
  const size = shape === undefined ? undefined : own(SHAPES, shape);
  if (size !== undefined) return isShape(value, size) ? "kept" : "delete";
  const [first] = named;
  // Parameters for a filter that takes none are of no type: empty, they hold nothing, and
  // otherwise the key is deleted.
  if (first !== undefined && type === "dictionary" && !candidates.includes(first)) return keysOf(value.resolve()).length === 0 ? "kept" : "delete";
  const role = first !== undefined && candidates.includes(first) ? first : candidateFor(candidates, value.resolve());
  if (role === undefined) throw new Unplaced(path);
  if (own(ROLES, role)?.delete === true) return "delete";
  walkObject(walk, value, role, path, named);
  return "kept";
}

/** What deleting `key` from an object of `role` records. */
function kindsOf(role: string, key: string, object: mupdf.PDFObject): readonly RemovalKind[] {
  if (role === "Catalog" && key === "Names") {
    const trees = objectAt(object, "Names");
    return trees === undefined ? [] : keysOf(trees).map((tree) => own(NAME_TREES, tree) ?? "app-data");
  }
  const kinds = own(ROLES, role)?.kinds;
  const kind = kinds === undefined ? undefined : own(kinds, key);
  return kind === null ? [] : [kind ?? "app-data"];
}

/** Deletes a key its role does not keep, and records its kind; in check mode, reports it. */
function deleteKey(walk: Walk, role: string, value: mupdf.PDFObject, key: string, path: string, before: "first" | "other"): void {
  // Deleting it would change the object for the role that reached it first.
  if (before === "other") throw new Unplaced(`${path}/${key}`);
  if (!walk.strip) throw new Outside(`${path}/${key}`);
  const object = value.resolve();
  // An explicit null holds nothing, so deleting it removes nothing a user had.
  if (!object.get(key).isNull()) for (const kind of kindsOf(role, key, object)) walk.removed.add(kind);
  object.delete(key);
  if (value.isIndirect()) walk.deleted.set(value.asIndirect(), (walk.deleted.get(value.asIndirect()) ?? new Set()).add(key));
}

/**
 * An object reached in a second role must agree with the first on every key: one the second
 * would delete refuses the file as it is met (`deleteKey`), and so does one the first deleted
 * that the second keeps, whichever order the walk meets them in.
 */
function keepsWhatWasDeleted(walk: Walk, value: mupdf.PDFObject, role: Role): boolean {
  const deleted = value.isIndirect() ? walk.deleted.get(value.asIndirect()) : undefined;
  return [...(deleted ?? [])].some((key) => entryOf(role, key) !== undefined);
}

function walkArray(walk: Walk, array: mupdf.PDFObject, role: Role, path: string, named: readonly string[]): void {
  array.forEach((each, index) => {
    const entry = entryOf(role, String(index));
    const name = named[Number(index)];
    // An element can't be deleted, as the rest would move: one the model does not place, or
    // places as another type, refuses the file.
    if (entry === undefined || walkValue(walk, each, entry, `${path}[${index}]`, name === undefined ? [] : [name]) === "delete") throw new Unplaced(`${path}[${index}]`);
  });
}

/** A key kept but not walked: a `/Parent`, checked once the walk is done, or the trailer's `Encrypt`. */
function notWalked(walk: Walk, object: mupdf.PDFObject, key: string, path: string): void {
  if (key === "Parent") walk.parents.push({ value: object.get(key), path });
  // The trailer's encryption stays until step 8's save; the check finds one left after it.
  if (!walk.strip && key === "Encrypt") throw new Outside(path);
}

/** The role `name` names, which an object of it must be allowed to take; refuses the file otherwise. */
function roleOf(walk: Walk, value: mupdf.PDFObject, name: string, before: "first" | "other", path: string): Role {
  const role = own(ROLES, name);
  if (role === undefined || role.refuse || (before === "other" && keepsWhatWasDeleted(walk, value, role))) throw new Unplaced(path);
  return role;
}

/** Whether a colour space has one channel that reads as grey: CalGray, a one-channel ICC profile, or DeviceGray in an array. */
function isGrey(space: mupdf.PDFObject): boolean {
  if (!space.isArray() || space.get(0).isNull()) return false;
  const first = space.get(0).resolve();
  const family = first.isName() ? first.asName() : undefined;
  if (family !== "ICCBased") return family === "CalGray" || family === "DeviceGray";
  const profile = space.get(1);
  const channels = profile.isNull() ? undefined : objectAt(profile.resolve(), "N");
  return channels?.isNumber() === true && channels.asNumber() === 1;
}

/**
 * A soft mask may only be DeviceGray, but files give one a one-channel colour space that reads
 * the same: it becomes DeviceGray (owner, 25 Nov 2026). One with more channels still refuses.
 */
function greySoftMask(walk: Walk, mask: mupdf.PDFObject): void {
  const space = objectAt(mask, "ColorSpace");
  if (walk.strip && space !== undefined && isGrey(space)) mask.put("ColorSpace", walk.document.newName("DeviceGray"));
}

/**
 * What an object needs before its keys are walked: a soft mask its grey colour space, and a stream
 * no filters named by the abbreviated /F or /DP of inline images, which MuPDF reads on any stream:
 * its data would be kept unseen by step 7, so it refuses the file.
 */
function beforeKeys(walk: Walk, value: mupdf.PDFObject, role: string, path: string): void {
  const object = value.resolve();
  if (role === "XObjectImageSoftMask") greySoftMask(walk, object);
  if (!value.isStream()) return;
  const filter = objectAt(object, "F");
  if (filter?.isName() === true || filter?.isArray() === true || objectAt(object, "DP") !== undefined) throw new Unplaced(path);
}

function walkObject(walk: Walk, value: mupdf.PDFObject, name: string, path: string, named: readonly string[] = []): void {
  const before = reachedBefore(walk, value, name);
  if (before === "again") return;
  const role = roleOf(walk, value, name, before, path);
  const object = value.resolve();
  if (object.isArray()) return walkArray(walk, object, role, path, named);
  beforeKeys(walk, value, name, path);
  // A stream's decode parameters are of the type its filter at the same place names.
  const parms = value.isStream() ? filtersOf(value).map((filter) => `Filter${filter}`) : [];
  for (const key of keysOf(object)) {
    if (role.notWalked.includes(key)) {
      notWalked(walk, object, key, `${path}/${key}`);
      continue;
    }
    const entry = entryOf(role, key);
    const kept = entry !== undefined && walkValue(walk, object.get(key), entry, `${path}/${key}`, key === "DecodeParms" ? parms : []) === "kept";
    if (!kept) deleteKey(walk, name, value, key, path, before);
  }
  if (value.isStream()) streamData(walk, value, name, path);
}

// The abbreviated filter names PDF defines for inline images, which MuPDF accepts on any stream: a
// JPEG under /DCT must be cut like one under /DCTDecode.
const FULL_FILTER_NAMES: Readonly<Record<string, string>> = {
  AHx: "ASCIIHexDecode",
  A85: "ASCII85Decode",
  LZW: "LZWDecode",
  Fl: "FlateDecode",
  RL: "RunLengthDecode",
  CCF: "CCITTFaxDecode",
  DCT: "DCTDecode",
};

/** The full names of a stream's filters, in order. */
function filtersOf(stream: mupdf.PDFObject): string[] {
  const filter = objectAt(stream, "Filter");
  const filters: string[] = [];
  if (filter?.isName()) filters.push(filter.asName());
  else if (filter?.isArray()) filter.forEach((each) => filters.push(each.isNull() || !each.resolve().isName() ? "" : each.resolve().asName()));
  return filters.map((name) => own(FULL_FILTER_NAMES, name) ?? name);
}

// The filters that keep every byte, which MuPDF can undo and step 8 compresses again.
const LOSSLESS = new Set(["FlateDecode", "LZWDecode", "ASCIIHexDecode", "ASCII85Decode", "RunLengthDecode"]);

/** The `DecodeParms` of a stream's filter at `index`: an array's element, or a single dictionary, which is the first filter's (Appendix A.1). */
function parmsAt(stream: mupdf.PDFObject, index: number): mupdf.PDFObject {
  const parms = objectAt(stream, "DecodeParms");
  if (parms === undefined) return mupdf.PDFObject.Null;
  if (parms.isArray()) return parms.get(index);
  return index === 0 ? parms : mupdf.PDFObject.Null;
}

/**
 * An image's encoded bytes with only its image filter left to undo: the raw bytes, or those of the
 * lossless filters before it undone. Only strip mode undoes them, as it adds an object to do so;
 * it always drops them, so one the check meets was left behind.
 */
function encodedImage(walk: Walk, stream: mupdf.PDFObject, filters: readonly string[], path: string): Uint8Array {
  const raw = stream.readRawStream().asUint8Array().slice();
  const before = filters.slice(0, -1);
  if (before.length === 0) return raw;
  if (!before.every((name) => LOSSLESS.has(name))) throw new Unplaced(path);
  if (!walk.strip) throw new Outside(`${path} (a filter over image data)`);
  // A stream of the same bytes, with those filters alone, reads them undone.
  const document = walk.document;
  const names = document.newArray();
  const parms = document.newArray();
  before.forEach((name, index) => {
    names.push(document.newName(name));
    parms.push(parmsAt(stream, index));
  });
  return document.addRawStream(raw, { Filter: names, DecodeParms: parms }).readStream().asUint8Array().slice();
}

/** The image filter a stream's data ends in, if any. Image data under another filter refuses the file, as it can't be cut. */
function imageFilterOf(filters: readonly string[], path: string): "DCTDecode" | "JPXDecode" | undefined {
  const last = filters.at(-1);
  if (last === "DCTDecode" || last === "JPXDecode") return last;
  if (filters.some((name) => name === "DCTDecode" || name === "JPXDecode")) throw new Unplaced(path);
  return undefined;
}

/** Cuts the metadata from a JPEG's or JPEG 2000 image's own bytes (Appendix A.2). */
function cutImageData(walk: Walk, stream: mupdf.PDFObject, role: string, filters: readonly string[], last: "DCTDecode" | "JPXDecode", path: string): void {
  // JPEG or JPEG 2000 data in a stream that is no image, as an ICC profile, is cut nowhere: refuse it.
  if (!role.startsWith("XObjectImage")) throw new Unplaced(path);
  const encoded = encodedImage(walk, stream, filters, path);
  const kept = (last === "DCTDecode" ? cutJpeg : cutJpx)(encoded);
  if (kept === undefined) throw new Unplaced(path);
  if (kept === encoded && filters.length === 1) return;
  if (!walk.strip) throw new Outside(`${path} (image data)`);
  if (kept !== encoded) walk.removed.add("image-metadata");
  if (filters.length > 1) {
    // The image is kept under its image filter alone: the filters before it only encoded it.
    const imageParms = parmsAt(stream, filters.length - 1);
    stream.put("Filter", walk.document.newName(last));
    if (imageParms.isNull()) stream.delete("DecodeParms");
    else stream.put("DecodeParms", imageParms);
  }
  stream.writeRawStream(kept.slice());
}

/**
 * A stream's data: an image's cut (Appendix A.2), or, under lossless filters alone, written again
 * from its decoded bytes, as bytes after a filter's end of data are never decoded but would stay.
 */
function streamData(walk: Walk, stream: mupdf.PDFObject, role: string, path: string): void {
  const filters = filtersOf(stream);
  const last = imageFilterOf(filters, path);
  if (last !== undefined) return cutImageData(walk, stream, role, filters, last, path);
  if (!walk.strip || filters.length === 0 || !filters.every((name) => LOSSLESS.has(name))) return;
  // Freed at once: MuPDF's memory never shrinks, and a large file's streams would fill it before
  // the garbage collector frees them.
  const decoded = stream.readStream();
  try {
    stream.writeStream(decoded);
  } finally {
    decoded.destroy();
  }
}

function run(document: mupdf.PDFDocument, strip: boolean): Walk {
  const walk: Walk = { document, strip, removed: new Set(), reached: new Map(), deleted: new Map(), parents: [] };
  walkObject(walk, document.getTrailer(), "FileTrailer", "trailer");
  // A /Parent is not walked, as the walk reaches the tree from its root: it must be a node of it.
  for (const { value, path } of walk.parents) {
    const roles = value.isIndirect() ? walk.reached.get(value.asIndirect()) : undefined;
    if (![...(roles ?? [])].some((role) => PAGE_TREE.has(role))) throw new Unplaced(path);
  }
  return walk;
}

/**
 * Step 7: deletes every key its object's role does not keep, and cuts image metadata. Returns
 * the kinds deleted, or "refused" when an object fits no role.
 */
export function stripToAllowlist(document: mupdf.PDFDocument): ReadonlySet<RemovalKind> | "refused" {
  try {
    return run(document, true).removed;
  } catch (error) {
    if (error instanceof Unplaced) return "refused";
    throw error;
  }
}

/** The structural check: the first key, as a path from the trailer, left outside the allowlist; "unplaced" for an object with no role; undefined when none. */
export function keyOutsideAllowlist(document: mupdf.PDFDocument): string | "unplaced" | undefined {
  try {
    run(document, false);
    return undefined;
  } catch (error) {
    if (error instanceof Outside) return error.message;
    if (error instanceof Unplaced) return "unplaced";
    throw error;
  }
}

