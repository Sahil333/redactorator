import * as mupdf from "mupdf";
import type { Appearance } from "../../model/document";
import type { Box, PageIndex } from "../../model/geometry";
import { around, bodyOf, quadCorners, transform } from "../geometry";
import { centre, inside, overlap, textMoved, type PageGlyph, type Point } from "../glyphs";
import { withPage } from "../text";
import { CheckFailed, type Redaction } from "./common";

function glyphsOf(page: mupdf.Page): PageGlyph[] {
  const text = page.toStructuredText("preserve-whitespace");
  const found: PageGlyph[] = [];
  try {
    text.walk({
      onChar(c, origin, _font, size, quad) {
        found.push({ c, box: around(quadCorners(quad)), body: bodyOf(origin, size, quad) });
      },
    });
  } finally {
    text.destroy();
  }
  return found;
}

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

/** RED-3: re-read the written file and throw CheckFailed on anything left behind. */
export function check(original: mupdf.PDFDocument, output: mupdf.PDFDocument, byPage: Map<PageIndex, Redaction[]>, appearance: Appearance): void {
  if (output.countVersions() !== 1) throw new CheckFailed("The cleaned file has more than one revision.");
  const trailer = output.getTrailer();
  if (!trailer.get("Encrypt").isNull()) throw new CheckFailed("The cleaned file is still encrypted.");
  if (!trailer.get("Info").isNull() || !trailer.get("Root").get("Metadata").isNull()) {
    throw new CheckFailed("The cleaned file still has metadata.");
  }
  for (const [index, redactions] of byPage) {
    const cleaned = withPage(output, index, glyphsOf);
    const textAreas = redactions.map(({ textArea }) => textArea);
    if (textMoved(withPage(original, index, glyphsOf), cleaned, textAreas)) {
      throw new CheckFailed(`Other text on page ${index + 1} would move in the cleaned file.`);
    }
    if (textUnderBoxes(cleaned, redactions, appearance)) {
      throw new CheckFailed(`Text is still under a box on page ${index + 1}.`);
    }
    if (withPage(output, index, (page) => imagesUnderBoxes(page, redactions))) {
      throw new CheckFailed(`An image under a box on page ${index + 1} still shows what was under it.`);
    }
  }
}
