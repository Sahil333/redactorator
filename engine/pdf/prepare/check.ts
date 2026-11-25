// Preparation step 9: the working copy checked against the user's file with MuPDF alone.
import type * as mupdf from "mupdf";
import { glyphsOf, missingGlyphs, movedGlyphs, type PageGlyph } from "../glyphs";
import { READING_OPTIONS } from "../readingOptions";
import { checkStructure } from "../structure";
import { withPage } from "../text";

/** The page's letters that show inside its visible area, which preparation must keep where they are. */
function shownGlyphs(page: mupdf.Page): PageGlyph[] {
  const [x0, y0, x1, y1] = page.getBounds();
  return glyphsOf(page, READING_OPTIONS).filter(({ box }) => box.x1 > x0 && box.x0 < x1 && box.y1 > y0 && box.y0 < y1);
}

/**
 * Whether the working copy keeps every letter the original draws on its visible pages at the
 * same place, and passes the structural check. Letters flattening added are not compared.
 */
export function preparedWell(original: mupdf.PDFDocument, working: mupdf.PDFDocument): boolean {
  const pages = original.countPages();
  if (working.countPages() !== pages) return false;
  for (let index = 0; index < pages; index++) {
    const before = withPage(original, index, shownGlyphs);
    const after = withPage(working, index, shownGlyphs);
    if (missingGlyphs(before, after, []).length > 0 || movedGlyphs(before, after, []).length > 0) return false;
  }
  return checkStructure(working) === undefined;
}
