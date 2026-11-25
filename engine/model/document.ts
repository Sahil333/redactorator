import type { Brand } from "./brand";
import type { Box, Matrix, PageIndex, Points } from "./geometry";

/** RED-6: the colour of each redaction box, as `#rrggbb`, and whether it carries a `[TYPE]` label. */
export interface Appearance {
  readonly colour: string;
  readonly label: boolean;
}

export interface PageModel {
  readonly index: PageIndex;
  readonly width: Points;
  readonly height: Points;
}

export interface DocumentModel {
  readonly pages: readonly [PageModel, ...PageModel[]];
}

/**
 * One character of a page's text: MuPDF's structured-text blocks and lines, put in
 * reading order by `readingOrder` (engine/model/pageText.ts). A line ends with a "\n"
 * entry and a block with a second one; those have no box. Lines and blocks with no
 * characters add nothing. A character's
 * index in `PageText.chars` is its offset, as the ground-truth schema counts them.
 */
export type PageChar = { readonly c: string; readonly box: Box } | { readonly c: "\n"; readonly box: undefined };

export interface PageText {
  readonly chars: readonly PageChar[];
}

/**
 * An image drawn on a page, which a box over it can spread from or to. Images too small, too
 * plain, or filling most of their page to be told apart from others are not listed.
 */
export interface PlacedImage {
  readonly page: PageIndex;
  /** Places the image's unit square in page space (see `Points`), its first row of pixels at y = 0. */
  readonly matrix: Matrix;
  /** Its width over its height, in pixels. */
  readonly aspect: number;
  /**
   * A difference hash of a 9 × 8 grey copy, 64 bits as 16 hex digits: whether each cell is
   * darker than the next one along. Copies at any size, or saved again, share most bits.
   */
  readonly fingerprint: string;
}

/** What the engine reads from a document for the project to keep: each page's text and its images. */
export interface Reading {
  readonly texts: readonly [PageText, ...PageText[]];
  readonly images: readonly PlacedImage[];
}

/**
 * What the user marked: a range of a page's text, with the letters the mark was made on, or a box
 * with no text behind it.
 */
export type Edit =
  | { readonly kind: "text"; readonly page: PageIndex; readonly start: number; readonly end: number; readonly text: string; readonly label: string }
  | { readonly kind: "box"; readonly page: PageIndex; readonly box: Box; readonly label: string };

/** Which document a render reads: the document's working copy, or the cleaned output. */
export type Source = "original" | "output";

/** A drawn page: `width` by `height` pixels, row by row, four bytes each (red, green, blue, alpha). */
export interface Pixels {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8ClampedArray<ArrayBuffer>;
}

/**
 * Names the exact way a build prepares and reads documents, its PDF engine's build included. A
 * different tag means each document's working copy and reading must be made again.
 */
export type ReaderTag = Brand<string, "ReaderTag">;

/** A format's name and a number, like `pdf-3`; a later build of the format has a higher number. */
export const isReaderTag = (value: unknown): value is ReaderTag => typeof value === "string" && /^[a-z]+-\d+$/.test(value);

export function readerTag(value: string): ReaderTag {
  if (!isReaderTag(value)) throw new Error("Not a reader tag");
  return value;
}

/** What preparing a document removed from it, by kind; never what or how much. */
export const removalKinds = [
  "metadata",
  "image-metadata",
  "annotations",
  "form-data",
  "signatures",
  "pending-redactions",
  "attachments",
  "scripts-actions",
  "links",
  "bookmarks",
  "page-labels",
  "accessibility-tags",
  "marked-content",
  "hidden-layers",
  "outside-page",
  "unshown-image-pixels",
  "thumbnails",
  "app-data",
  "old-revisions",
] as const;

export type RemovalKind = (typeof removalKinds)[number];
