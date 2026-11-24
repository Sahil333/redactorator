// Spreading boxes over images: a box that lies mostly on an image is kept in that image's own
// frame, so it can be laid over every copy of the image, at whatever size and turn it is drawn.
import type { PlacedImage } from "./document";
import { pointBox, type Box, type Matrix, type PageIndex } from "./geometry";

/** A box's part of the image it lies mostly on. */
export interface ImageAnchor {
  /** The image's fingerprint (see `PlacedImage`). */
  readonly fingerprint: string;
  readonly aspect: number;
  /** The box in the image's unit square, [x0, y0, x1, y1], 0 to 1 from its first column and row. */
  readonly frame: readonly [number, number, number, number];
}

// Copies differ in a few of the fingerprint's 64 bits; unrelated images in about half of them.
const MAX_DIFFERING_BITS = 10;
// Copies keep their shape; this much stretch is allowed either way.
const MAX_ASPECT_RATIO = 1.1;

type Point = readonly [number, number];

const apply = ([a, b, c, d, e, f]: Matrix, [x, y]: Point): Point => [a * x + c * y + e, b * x + d * y + f];

function invert([a, b, c, d, e, f]: Matrix): Matrix | undefined {
  const det = a * d - b * c;
  if (det === 0) return undefined;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

const xs = (points: readonly Point[]) => points.map(([x]) => x);
const ys = (points: readonly Point[]) => points.map(([, y]) => y);

const corners = (x0: number, y0: number, x1: number, y1: number): Point[] => [
  [x0, y0],
  [x1, y0],
  [x0, y1],
  [x1, y1],
];

/** The smallest box around `points`, or undefined when one is not a finite number. */
const around = (points: readonly Point[]): Box | undefined =>
  pointBox(Math.min(...xs(points)), Math.min(...ys(points)), Math.max(...xs(points)), Math.max(...ys(points)));

/** Where an image is drawn on its page, as the box around it. */
const placedBox = (image: PlacedImage) => around(corners(0, 0, 1, 1).map((corner) => apply(image.matrix, corner)));

const area = (box: Box) => (box.x1 - box.x0) * (box.y1 - box.y0);

function overlap(a: Box, b: Box): Box | undefined {
  const box = pointBox(Math.max(a.x0, b.x0), Math.max(a.y0, b.y0), Math.min(a.x1, b.x1), Math.min(a.y1, b.y1));
  return box && box.x0 < box.x1 && box.y0 < box.y1 ? box : undefined;
}

const clamp = (n: number) => Math.round(Math.min(Math.max(n, 0), 1) * 10_000) / 10_000;

/**
 * The image a box on `page` lies mostly on, at least half of it, and the box in that image's
 * frame; undefined when no image has half of it, so the box stays in its document.
 */
export function anchorOf(page: PageIndex, box: Box, images: readonly PlacedImage[]): ImageAnchor | undefined {
  let best: { image: PlacedImage; part: Box } | undefined;
  for (const image of images) {
    const placed = image.page === page ? placedBox(image) : undefined;
    const part = placed && overlap(box, placed);
    if (part !== undefined && area(part) >= area(box) / 2 && (best === undefined || area(part) > area(best.part))) best = { image, part };
  }
  const unit = best && invert(best.image.matrix);
  if (best === undefined || unit === undefined) return undefined;
  const inFrame = corners(best.part.x0, best.part.y0, best.part.x1, best.part.y1).map((corner) => apply(unit, corner));
  const frame = [clamp(Math.min(...xs(inFrame))), clamp(Math.min(...ys(inFrame))), clamp(Math.max(...xs(inFrame))), clamp(Math.max(...ys(inFrame)))] as const;
  return { fingerprint: best.image.fingerprint, aspect: best.image.aspect, frame };
}

/** The number of bits two fingerprints differ in. */
function differingBits(a: string, b: string): number {
  let count = 0;
  for (let at = 0; at < a.length; at++) {
    for (let bits = Number.parseInt(a[at] ?? "0", 16) ^ Number.parseInt(b[at] ?? "0", 16); bits > 0; bits >>= 1) count += bits & 1;
  }
  return count;
}

/** Whether `image` is a copy of the anchor's image: it looks alike and has the same shape. */
const isCopy = (anchor: ImageAnchor, image: PlacedImage) =>
  differingBits(anchor.fingerprint, image.fingerprint) <= MAX_DIFFERING_BITS &&
  Math.max(anchor.aspect, image.aspect) / Math.min(anchor.aspect, image.aspect) <= MAX_ASPECT_RATIO;

/** Where the anchor's box lands on each copy of its image among `images`. */
export function placesOnCopies(anchor: ImageAnchor, images: readonly PlacedImage[]): { readonly page: PageIndex; readonly box: Box }[] {
  const [x0, y0, x1, y1] = anchor.frame;
  return images.flatMap((image) => {
    const box = isCopy(anchor, image) ? around(corners(x0, y0, x1, y1).map((corner) => apply(image.matrix, corner))) : undefined;
    return box === undefined ? [] : [{ page: image.page, box }];
  });
}

/** The key a box over an image spreads by. Text keys are folded to lower case, so none starts "Image". */
export const imageKey = (anchor: ImageAnchor): string => `Image ${anchor.fingerprint} ${anchor.frame.join(" ")}`;

// Images that can't be told apart from others are not listed, so a box over one stays put.
export const MIN_IMAGE_SIDE = 32;
/** How far apart, of 255, the darkest and lightest cells of the grey copy must be. */
const MIN_IMAGE_CONTRAST = 12;
export const GRID_COLUMNS = 9;
export const GRID_ROWS = 8;

/** The grid's difference hash (see `PlacedImage`), or undefined when it is too plain to tell apart. */
export function fingerprintOf(cells: readonly number[]): string | undefined {
  if (Math.max(...cells) - Math.min(...cells) < MIN_IMAGE_CONTRAST) return undefined;
  let hex = "";
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let half = 0; half < 2; half++) {
      let nibble = 0;
      for (let column = half * 4; column < half * 4 + 4; column++) {
        const at = row * GRID_COLUMNS + column;
        nibble = (nibble << 1) | ((cells[at] ?? 0) < (cells[at + 1] ?? 0) ? 1 : 0);
      }
      hex += nibble.toString(16);
    }
  }
  return hex;
}
