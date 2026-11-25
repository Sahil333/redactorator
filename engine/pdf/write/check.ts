import * as mupdf from "mupdf";
import type { Appearance } from "../../model/document";
import type { Box, PageIndex } from "../../model/geometry";
import { around, transform, type Point } from "../geometry";
import { centre, glyphsOf, inside, missingGlyphs, movedGlyphs, overlap, type PageGlyph } from "../glyphs";
import { drawnParts, type PathPart } from "../paths";
import { READING_OPTIONS } from "../readingOptions";
import { checkStructure } from "../structure";
import { withPage } from "../text";
import { WriteRefused, type Redaction } from "./common";

/**
 * Text left on a page under its redaction boxes. Only our own labels may be there: each
 * box's glyphs must spell its label, and any other glyph a box overlaps at all is left behind.
 */
function textUnderBoxes(glyphs: readonly PageGlyph[], redactions: readonly Redaction[], appearance: Appearance): boolean {
  const ours = (glyph: PageGlyph) => redactions.some(({ box }) => inside(box, centre(glyph.box)));
  const left = glyphs.some(
    (glyph) => glyph.c.trim() !== "" && !ours(glyph) && redactions.some(({ box }) => overlap(box, glyph.body)),
  );
  return (
    left ||
    redactions.some(({ box, printed }) => {
      // Whitespace carries nothing, and MuPDF can leave a widened space where text was.
      const visible = (text: string) => text.replace(/\s/g, "");
      const under = glyphs.filter((glyph) => inside(box, centre(glyph.box)));
      return visible(under.map((glyph) => glyph.c).join("")) !== visible(appearance.label ? printed : "");
    })
  );
}

/**
 * Whether every pixel of `pixmap` that `box` overlaps has one value. MuPDF blanks every pixel
 * a redaction touches, even in part. `ctm` places the image's unit square on the page, its
 * first row at the top.
 */
function blankUnder(pixmap: mupdf.Pixmap, ctm: mupdf.Matrix, box: Box): boolean {
  const width = pixmap.getWidth();
  const height = pixmap.getHeight();
  // The components of one pixel, alpha included; a mask's only one is its alpha.
  const size = pixmap.getNumberOfComponents();
  const stride = pixmap.getStride();
  const samples = pixmap.getPixels();
  // The box's corners in the image's unit square, then the pixel rows and columns they reach.
  const unit = mupdf.Matrix.invert(ctm);
  const corners = [
    transform(unit, [box.x0, box.y0]),
    transform(unit, [box.x1, box.y0]),
    transform(unit, [box.x0, box.y1]),
    transform(unit, [box.x1, box.y1]),
  ];
  const reach = (axis: 0 | 1, count: number): readonly [number, number] => {
    const along = corners.map((corner) => corner[axis]);
    return [Math.max(Math.floor(Math.min(...along) * count), 0), Math.min(Math.ceil(Math.max(...along) * count), count)];
  };
  const [x0, x1] = reach(0, width);
  const [y0, y1] = reach(1, height);
  let first: string | undefined;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const pixel: Point[] = [
        [x / width, y / height],
        [(x + 1) / width, y / height],
        [x / width, (y + 1) / height],
        [(x + 1) / width, (y + 1) / height],
      ];
      if (!overlap(box, around(pixel.map((corner) => transform(ctm, corner))))) continue;
      const offset = y * stride + x * size;
      const value = samples.slice(offset, offset + size).join();
      first ??= value;
      if (value !== first) return false;
    }
  }
  return true;
}

/** Whether an image, or its mask, drawn on the page still shows anything under a box. */
function imagesUnderBoxes(page: mupdf.Page, redactions: readonly Redaction[]): boolean {
  let shows = false;
  const judge = (image: mupdf.Image, ctm: mupdf.Matrix) => {
    const placed = around([transform(ctm, [0, 0]), transform(ctm, [1, 0]), transform(ctm, [0, 1]), transform(ctm, [1, 1])]);
    const under = redactions.filter(({ box }) => overlap(box, placed));
    if (under.length === 0) return;
    const mask = image.getMask();
    try {
      for (const layer of mask === null ? [image] : [image, mask]) {
        const pixmap = layer.toPixmap();
        try {
          if (under.some(({ box }) => !blankUnder(pixmap, ctm, box))) shows = true;
        } finally {
          pixmap.destroy();
        }
      }
    } finally {
      mask?.destroy();
    }
  };
  // A throw inside MuPDF's callback could leave it half run, so failures are only noted here.
  let failed = false;
  const safely = (image: mupdf.Image, ctm: mupdf.Matrix) => {
    try {
      judge(image, ctm);
    } catch {
      failed = true;
    }
  };
  const device = new mupdf.Device({ fillImage: safely, fillImageMask: safely, clipImageMask: safely });
  try {
    page.run(device, mupdf.Matrix.identity);
    device.close();
  } finally {
    device.destroy();
  }
  return shows || failed;
}

// How far, in points, a side may lean and still count as horizontal or vertical.
const ALIGNED = 0.01;

/** A single rectangle with its sides along the page's axes: move, three lines and close. */
function isRectangle({ steps, points }: PathPart): boolean {
  if (steps !== "MLLLZ") return false;
  return points.every(([x, y], i) => {
    const [nextX, nextY] = points[(i + 1) % points.length] ?? [x, y];
    return Math.abs(nextX - x) <= ALIGNED || Math.abs(nextY - y) <= ALIGNED;
  });
}

const sameBox = (a: Box, b: Box) =>
  Math.abs(a.x0 - b.x0) <= ALIGNED && Math.abs(a.y0 - b.y0) <= ALIGNED && Math.abs(a.x1 - b.x1) <= ALIGNED && Math.abs(a.y1 - b.y1) <= ALIGNED;
const within = (box: Box, part: Box) => part.x0 >= box.x0 && part.y0 >= box.y0 && part.x1 <= box.x1 && part.y1 <= box.y1;

/**
 * The first box that covers part of a drawing it may not: a part MuPDF kept whole because the box
 * covers only some of it, unless it is a single rectangle or straight line, which hide nothing
 * outside the box. A part still wholly under a box is refused too, as MuPDF should have removed
 * it.
 */
function partlyCoveredDrawing(page: mupdf.Page, redactions: readonly Redaction[]): Box | "failed" | undefined {
  let found: Box | "failed" | undefined;
  const judge = (part: PathPart, grow: number) => {
    const reach = around(part.points);
    const bounds = around([
      [reach.x0 - grow, reach.y0 - grow],
      [reach.x1 + grow, reach.y1 + grow],
    ]);
    // Our own boxes are rectangles exactly the size of one.
    if (isRectangle(part) && redactions.some(({ box }) => sameBox(box, bounds))) return;
    const simple = isRectangle(part) || part.steps === "ML";
    found ??= redactions.find(({ box }) => overlap(box, bounds) && (within(box, bounds) || !simple))?.box;
  };
  // A throw inside MuPDF's callback could leave it half run, so failures are only noted here.
  drawnParts(page, (part, grow) => {
    try {
      judge(part, grow);
    } catch {
      found = "failed";
    }
  });
  return found;
}

/** RED-3: re-read the written file and refuse it on anything left behind. */
export function check(original: mupdf.PDFDocument, output: mupdf.PDFDocument, byPage: Map<PageIndex, Redaction[]>, appearance: Appearance): void {
  if (checkStructure(output) !== undefined) throw new WriteRefused("check-failed");
  for (const [page, redactions] of byPage) {
    const cleaned = withPage(output, page, (each) => glyphsOf(each, READING_OPTIONS));
    const before = withPage(original, page, (each) => glyphsOf(each, READING_OPTIONS));
    const textAreas = redactions.map(({ textArea }) => textArea);
    const missing = missingGlyphs(before, cleaned, textAreas);
    if (missing.length > 0) throw new WriteRefused("extra-text-removed", { page, boxes: missing.map(({ box }) => box) });
    if (movedGlyphs(before, cleaned, textAreas).length > 0) throw new WriteRefused("text-moved", { page });
    if (textUnderBoxes(cleaned, redactions, appearance) || withPage(output, page, (each) => imagesUnderBoxes(each, redactions))) {
      throw new WriteRefused("check-failed", { page });
    }
    const drawing = withPage(output, page, (each) => partlyCoveredDrawing(each, redactions));
    if (drawing === "failed") throw new WriteRefused("check-failed", { page });
    if (drawing !== undefined) throw new WriteRefused("partly-covered-drawing", { page, boxes: [drawing] });
  }
}
