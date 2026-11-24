// Spreading: how approving a document hides its values, and parts of its images, in the
// project's other documents. Pure functions over the project, the documents' stored readings and
// where the engine found each value in their text; nothing spreads until a document is approved.
import type { PageText, Reading } from "../engine/model/document";
import type { Box, PageIndex } from "../engine/model/geometry";
import { rangeBoxes, rangeText } from "../engine/model/pageText";
import { anchorOf, placesOnCopies } from "../engine/model/images";
import { markKey, markName, nextId, type Mark } from "./marks";
import type { DocumentId, HiddenValue, Project, ProjectDocument } from "./project";

/** How far a hidden value reaches in the project. */
export interface Reach {
  readonly places: number;
  readonly documents: number;
}

/** How many places, in how many documents, each value is marked, by key. */
export function reachOf(project: Project): Map<string, Reach> {
  const reach = new Map<string, Reach>();
  for (const document of project.documents) {
    const keys = document.marks.flatMap((mark) => markKey(mark) ?? []);
    for (const key of new Set(keys)) {
      const { places = 0, documents = 0 } = reach.get(key) ?? {};
      reach.set(key, { places: places + keys.filter((each) => each === key).length, documents: documents + 1 });
    }
  }
  return reach;
}

/** The files whose approval brought `document`'s new marks. */
export function newFrom(project: Project, document: ProjectDocument): string[] {
  const hidden = new Map(project.hidden.map((value) => [value.key, value]));
  const from = new Set(document.marks.filter((mark) => mark.isNew).flatMap((mark) => hidden.get(markKey(mark) ?? "")?.from ?? []));
  return project.documents.filter((each) => from.has(each.id) && each.id !== document.id).map((each) => each.file);
}

/** Where a key was found in one document's stored text. */
export interface TextPlace {
  readonly document: DocumentId;
  readonly key: string;
  readonly page: PageIndex;
  readonly start: number;
  readonly end: number;
}

/** Where a hidden part of an image falls on a copy of that image. */
interface ImagePlace {
  readonly document: DocumentId;
  readonly key: string;
  readonly page: PageIndex;
  readonly box: Box;
}

type Place = TextPlace | ImagePlace;

/** What a spread did to one document. */
export interface Change {
  readonly document: DocumentId;
  /** Places newly hidden. */
  readonly hidden: number;
  /** Places no longer hidden, because their value stopped being hidden. */
  readonly shown: number;
  /** Marks given their value's new type. */
  readonly retyped: number;
}

export const changed = (change: Change) => change.hidden + change.shown + change.retyped > 0;

/** Whether a text mark already covers [start, end) on `page`. */
const coveredText = (marks: readonly Mark[], page: PageIndex, start: number, end: number) =>
  marks.some(
    ({ target }) => target.kind === "text" && target.pieces.some((piece) => piece.page === page && piece.start <= start && piece.end >= end),
  );

// Boxes are kept to a ten-thousandth of their image, so a copy laid over its own image can land a little off.
const BOX_TOLERANCE = 0.5;

/** Whether a box mark already covers `box` on `page`. */
const coveredBox = (marks: readonly Mark[], page: PageIndex, box: Box) =>
  marks.some(
    ({ target }) =>
      target.kind === "box" &&
      target.page === page &&
      target.box.x0 <= box.x0 + BOX_TOLERANCE &&
      target.box.y0 <= box.y0 + BOX_TOLERANCE &&
      target.box.x1 >= box.x1 - BOX_TOLERANCE &&
      target.box.y1 >= box.y1 - BOX_TOLERANCE,
  );

/** `marks` without those of stopped values, and each of a hidden value in that value's type, flagged new when `flag` is set. */
function keptMarks(marks: readonly Mark[], hidden: ReadonlyMap<string, HiddenValue>, stopped: ReadonlySet<string>, flag: boolean) {
  let shown = 0;
  let retyped = 0;
  const kept: Mark[] = [];
  for (const mark of marks) {
    const key = markKey(mark);
    const value = key === undefined ? undefined : hidden.get(key);
    if (key !== undefined && stopped.has(key)) shown++;
    else if (value !== undefined && value.type !== mark.type) {
      retyped++;
      kept.push({ ...mark, type: value.type, isNew: mark.isNew || flag });
    } else kept.push(mark);
  }
  return { marks: kept, shown, retyped };
}

/** A mark of `value` over [start, end) on a page, or undefined when that range has no boxes. */
function textMark(id: number, value: HiddenValue, text: PageText, { page, start, end }: TextPlace, isNew: boolean): Mark | undefined {
  const [first, ...rest] = rangeBoxes(text, start, end);
  if (first === undefined) return undefined;
  const piece = { page, start, end, boxes: [first, ...rest] };
  return { id, type: value.type, linkId: "", isNew, target: { kind: "text", text: rangeText(text, start, end), pieces: [piece] } };
}

/** A mark of `value` at `place`, unless a mark there already covers it. */
function placeMark(marks: readonly Mark[], value: HiddenValue, texts: readonly PageText[], place: Place, isNew: boolean): Mark | undefined {
  const id = nextId(marks);
  if (!("box" in place)) {
    const text = texts[place.page];
    return text === undefined || coveredText(marks, place.page, place.start, place.end) ? undefined : textMark(id, value, text, place, isNew);
  }
  if (coveredBox(marks, place.page, place.box)) return undefined;
  const image = value.image && { image: value.image };
  return { id, type: value.type, linkId: "", isNew, target: { kind: "box", page: place.page, box: place.box, ...image } };
}

/**
 * `document` with every place of each hidden value marked, unless it keeps that value visible,
 * marks of stopped values gone, and each mark of a hidden value in that value's type. Marks this
 * adds or retypes are new when `flag` is set, for the user to review.
 */
function spreadInto(
  document: ProjectDocument,
  texts: readonly PageText[],
  places: readonly Place[],
  hidden: ReadonlyMap<string, HiddenValue>,
  stopped: ReadonlySet<string>,
  flag: boolean,
): { readonly document: ProjectDocument; readonly change: Change } {
  const { marks, shown, retyped } = keptMarks(document.marks, hidden, stopped, flag);
  const before = marks.length;
  const keptVisible = new Set(document.shown);
  for (const place of places) {
    const value = hidden.get(place.key);
    const mark = value === undefined || keptVisible.has(place.key) ? undefined : placeMark(marks, value, texts, place, flag);
    if (mark !== undefined) marks.push(mark);
  }
  return { document: { ...document, marks }, change: { document: document.id, hidden: marks.length - before, shown, retyped } };
}

/** The keys of text values hidden in the project. */
export const hiddenTextKeys = (project: Project): string[] => project.hidden.flatMap((value) => (value.image === undefined ? [value.key] : []));

/** The text keys to look for when approving document `id`: the project's hidden values and the document's own. */
export function keysToFind(project: Project, id: DocumentId): string[] {
  const own = project.documents.find((document) => document.id === id)?.marks.flatMap((mark) => (mark.target.kind === "text" ? (markKey(mark) ?? []) : [])) ?? [];
  return [...new Set([...hiddenTextKeys(project), ...own])];
}

/** Where each hidden part of an image falls on every copy of its image in the documents read. */
function imagePlaces(values: Iterable<HiddenValue>, readings: ReadonlyMap<DocumentId, Reading>): ImagePlace[] {
  const places: ImagePlace[] = [];
  for (const { key, image } of values) {
    if (image === undefined) continue;
    for (const [document, { images }] of readings) {
      for (const { page, box } of placesOnCopies(image, images)) places.push({ document, key, page, box });
    }
  }
  return places;
}

/** A document's marks, with each box that lies mostly on an image anchored to that image's part. */
function anchored(document: ProjectDocument, reading: Reading | undefined): ProjectDocument {
  const marks = document.marks.map((mark): Mark => {
    const { target } = mark;
    if (target.kind !== "box" || target.image !== undefined) return mark;
    const image = anchorOf(target.page, target.box, reading?.images ?? []);
    return image === undefined ? mark : { ...mark, target: { ...target, image } };
  });
  return { ...document, marks };
}

/** A document's own values and image parts, by key, as approving it would hide them. */
function ownValues(document: ProjectDocument): Map<string, HiddenValue> {
  const own = new Map<string, HiddenValue>();
  for (const mark of document.marks) {
    const key = markKey(mark);
    if (key === undefined) continue;
    const image = mark.target.kind === "box" ? mark.target.image : undefined;
    own.set(key, { key, text: markName(mark), type: mark.type, from: document.id, ...(image && { image }) });
  }
  return own;
}

export interface Approval {
  readonly project: Project;
  /** What approving does to each other document it changes. */
  readonly changes: readonly Change[];
  /** What it does to the approved document itself: more places of its own values. */
  readonly here: Change;
}

/**
 * Approves document `id`. Its values, and the parts of images its boxes lie mostly on, become
 * hidden in the whole project, in their types, and a hidden value it no longer marks where it
 * appears, and does not keep visible on purpose, stops being hidden anywhere. Every document
 * then has each hidden value marked wherever it is found; another document this changes goes
 * back to review with the changes flagged as new. `textPlaces` are where the engine found
 * `keysToFind`'s keys in every document's text; `readings` are every document's.
 */
export function approve(
  project: Project,
  id: DocumentId,
  readings: ReadonlyMap<DocumentId, Reading>,
  textPlaces: readonly TextPlace[],
): Approval | undefined {
  const found = project.documents.find((document) => document.id === id);
  if (found === undefined) return undefined;
  const approving = anchored(found, readings.get(id));
  const own = ownValues(approving);
  const sought = new Map([...project.hidden, ...own.values()].map((value) => [value.key, value]));
  const places: Place[] = [...textPlaces, ...imagePlaces(sought.values(), readings)];
  const foundHere = new Set(places.filter((place) => place.document === id).map((place) => place.key));
  // A value stops being hidden when this document no longer marks it but had it: it is in the
  // document's text, or it came from this document (it may not be found again, as when it was
  // marked across a page break).
  const hadHere = (value: HiddenValue) => foundHere.has(value.key) || value.from === id;
  const keptVisible = new Set(approving.shown);
  const stopped = new Set(
    project.hidden.filter((value) => !own.has(value.key) && !keptVisible.has(value.key) && hadHere(value)).map(({ key }) => key),
  );
  const hidden = new Map(project.hidden.filter(({ key }) => !stopped.has(key)).map((value) => [value.key, value]));
  for (const [key, value] of own) {
    const before = hidden.get(key);
    hidden.set(key, before?.type === value.type ? before : value);
  }

  const changes: Change[] = [];
  let here: Change = { document: id, hidden: 0, shown: 0, retyped: 0 };
  const documents = project.documents.map((each): ProjectDocument => {
    const isApproving = each.id === id;
    const document = isApproving ? approving : each;
    const texts = readings.get(document.id)?.texts ?? [];
    const spread = spreadInto(document, texts, places.filter((place) => place.document === document.id), hidden, stopped, !isApproving);
    const download = changed(spread.change) && document.download === "downloaded" ? "changed" : document.download;
    if (isApproving) {
      here = spread.change;
      const marks = spread.document.marks.map((mark) => (mark.isNew ? { ...mark, isNew: false } : mark));
      return { ...spread.document, marks, review: "approved", download };
    }
    if (!changed(spread.change)) return each;
    changes.push(spread.change);
    return { ...spread.document, review: "in-review", download };
  });
  return { project: { ...project, hidden: [...hidden.values()], documents }, changes, here };
}

/**
 * Documents being added, with the project's hidden values and image parts marked wherever they
 * are found, as new. One with any is in review; one with none has not been started.
 */
export function spreadToAdded(
  project: Project,
  added: readonly ProjectDocument[],
  readings: ReadonlyMap<DocumentId, Reading>,
  textPlaces: readonly TextPlace[],
): ProjectDocument[] {
  const hidden = new Map(project.hidden.map((value) => [value.key, value]));
  const places: Place[] = [...textPlaces, ...imagePlaces(project.hidden, readings)];
  return added.map((document) => {
    const texts = readings.get(document.id)?.texts ?? [];
    const spread = spreadInto(document, texts, places.filter((place) => place.document === document.id), hidden, new Set(), true);
    return { ...spread.document, review: spread.document.marks.length > 0 ? "in-review" : "not-started" };
  });
}
