import * as mupdf from "mupdf";
import type { Source } from "../model/document";
import type { PageIndex } from "../model/geometry";
import type { FileNumber } from "../pdf-protocol/messages";
import { fail, post } from "./messages";
import { sourceDocument } from "./state";

export function render(file: FileNumber, source: Source, index: PageIndex, scale: number): void {
  const document = sourceDocument(file, source);
  let page: mupdf.Page | undefined;
  let pixmap: mupdf.Pixmap | undefined;
  try {
    if (document === undefined || index >= document.countPages()) {
      fail(file, "render-failed", "That page is not in the open document. Open the PDF again.");
      return;
    }
    page = document.loadPage(index);
    pixmap = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false);
    const width = pixmap.getWidth();
    const height = pixmap.getHeight();
    const stride = pixmap.getStride();
    const rgb = pixmap.getPixels();
    // An empty page has no pixels to draw; the reply's parser refuses one, as ImageData did.
    if (width === 0 || height === 0) throw new RangeError("The page is empty");
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const from = y * stride + x * 3;
        const to = (y * width + x) * 4;
        rgba[to] = rgb[from] ?? 0;
        rgba[to + 1] = rgb[from + 1] ?? 0;
        rgba[to + 2] = rgb[from + 2] ?? 0;
        rgba[to + 3] = 255;
      }
    }
    post({ type: "rendered", file, source, page: index, image: { width, height, rgba } }, [rgba.buffer]);
  } catch {
    fail(file, "render-failed", `Page ${index + 1} could not be drawn. Open the PDF again.`);
  } finally {
    pixmap?.destroy();
    page?.destroy();
  }
}
