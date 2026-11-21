import * as mupdf from "mupdf";
import {
  isPageIndex,
  isPoints,
  parseEngineRequest,
  pointBox,
  type Appearance,
  type Box,
  type DocumentModel,
  type Edit,
  type EngineError,
  type EngineMessage,
  type FileNumber,
  type InspectionNumber,
  type PageChar,
  type PageIndex,
  type PageModel,
  type PageText,
  type Source,
} from "./contract";
import { bounds, rangeBoxes, readingOrder } from "./pageText";

interface Opened {
  readonly file: FileNumber;
  /** The file as the user picked it. Each apply starts again from these bytes. */
  readonly bytes: Uint8Array;
  readonly original: mupdf.PDFDocument;
  output: mupdf.Document | undefined;
}

let opened: Opened | undefined;

function post(message: EngineMessage, transfer: Transferable[] = []): void {
  postMessage(message, { transfer });
}

function fail(file: FileNumber, code: EngineError["code"], message: string): void {
  post({ type: "error", file, error: { code, message } });
}

/** Thrown inside apply to block the export with a reason the user sees. */
class CheckFailed extends Error {}

function toBox(x0: number, y0: number, x1: number, y1: number): Box {
  const box = pointBox(x0, y0, x1, y1);
  if (box === undefined) throw new Error("A box is not a finite size");
  return box;
}

function documentModel(document: mupdf.Document): DocumentModel | undefined {
  const pages: PageModel[] = [];
  for (let index = 0; index < document.countPages(); index++) {
    const page = document.loadPage(index);
    try {
      const [x0, y0, x1, y1] = page.getBounds();
      const width = x1 - x0;
      const height = y1 - y0;
      if (!isPageIndex(index) || !isPoints(width) || !isPoints(height) || width <= 0 || height <= 0) {
        throw new Error(`Page ${index + 1} has no size`);
      }
      pages.push({ index, width, height });
    } finally {
      page.destroy();
    }
  }
  const [first, ...rest] = pages;
  return first && { pages: [first, ...rest] };
}

function closeAll(): void {
  opened?.original.destroy();
  opened?.output?.destroy();
  opened = undefined;
}

/** Opens a PDF the engine can work on, or says why it can't. */
function load(bytes: ArrayBuffer): { readonly document: mupdf.PDFDocument; readonly model: DocumentModel } | EngineError {
  let document: mupdf.Document | undefined;
  try {
    document = mupdf.Document.openDocument(bytes, "application/pdf");
    if (!(document instanceof mupdf.PDFDocument)) throw new Error("Not a PDF");
    // DOC-4: an encrypted file is refused, never processed in part.
    if (document.needsPassword() || !document.getTrailer().get("Encrypt").isNull()) {
      document.destroy();
      return { code: "encrypted", message: "This PDF is encrypted. Remove its password in the app that made it, then open it again." };
    }
    const model = documentModel(document);
    if (model === undefined) {
      document.destroy();
      return { code: "open-failed", message: "This PDF has no pages. Choose another file." };
    }
    return { document, model };
  } catch {
    // A file that opens but fails later is still held in WebAssembly memory until destroyed.
    document?.destroy();
    return { code: "open-failed", message: "This file could not be opened as a PDF. Check that it is a PDF and try again." };
  }
}

function inspect(inspection: InspectionNumber, bytes: ArrayBuffer): void {
  const loaded = load(bytes);
  if ("code" in loaded) {
    post({ type: "refused", inspection, error: loaded });
    return;
  }
  loaded.document.destroy();
  post({ type: "inspected", inspection, pages: loaded.model.pages.length });
}

function open(file: FileNumber, bytes: ArrayBuffer): void {
  closeAll();
  const copy = new Uint8Array(bytes.slice(0));
  const loaded = load(bytes);
  if ("code" in loaded) {
    fail(file, loaded.code, loaded.message);
    return;
  }
  opened = { file, bytes: copy, original: loaded.document, output: undefined };
  post({ type: "opened", file, document: loaded.model });
}

function current(file: FileNumber): Opened | undefined {
  return opened?.file === file ? opened : undefined;
}

function sourceDocument(file: FileNumber, source: Source): mupdf.Document | undefined {
  const document = current(file);
  return source === "original" ? document?.original : document?.output;
}

function render(file: FileNumber, source: Source, index: PageIndex, scale: number): void {
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
    post({ type: "rendered", file, source, page: index, image }, [rgba.buffer]);
  } catch {
    fail(file, "render-failed", `Page ${index + 1} could not be drawn. Open the PDF again.`);
  } finally {
    pixmap?.destroy();
    page?.destroy();
  }
}

type Glyph = Extract<PageChar, { box: Box }>;

type Point = readonly [number, number];

// MuPDF's quad order: upper left, upper right, lower left, lower right.
const quadCorners = (quad: mupdf.Quad): [Point, Point, Point, Point] => [
  [quad[0], quad[1]],
  [quad[2], quad[3]],
  [quad[4], quad[5]],
  [quad[6], quad[7]],
];

function around(points: readonly Point[]): Box {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return toBox(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
}

interface Run<T> {
  readonly box: Box;
  readonly items: readonly T[];
}

const run = <T extends { readonly box: Box }>([first, ...rest]: readonly [T, ...T[]]): Run<T> => ({
  box: bounds([first.box, ...rest.map((item) => item.box)]),
  items: [first, ...rest],
});

const LINE_END: PageChar = { c: "\n", box: undefined };

/** The page's characters, blocks and lines in reading order; see `PageChar` for the offset rule. */
function pageText(page: mupdf.Page): PageText {
  const text = page.toStructuredText("preserve-whitespace");
  const blocks: Run<Run<Glyph>>[] = [];
  let lines: Run<Glyph>[] = [];
  let glyphs: Glyph[] = [];
  try {
    text.walk({
      beginTextBlock() {
        lines = [];
      },
      beginLine() {
        glyphs = [];
      },
      onChar(c, _origin, _font, _size, quad) {
        glyphs.push({ c, box: around(quadCorners(quad)) });
      },
      endLine() {
        const [first, ...rest] = glyphs;
        if (first) lines.push(run([first, ...rest]));
      },
      endTextBlock() {
        const [first, ...rest] = lines;
        if (first) blocks.push(run([first, ...rest]));
      },
    });
  } finally {
    text.destroy();
  }
  const chars = readingOrder(blocks).flatMap((block) => [
    ...readingOrder(block.items).flatMap((line) => [...line.items, LINE_END]),
    LINE_END,
  ]);
  return { chars };
}

function withPage<T>(document: mupdf.Document, index: number, use: (page: mupdf.Page) => T): T {
  const page = document.loadPage(index);
  try {
    return use(page);
  } finally {
    page.destroy();
  }
}

function text(file: FileNumber, index: PageIndex): void {
  const document = current(file)?.original;
  try {
    if (document === undefined || index >= document.countPages()) throw new Error("No such page");
    post({ type: "text", file, page: index, text: withPage(document, index, pageText) });
  } catch {
    fail(file, "text-failed", `The text on page ${index + 1} could not be read. Open the PDF again.`);
  }
}

interface Redaction {
  readonly box: Box;
  /** What the box prints when labels are on, like `[PERSON]`. */
  readonly printed: string;
}

// The label font is Helvetica in WinAnsiEncoding, which matches Latin-1 on these code points.
const inWinAnsi = (c: string) => {
  const code = c.charCodeAt(0);
  return c.length === 1 && ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff));
};

/** A text edit's boxes. An edit that is not wholly on the page's text would leave text unmarked, so it fails. */
function textBoxes(text: PageText, edit: Extract<Edit, { kind: "text" }>): readonly Box[] {
  const boxes = edit.end <= text.chars.length ? rangeBoxes(text, edit.start, edit.end) : [];
  if (boxes.length === 0) throw new CheckFailed(`A mark on page ${edit.page + 1} does not match the page's text.`);
  return boxes;
}

/** Each page's redaction boxes, with text edits turned into one box per line from the original's own text. */
function redactionsByPage(original: mupdf.Document, edits: readonly Edit[]): Map<PageIndex, Redaction[]> {
  const byPage = new Map<PageIndex, Redaction[]>();
  for (const edit of edits) {
    if (edit.page >= original.countPages()) throw new Error("An edit names a page the file does not have");
    const boxes = edit.kind === "box" ? [edit.box] : textBoxes(withPage(original, edit.page, pageText), edit);
    const list = byPage.get(edit.page) ?? [];
    const printed = `[${[...edit.label.toUpperCase()].map((c) => (inWinAnsi(c) ? c : "?")).join("")}]`;
    list.push(...boxes.map((box) => ({ box, printed })));
    byPage.set(edit.page, list);
  }
  return byPage;
}

// Helvetica advance widths (AFM, 1/1000 em) for fitting a label into its box; others count as 600.
const HELVETICA_WIDTHS: Readonly<Record<string, number>> = {
  ...Object.fromEntries([..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map((c, i) =>
    [c, [667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611][i] ?? 600])),
  ...Object.fromEntries([..."0123456789"].map((c) => [c, 556])),
  " ": 278, "[": 278, "]": 278, "-": 333, "_": 556, ".": 278,
};

// A hex string: the stream's text is stored as UTF-8, so a literal string would garble any byte above 0x7f.
const pdfString = (text: string) => `<${[...text].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("")}>`;

function rgb(colour: string): [number, number, number] {
  const value = Number.parseInt(colour.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** Our own boxes and labels, drawn in page space through the inverse of the page transform. */
function drawBoxes(document: mupdf.PDFDocument, page: mupdf.PDFPage, redactions: readonly Redaction[], appearance: Appearance) {
  const [r, g, b] = rgb(appearance.colour);
  const fill = `${(r / 255).toFixed(3)} ${(g / 255).toFixed(3)} ${(b / 255).toFixed(3)} rg`;
  const ink = 0.2126 * r + 0.7152 * g + 0.0722 * b > 140 ? "0 g" : "1 g";
  const inverse = mupdf.Matrix.invert(page.getTransform());
  let content = `q ${inverse.map((n) => n.toFixed(6)).join(" ")} cm ${fill}\n`;
  for (const { box, printed } of redactions) {
    content += `${box.x0} ${box.y0} ${box.x1 - box.x0} ${box.y1 - box.y0} re f\n`;
    if (!appearance.label) continue;
    const em = [...printed].reduce((sum, c) => sum + (HELVETICA_WIDTHS[c] ?? 600), 0) / 1000;
    const size = Math.min((box.y1 - box.y0) * 0.7, ((box.x1 - box.x0) * 0.9) / em);
    const x = (box.x0 + box.x1 - em * size) / 2;
    const baseline = (box.y0 + box.y1) / 2 + size * 0.35;
    content += `BT ${ink} /RedactLabel ${size.toFixed(3)} Tf 1 0 0 -1 ${x.toFixed(3)} ${baseline.toFixed(3)} Tm ${pdfString(printed)} Tj ET ${fill}\n`;
  }
  content += "Q\n";

  const pageObject = page.getObject();
  if (appearance.label) {
    let resources = pageObject.getInheritable("Resources");
    if (resources.isNull()) {
      resources = document.newDictionary();
      pageObject.put("Resources", resources);
    }
    let fonts = resources.get("Font");
    if (fonts.isNull()) {
      fonts = document.newDictionary();
      resources.put("Font", fonts);
    }
    const font = document.newDictionary();
    font.put("Type", document.newName("Font"));
    font.put("Subtype", document.newName("Type1"));
    font.put("BaseFont", document.newName("Helvetica"));
    font.put("Encoding", document.newName("WinAnsiEncoding"));
    fonts.put("RedactLabel", document.addObject(font));
  }
  // Wrap the existing content in q/Q so a graphics state it leaves set cannot move our boxes.
  const contents = document.newArray();
  contents.push(document.addStream("q\n", {}));
  const existing = pageObject.get("Contents");
  if (existing.isArray()) {
    for (let i = 0; i < existing.length; i++) contents.push(existing.get(i));
  } else if (!existing.isNull()) {
    contents.push(existing);
  }
  contents.push(document.addStream(`Q\n${content}`, {}));
  pageObject.put("Contents", contents);
}

function openPdf(bytes: Uint8Array): mupdf.PDFDocument {
  const document = mupdf.Document.openDocument(bytes.slice(0), "application/pdf");
  if (document instanceof mupdf.PDFDocument) return document;
  document.destroy();
  throw new CheckFailed("The cleaned file could not be read back.");
}

function redact(bytes: Uint8Array, byPage: Map<PageIndex, Redaction[]>, appearance: Appearance): Uint8Array<ArrayBuffer> {
  const document = openPdf(bytes);
  try {
    for (const [index, redactions] of byPage) {
      const page = document.loadPage(index);
      try {
        for (const { box } of redactions) page.createAnnotation("Redact").setRect([box.x0, box.y0, box.x1, box.y1]);
        page.applyRedactions(
          false,
          mupdf.PDFPage.REDACT_IMAGE_PIXELS,
          mupdf.PDFPage.REDACT_LINE_ART_REMOVE_IF_COVERED,
          mupdf.PDFPage.REDACT_TEXT_REMOVE,
        );
        drawBoxes(document, page, redactions, appearance);
      } finally {
        page.destroy();
      }
    }
    const trailer = document.getTrailer();
    trailer.delete("Info");
    trailer.get("Root").delete("Metadata");
    for (let index = 0; index < document.countPages(); index++) {
      document.findPage(index).delete("Metadata");
    }
    // A full rewrite: one revision, and garbage collection drops every object nothing refers to.
    const saved = document.saveToBuffer("garbage=4,compress").asUint8Array();
    const copy = new Uint8Array(saved.length);
    copy.set(saved);
    return copy;
  } finally {
    document.destroy();
  }
}

const centre = (box: Box): Point => [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2];
const inside = (box: Box, [x, y]: Point) => x > box.x0 && x < box.x1 && y > box.y0 && y < box.y1;

// Less than this much overlap, in points, is two boxes that only touch.
const TOUCH = 0.01;
const overlap = (a: Box, b: Box) =>
  Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > TOUCH && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > TOUCH;

// The body of a letter, as a share of the font size: from the baseline up to about cap height.
const BODY = 0.7;

interface OutputGlyph {
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

function glyphsOf(page: mupdf.Page): OutputGlyph[] {
  const text = page.toStructuredText("preserve-whitespace");
  const found: OutputGlyph[] = [];
  try {
    text.walk({
      onChar(c, origin, _font, size, quad) {
        const [ul, ur, ll, lr] = quadCorners(quad);
        const up: Point = [ul[0] - ll[0], ul[1] - ll[1]];
        const height = Math.hypot(...up);
        const clamp = (t: number) => Math.min(Math.max(t, 0), 1);
        // How far up the quad the baseline and cap height are, from its lower edge.
        const base = height === 0 ? 0 : clamp(((origin[0] - ll[0]) * up[0] + (origin[1] - ll[1]) * up[1]) / height ** 2);
        const cap = height === 0 ? 1 : clamp(base + (BODY * size) / height);
        const at = (t: number): Point[] => [
          [ll[0] + t * up[0], ll[1] + t * up[1]],
          [lr[0] + t * (ur[0] - lr[0]), lr[1] + t * (ur[1] - lr[1])],
        ];
        found.push({ c, box: around([ul, ur, ll, lr]), body: around([...at(base), ...at(cap)]) });
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
function textUnderBoxes(glyphs: readonly OutputGlyph[], redactions: readonly Redaction[], appearance: Appearance): boolean {
  const ours = (glyph: OutputGlyph) => redactions.some(({ box }) => inside(box, centre(glyph.box)));
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

const transform = ([a, b, c, d, e, f]: mupdf.Matrix, [x, y]: Point): Point => [a * x + c * y + e, b * x + d * y + f];

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
function check(output: mupdf.PDFDocument, byPage: Map<PageIndex, Redaction[]>, appearance: Appearance): void {
  if (output.countVersions() !== 1) throw new CheckFailed("The cleaned file has more than one revision.");
  const trailer = output.getTrailer();
  if (!trailer.get("Info").isNull() || !trailer.get("Root").get("Metadata").isNull()) {
    throw new CheckFailed("The cleaned file still has metadata.");
  }
  for (const [index, redactions] of byPage) {
    if (textUnderBoxes(withPage(output, index, glyphsOf), redactions, appearance)) {
      throw new CheckFailed(`Text is still under a box on page ${index + 1}.`);
    }
    if (withPage(output, index, (page) => imagesUnderBoxes(page, redactions))) {
      throw new CheckFailed(`An image under a box on page ${index + 1} still shows what was under it.`);
    }
  }
}

function apply(file: FileNumber, edits: readonly Edit[], appearance: Appearance): void {
  const document = current(file);
  if (document === undefined) {
    fail(file, "apply-failed", "The open document changed. Open the PDF again.");
    return;
  }
  document.output?.destroy();
  document.output = undefined;
  let output: mupdf.PDFDocument | undefined;
  try {
    const byPage = redactionsByPage(document.original, edits);
    const bytes = redact(document.bytes, byPage, appearance);
    output = openPdf(bytes);
    check(output, byPage, appearance);
    const model = documentModel(output);
    if (model === undefined) throw new CheckFailed("The cleaned file has no pages.");
    document.output = output;
    post({ type: "applied", file, bytes: bytes.buffer, output: model }, [bytes.buffer]);
  } catch (error) {
    // Fail closed: nothing reaches the UI to download unless every check passed.
    output?.destroy();
    const reason = error instanceof CheckFailed ? error.message : "The marks could not be applied.";
    fail(
      file,
      error instanceof CheckFailed ? "check-failed" : "apply-failed",
      `${reason} Nothing was exported. Apply and check again; if it fails again, this PDF can't be cleaned here yet.`,
    );
  }
}

addEventListener("message", (event: MessageEvent<unknown>) => {
  const request = parseEngineRequest(event.data);
  if (request === undefined) {
    post({
      type: "error",
      file: undefined,
      error: { code: "bad-message", message: "The engine got a message it does not know. Reload the page to try again." },
    });
    return;
  }
  switch (request.type) {
    case "inspect":
      inspect(request.inspection, request.bytes);
      break;
    case "open":
      open(request.file, request.bytes);
      break;
    case "render":
      render(request.file, request.source, request.page, request.scale);
      break;
    case "text":
      text(request.file, request.page);
      break;
    case "apply":
      apply(request.file, request.edits, request.appearance);
      break;
  }
});

post({ type: "ready" });
