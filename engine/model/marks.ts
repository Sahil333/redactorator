import type { Edit } from "./document";
import type { Box, PageIndex } from "./geometry";
import { imageKey, type ImageAnchor } from "./images";
import { keyOf } from "./match";
import { markTypeLabel, type MarkType } from "./markTypes";

/**
 * The part of a text mark on one page: a range of that page's text, one box per line, and the
 * letters it was made on. The text and boxes are the mark's identity; the offsets point at them in
 * the page's text as this build reads it, and are found again when a build reads it otherwise
 * (`textAnchor.ts`). Empty text is unknown, so the piece is lost.
 */
export interface TextPiece {
  readonly page: PageIndex;
  readonly start: number;
  readonly end: number;
  readonly boxes: readonly Box[];
  readonly text: string;
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

export const markPages = (target: MarkTarget): readonly PageIndex[] =>
  target.kind === "box" ? [target.page] : target.pieces.map((piece) => piece.page);

/** Where a mark is drawn on one page. */
export function boxesOn(target: MarkTarget, page: PageIndex): readonly Box[] {
  if (target.kind === "box") return target.page === page ? [target.box] : [];
  return target.pieces.find((piece) => piece.page === page)?.boxes ?? [];
}

export const firstPage = (target: MarkTarget): PageIndex =>
  target.kind === "box" ? target.page : target.pieces[0].page;

/** The marked text, or "Box". Shown only in the marks list, never sent anywhere. */
export const markName = (mark: Pick<Mark, "target">): string =>
  mark.target.kind === "text" ? mark.target.text : "Box";

/** The engine's edits for a mark: one per page it covers. */
export function toEdits(mark: Mark): Edit[] {
  const label = markTypeLabel(mark.type);
  const { target } = mark;
  if (target.kind === "box") return [{ kind: "box", page: target.page, box: target.box, label }];
  return target.pieces.map(({ page, start, end, text }) => ({ kind: "text", page, start, end, text, label }));
}
