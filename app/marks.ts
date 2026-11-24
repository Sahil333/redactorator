import type { Edit } from "../engine/model/document";
import type { Box, PageIndex } from "../engine/model/geometry";
import { keyOf } from "../engine/model/match";
import { imageKey, type ImageAnchor } from "./images";
import { markTypeLabel, type MarkType } from "./markTypes";
import type { Selection } from "./selection";

export type Tool = "text" | "box";

// A box smaller than this on either side is taken as a stray click, and the keyboard
// cannot shrink one below it.
export const MIN_BOX_POINTS = 3;

/** The part of a text mark on one page: a range of that page's text, and one box per line. */
export interface TextPiece {
  readonly page: PageIndex;
  readonly start: number;
  readonly end: number;
  readonly boxes: readonly Box[];
}

/**
 * What a mark covers: text, in one piece per page it runs across, or a drawn box. A box that
 * lies mostly on an image has that image's anchor once its document is approved, or when it
 * was spread there.
 */
export type MarkTarget =
  | { readonly kind: "text"; readonly text: string; readonly pieces: readonly [TextPiece, ...TextPiece[]] }
  | { readonly kind: "box"; readonly page: PageIndex; readonly box: Box; readonly image?: ImageAnchor };

export type TextTarget = Extract<MarkTarget, { kind: "text" }>;

export interface Mark {
  readonly id: number;
  readonly type: MarkType;
  readonly target: MarkTarget;
  /** Labelling mode only: marks of the same person or thing share one. Empty for none. */
  readonly linkId: string;
  /** Brought here by approving another document, or by adding this one, and not yet approved here. */
  readonly isNew: boolean;
}

export const nextId = (marks: readonly Mark[]) => Math.max(0, ...marks.map((mark) => mark.id)) + 1;

/** The key a mark spreads by; undefined for a box on no image, or for text with no letters or digits. */
export function markKey(mark: Pick<Mark, "target">): string | undefined {
  if (mark.target.kind === "box") return mark.target.image && imageKey(mark.target.image);
  const key = keyOf(mark.target.text);
  return key === "" ? undefined : key;
}

/**
 * What the marks panel lists as one item: every mark of one value, or of one part of an image,
 * which hide and spread together; or one box on no image.
 */
export const itemKey = (mark: Mark): string => markKey(mark) ?? `mark:${mark.id}`;

/** A mark the user has drawn but not yet given a type, and for text the selection it came from. */
export interface Pending {
  readonly target: MarkTarget;
  readonly selection: Selection | undefined;
}

export const markPages = (target: MarkTarget): readonly PageIndex[] =>
  target.kind === "box" ? [target.page] : target.pieces.map((piece) => piece.page);

/** Where a mark is drawn on one page. */
export function boxesOn(target: MarkTarget, page: PageIndex): readonly Box[] {
  if (target.kind === "box") return target.page === page ? [target.box] : [];
  return target.pieces.find((piece) => piece.page === page)?.boxes ?? [];
}

export const firstPage = (target: MarkTarget): PageIndex =>
  target.kind === "box" ? target.page : target.pieces[0].page;

/** "page 2", or "pages 2–3" for text that runs across pages. */
export function pagesLabel(target: MarkTarget): string {
  const first = firstPage(target) + 1;
  const last = target.kind === "text" ? (target.pieces.at(-1)?.page ?? 0) + 1 : first;
  return last === first ? `page ${first}` : `pages ${first}–${last}`;
}

/** The marked text, or "Box". Shown only in the marks list, never sent anywhere. */
export const markName = (mark: Pick<Mark, "target">): string =>
  mark.target.kind === "text" ? mark.target.text : "Box";

/** The engine's edits for a mark: one per page it covers. */
export function toEdits(mark: Mark): Edit[] {
  const label = markTypeLabel(mark.type);
  const { target } = mark;
  if (target.kind === "box") return [{ kind: "box", page: target.page, box: target.box, label }];
  return target.pieces.map(({ page, start, end }) => ({ kind: "text", page, start, end, label }));
}
