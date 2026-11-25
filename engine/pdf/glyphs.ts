// The letters on a page, as the checks on a prepared or cleaned file compare them.
import type * as mupdf from "mupdf";
import type { Box } from "../model/geometry";
import { around, bodyOf, quadCorners, type Point } from "./geometry";

/** A letter drawn on a page. */
export interface PageGlyph {
  readonly c: string;
  readonly box: Box;
  /**
   * The letter itself: its width, from the baseline up to cap height. MuPDF removes a glyph
   * a redaction overlaps at all, judged on the glyph's ink, which is smaller than `box`: a
   * line's boxes overlap the next line's in ordinary text, so `box` would find text that is
   * not under the redaction.
   */
  readonly body: Box;
  /** Where the letter's baseline starts. */
  readonly origin: Point;
}

/** Every letter MuPDF reads on the page with `options`, in its own order. */
export function glyphsOf(page: mupdf.Page, options: string): PageGlyph[] {
  const text = page.toStructuredText(options);
  const found: PageGlyph[] = [];
  try {
    text.walk({
      onChar(c, origin, _font, size, quad) {
        found.push({ c, box: around(quadCorners(quad)), body: bodyOf(origin, size, quad), origin: [origin[0], origin[1]] });
      },
    });
  } finally {
    text.destroy();
  }
  return found;
}

export const centre = (box: Box): Point => [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2];
export const inside = (box: Box, [x, y]: Point) => x > box.x0 && x < box.x1 && y > box.y0 && y < box.y1;

// Less than this much overlap, in points, is two boxes that only touch.
const TOUCH = 0.01;
export const overlap = (a: Box, b: Box) =>
  Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > TOUCH && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > TOUCH;

// How far, in points, a letter may be from where it was and still be where it was.
const SAME_PLACE = 0.05;
const samePlace = (a: Box, b: Box) =>
  Math.abs(a.x0 - b.x0) <= SAME_PLACE &&
  Math.abs(a.y0 - b.y0) <= SAME_PLACE &&
  Math.abs(a.x1 - b.x1) <= SAME_PLACE &&
  Math.abs(a.y1 - b.y1) <= SAME_PLACE;
const sameBaseline = (a: PageGlyph, b: PageGlyph) => Math.abs(a.origin[1] - b.origin[1]) <= SAME_PLACE;

/**
 * Each letter of the original page that no box touches, and that the cleaned page lacks: with
 * no cleaned letter of the same character at the same place, either `moved` (one on the same
 * baseline elsewhere) or `missing` (none there either). Spaces draw nothing. Each cleaned letter
 * stands for one original, so a letter drawn twice in one place must still be there twice.
 */
function compared(original: readonly PageGlyph[], cleaned: readonly PageGlyph[], boxes: readonly Box[]) {
  // The cleaned letters not yet matched to an original, by character.
  const left = Map.groupBy(cleaned, (glyph) => glyph.c);
  const take = (glyph: PageGlyph, fits: (each: PageGlyph) => boolean) => {
    const candidates = left.get(glyph.c) ?? [];
    const at = candidates.findIndex(fits);
    if (at !== -1) candidates.splice(at, 1);
    return at !== -1;
  };
  // A box touches the letter, so it may be removed with the text under that box.
  const touched = (glyph: PageGlyph) => boxes.some((box) => overlap(box, glyph.body) || inside(box, centre(glyph.box)));
  const unplaced = original.filter((glyph) => glyph.c.trim() !== "" && !touched(glyph) && !take(glyph, (each) => samePlace(each.box, glyph.box)));
  const missing: PageGlyph[] = [];
  const moved: PageGlyph[] = [];
  for (const glyph of unplaced) (take(glyph, (each) => sameBaseline(each, glyph)) ? moved : missing).push(glyph);
  return { missing, moved };
}

/** The original's letters that no box touches and that are gone from the cleaned page, at that place and anywhere on their baseline. */
export const missingGlyphs = (original: readonly PageGlyph[], cleaned: readonly PageGlyph[], boxes: readonly Box[]): PageGlyph[] =>
  compared(original, cleaned, boxes).missing;

/** The original's letters that no box touches and that are on the cleaned page only elsewhere on their baseline. */
export const movedGlyphs = (original: readonly PageGlyph[], cleaned: readonly PageGlyph[], boxes: readonly Box[]): PageGlyph[] =>
  compared(original, cleaned, boxes).moved;

/**
 * Whether a letter of the original page that no box touches is missing from the cleaned page or
 * has moved: removing text must leave the rest where it was. Spaces draw nothing, and a letter a
 * box touches may be removed with the text under it. Each cleaned letter stands for one
 * original, so a letter drawn twice in one place must still be there twice.
 */
export function textMoved(original: readonly PageGlyph[], cleaned: readonly PageGlyph[], boxes: readonly Box[]): boolean {
  // The cleaned letters not yet matched to an original, by character.
  const unmatched = Map.groupBy(cleaned, (glyph) => glyph.c);
  const touched = (glyph: PageGlyph) => boxes.some((box) => overlap(box, glyph.body) || inside(box, centre(glyph.box)));
  return original.some((glyph) => {
    if (glyph.c.trim() === "" || touched(glyph)) return false;
    const candidates = unmatched.get(glyph.c) ?? [];
    const match = candidates.findIndex((each) => samePlace(each.box, glyph.box));
    if (match === -1) return true;
    candidates.splice(match, 1);
    return false;
  });
}
