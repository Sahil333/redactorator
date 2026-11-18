import * as mupdf from "mupdf";
import {
  isPageIndex,
  isPoints,
  parseEngineRequest,
  type DocumentModel,
  type EngineMessage,
  type PageIndex,
  type PageModel,
} from "./contract";

let openDocument: mupdf.Document | undefined;

function post(message: EngineMessage, transfer: Transferable[] = []): void {
  postMessage(message, { transfer });
}

function pageModel(document: mupdf.Document, index: number): PageModel {
  const page = document.loadPage(index);
  try {
    const [x0, y0, x1, y1] = page.getBounds();
    const width = x1 - x0;
    const height = y1 - y0;
    if (!isPageIndex(index) || !isPoints(width) || !isPoints(height)) {
      throw new Error(`Page ${index + 1} has no size`);
    }
    return { index, width, height };
  } finally {
    page.destroy();
  }
}

function open(bytes: ArrayBuffer): EngineMessage {
  openDocument?.destroy();
  openDocument = undefined;
  try {
    const document = mupdf.Document.openDocument(bytes, "application/pdf");
    const pages: PageModel[] = [];
    for (let index = 0; index < document.countPages(); index++) {
      pages.push(pageModel(document, index));
    }
    openDocument = document;
    const model: DocumentModel = { pages };
    return { type: "opened", document: model };
  } catch {
    return {
      type: "error",
      error: {
        code: "open-failed",
        message: "This file could not be opened as a PDF. Check that it is a PDF and try again.",
      },
    };
  }
}

function renderFailed(message: string): void {
  post({ type: "error", error: { code: "render-failed", message } });
}

function render(index: PageIndex, scale: number): void {
  const document = openDocument;
  if (document === undefined || index >= document.countPages()) {
    renderFailed("That page is not in the open document. Open the PDF again.");
    return;
  }
  let page: mupdf.Page | undefined;
  let pixmap: mupdf.Pixmap | undefined;
  try {
    page = document.loadPage(index);
    pixmap = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false);
    const width = pixmap.getWidth();
    const height = pixmap.getHeight();
    const stride = pixmap.getStride();
    const rgb = pixmap.getPixels();
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
    const image = new ImageData(rgba, width, height);
    post({ type: "rendered", page: index, image }, [rgba.buffer]);
  } catch {
    renderFailed(`Page ${index + 1} could not be drawn. Open the PDF again.`);
  } finally {
    pixmap?.destroy();
    page?.destroy();
  }
}

addEventListener("message", (event: MessageEvent<unknown>) => {
  const request = parseEngineRequest(event.data);
  if (request === undefined) {
    post({ type: "error", error: { code: "bad-message", message: "The engine got a message it does not know." } });
    return;
  }
  switch (request.type) {
    case "open":
      post(open(request.bytes));
      break;
    case "render":
      render(request.page, request.scale);
      break;
  }
});

post({ type: "ready" });
