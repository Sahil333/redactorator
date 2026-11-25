import { describe, expect, test } from "vitest";
import { pointBox, type Box } from "../model/geometry";
import { missingGlyphs, movedGlyphs, type PageGlyph } from "./glyphs";

function box(x0: number, y0: number, x1: number, y1: number): Box {
  const made = pointBox(x0, y0, x1, y1);
  if (made === undefined) throw new Error("Not a box");
  return made;
}

// Helvetica's advance widths at 12 pt, and the letters of a line set from x 72, shifted by `by`.
const WIDTHS: Record<string, number> = { R: 8.664, e: 6.672, a: 6.672, d: 6.672, " ": 3.336, t: 3.336, h: 6.672, b: 6.672, o: 6.672, u: 6.672, i: 2.664 };
function line(text: string, by = 0): PageGlyph[] {
  let x = 72 + by;
  return [...text].map((c) => {
    const width = WIDTHS[c] ?? 6;
    const glyph: PageGlyph = { c, box: box(x, 79.1, x + width, 95.6), body: box(x, 83, x + width, 92), origin: [x, 92] };
    x += width;
    return glyph;
  });
}

const original = line("Read the about it");
const shiftedLine = line("Read the about it", -3.336);
// "the" is letters 5 to 7; the spaces around it are 4 and 8, and "about" starts at 9.
const the = box(original[5]?.box.x0 ?? 0, 79.1, original[7]?.box.x1 ?? 0, 95.6);
const without = (letters: readonly PageGlyph[], gone: readonly number[]) => letters.filter((_, index) => !gone.includes(index));
const withoutThe = without(original, [5, 6, 7]);

describe("missingGlyphs and movedGlyphs", () => {
  test("find nothing when only the text under the box is gone", () => {
    expect(missingGlyphs(original, withoutThe, [the])).toEqual([]);
    expect(movedGlyphs(original, withoutThe, [the])).toEqual([]);
  });

  test("call the rest of a line that moved back moved, not missing", () => {
    const moved = [...original.slice(0, 5), ...shiftedLine.slice(8)];
    expect(missingGlyphs(original, moved, [the])).toEqual([]);
    expect(movedGlyphs(original, moved, [the]).map((glyph) => glyph.c).join("")).toBe("aboutit");
  });

  test("call a letter no box touches, gone from its baseline, missing", () => {
    expect(missingGlyphs(original, without(original, [5, 6, 7, 10]), [the])).toEqual([original[10]]);
    expect(movedGlyphs(original, without(original, [5, 6, 7, 10]), [the])).toEqual([]);
  });

  test("leave out letters a box touches, and spaces", () => {
    const reachingA = box(the.x0, the.y0, the.x1 + 4, the.y1);
    expect(missingGlyphs(original, without(original, [4, 5, 6, 7, 8, 9]), [reachingA])).toEqual([]);
  });

  test("count a letter drawn twice in one place twice", () => {
    expect(missingGlyphs([...original, ...original.slice(0, 1)], original, [])).toEqual(original.slice(0, 1));
  });

  test("ignore letters only added", () => {
    expect(missingGlyphs(original, [...original, ...line("[ADDRESS]", 30)], [])).toEqual([]);
  });

  test("call a letter on another line missing, not moved", () => {
    const lower = original.map((glyph): PageGlyph => ({ ...glyph, box: box(glyph.box.x0, 99.1, glyph.box.x1, 115.6), origin: [glyph.origin[0], 112] }));
    expect(missingGlyphs(original, lower, []).length).toBeGreaterThan(0);
    expect(movedGlyphs(original, lower, [])).toEqual([]);
  });
});
