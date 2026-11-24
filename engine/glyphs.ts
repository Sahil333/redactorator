// The letters on a page, as the checks on a cleaned file compare them.
import type { Box } from "./model/geometry";

export type Point = readonly [number, number];

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
