import * as mupdf from "mupdf";
import type { PlacedImage } from "../model/document";
import type { PageIndex } from "../model/geometry";
import { fingerprintOf, GRID_COLUMNS, GRID_ROWS, MIN_IMAGE_SIDE } from "../model/images";
import { around, transform } from "./geometry";

/**
 * The image's average brightness in each cell of a 9 × 8 grid, row by row; for a stencil mask,
 * which has no colour, how much of each cell it paints.
 */
function greyGrid(image: mupdf.Image): number[] {
  const pixmap = image.toPixmap();
  try {
    const grey = pixmap.getColorSpace() === null ? pixmap : pixmap.convertToColorSpace(mupdf.ColorSpace.DeviceGray, false);
    try {
      const width = grey.getWidth();
      const height = grey.getHeight();
      const stride = grey.getStride();
      const samples = grey.getPixels();
      const cells: number[] = [];
      for (let row = 0; row < GRID_ROWS; row++) {
        for (let column = 0; column < GRID_COLUMNS; column++) {
          let sum = 0;
          let count = 0;
          for (let y = Math.floor((row * height) / GRID_ROWS); y < Math.floor(((row + 1) * height) / GRID_ROWS); y++) {
            for (let x = Math.floor((column * width) / GRID_COLUMNS); x < Math.floor(((column + 1) * width) / GRID_COLUMNS); x++) {
              sum += samples[y * stride + x] ?? 0;
              count++;
            }
          }
          cells.push(sum / count);
        }
      }
      return cells;
    } finally {
      if (grey !== pixmap) grey.destroy();
    }
  } finally {
    pixmap.destroy();
  }
}

/**
 * An image's fingerprint, from its colour, or from its soft mask when the colour alone is plain,
 * as for a black logo or signature whose shape lives in its mask.
 */
function fingerprintOfImage(image: mupdf.Image): string | undefined {
  const colour = fingerprintOf(greyGrid(image));
  if (colour !== undefined) return colour;
  const mask = image.getMask();
  try {
    return mask === null ? undefined : fingerprintOf(greyGrid(mask));
  } finally {
    mask?.destroy();
  }
}

/** The images on a page that a box can spread from or to: drawn in colour, or as stencil masks. */
export function placedImages(page: mupdf.Page, index: PageIndex): PlacedImage[] {
  const [px0, py0, px1, py1] = page.getBounds();
  const pageArea = (px1 - px0) * (py1 - py0);
  const found: PlacedImage[] = [];
  const place = (image: mupdf.Image, ctm: mupdf.Matrix) => {
    try {
      const width = image.getWidth();
      const height = image.getHeight();
      if (width < MIN_IMAGE_SIDE || height < MIN_IMAGE_SIDE) return;
      // A scan's page is one image, and two scans of one form look alike. A drawing with no area
      // on the page, such as one off its edge, shows nothing to hide.
      const placed = around([transform(ctm, [0, 0]), transform(ctm, [1, 0]), transform(ctm, [0, 1]), transform(ctm, [1, 1])]);
      const shown = Math.max(0, Math.min(placed.x1, px1) - Math.max(placed.x0, px0)) * Math.max(0, Math.min(placed.y1, py1) - Math.max(placed.y0, py0));
      if (shown < 1 || shown > pageArea / 2) return;
      const fingerprint = fingerprintOfImage(image);
      if (fingerprint !== undefined) found.push({ page: index, matrix: ctm, aspect: width / height, fingerprint });
    } catch {
      // A throw inside MuPDF's callback could leave it half run, and an image that can't be read
      // only can't spread, so it is passed over.
    }
  };
  const device = new mupdf.Device({ fillImage: place, fillImageMask: place });
  try {
    page.run(device, mupdf.Matrix.identity);
    device.close();
  } finally {
    device.destroy();
  }
  return found;
}
