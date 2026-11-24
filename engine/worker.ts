import * as mupdf from "mupdf";
import type {
  Appearance,
  DocumentModel,
  Edit,
  PageChar,
  PageModel,
  PageText,
  PlacedImage,
  Source,
} from "./model/document";
import { isPageIndex, isPoints, pointBox, type Box, type PageIndex } from "./model/geometry";
import type { FileNumber, InspectionNumber, MatchNumber, PdfError, PdfReply } from "./pdf-protocol/messages";
import { parsePdfRequest } from "./pdf-protocol/parse";
import { centre, inside, overlap, textMoved, type PageGlyph, type Point } from "./glyphs";
import { findAll } from "./model/match";
import { bounds, rangeBoxes, readingOrder } from "./model/pageText";

interface Opened {
  readonly file: FileNumber;
  /** The file as the user picked it. Each apply starts again from these bytes. */
  readonly bytes: Uint8Array;
  readonly original: mupdf.PDFDocument;
  output: mupdf.Document | undefined;
}

let opened: Opened | undefined;

function post(message: PdfReply, transfer: Transferable[] = []): void {
  postMessage(message, { transfer });
}

function fail(file: FileNumber, code: PdfError["code"], message: string): void {
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
function load(bytes: ArrayBuffer): { readonly document: mupdf.PDFDocument; readonly model: DocumentModel } | PdfError {
  let document: mupdf.Document | undefined;
  try {
    document = mupdf.Document.openDocument(bytes, "application/pdf");
    if (!(document instanceof mupdf.PDFDocument)) throw new Error("Not a PDF");
    // DOC-4: a file that needs a password to open is refused, never processed in part. One with
    // an empty password, locked only against editing or copying, is read in full like any other.
    if (document.needsPassword()) {
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

// Images that can't be told apart from others are not listed, so a box over one stays put.
const MIN_IMAGE_SIDE = 32;
/** How far apart, of 255, the darkest and lightest cells of the grey copy must be. */
const MIN_IMAGE_CONTRAST = 12;
const GRID_COLUMNS = 9;
const GRID_ROWS = 8;

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

/** The grid's difference hash (see `PlacedImage`), or undefined when it is too plain to tell apart. */
function fingerprintOf(cells: readonly number[]): string | undefined {
  if (Math.max(...cells) - Math.min(...cells) < MIN_IMAGE_CONTRAST) return undefined;
  let hex = "";
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let half = 0; half < 2; half++) {
      let nibble = 0;
      for (let column = half * 4; column < half * 4 + 4; column++) {
        const at = row * GRID_COLUMNS + column;
        nibble = (nibble << 1) | ((cells[at] ?? 0) < (cells[at + 1] ?? 0) ? 1 : 0);
      }
      hex += nibble.toString(16);
    }
  }
  return hex;
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
function placedImages(page: mupdf.Page, index: PageIndex): PlacedImage[] {
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

/** Whether a file can be added, and if so what the project keeps of it: its pages' text and images. */
function inspect(inspection: InspectionNumber, bytes: ArrayBuffer): void {
  const loaded = load(bytes);
  if ("code" in loaded) {
    post({ type: "refused", inspection, error: loaded });
    return;
  }
  const { document, model } = loaded;
  try {
    const [first, ...rest] = model.pages.map((page) => withPage(document, page.index, pageText));
    if (first === undefined) throw new Error("No pages");
    const images = model.pages.flatMap((page) => withPage(document, page.index, (loadedPage) => placedImages(loadedPage, page.index)));
    post({ type: "inspected", inspection, reading: { texts: [first, ...rest], images } });
  } catch {
    post({ type: "refused", inspection, error: { code: "text-failed", message: "The pages of this PDF could not be read. Choose another file." } });
  } finally {
    document.destroy();
  }
}

function match(number: MatchNumber, keys: readonly string[], documents: readonly (readonly (readonly string[])[])[]): void {
  const found = documents.flatMap((pages, document) =>
    findAll(pages, keys).flatMap((each) => (isPageIndex(each.page) ? [{ ...each, document, page: each.page }] : [])),
  );
  post({ type: "matched", match: number, found });
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
    post({ type: "rendered", file, source, page: index, image: { width, height, rgba } }, [rgba.buffer]);
  } catch {
    fail(file, "render-failed", `Page ${index + 1} could not be drawn. Open the PDF again.`);
  } finally {
    pixmap?.destroy();
    page?.destroy();
  }
}

// MuPDF's quad order: upper left, upper right, lower left, lower right.
const quadCorners = (quad: mupdf.Quad): [Point, Point, Point, Point] => [
  [quad[0], quad[1]],
  [quad[2], quad[3]],
  [quad[4], quad[5]],
  [quad[6], quad[7]],
];

const transform = ([a, b, c, d, e, f]: mupdf.Matrix, [x, y]: Point): Point => [a * x + c * y + e, b * x + d * y + f];

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

const LINE_END: Extract<PageChar, { box: undefined }> = { c: "\n", box: undefined };

// The body of a letter, as a share of the font size: from the baseline up to about cap height.
const BODY = 0.7;

/** A letter's ink: its width, from its baseline up to cap height, wherever the quad's lower edge is. */
function bodyOf(origin: mupdf.Point, size: number, quad: mupdf.Quad): Box {
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
  return around([...at(base), ...at(cap)]);
}

/**
 * The page's characters, blocks and lines in reading order (see `PageChar` for the offset
 * rule), and the same characters with each letter's ink band as its box.
 */
function readText(page: mupdf.Page): { readonly text: PageText; readonly ink: PageText } {
  const text = page.toStructuredText("preserve-whitespace");
  const blocks: Run<Run<PageGlyph>>[] = [];
  let lines: Run<PageGlyph>[] = [];
  let glyphs: PageGlyph[] = [];
  try {
    text.walk({
      beginTextBlock() {
        lines = [];
      },
      beginLine() {
        glyphs = [];
      },
      onChar(c, origin, _font, size, quad) {
        // A PDF can draw a line break as a glyph. "\n" marks where a line ends, so the glyph
        // reads as a space; it keeps its box, so a mark over it still removes it.
        glyphs.push({ c: c === "\n" ? " " : c, box: around(quadCorners(quad)), body: bodyOf(origin, size, quad) });
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
  const ordered = readingOrder(blocks).flatMap((block) => [
    ...readingOrder(block.items).flatMap((line) => [...line.items, LINE_END]),
    LINE_END,
  ]);
  return {
    text: { chars: ordered.map((char): PageChar => (char.box === undefined ? char : { c: char.c, box: char.box })) },
    ink: { chars: ordered.map((char): PageChar => (char.box === undefined ? char : { c: char.c, box: char.body })) },
  };
}

const pageText = (page: mupdf.Page): PageText => readText(page).text;

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
  /** The box drawn, and the area whose images and drawings are removed. */
  readonly box: Box;
  /**
   * The area text is removed from. For marked text it is the letters' ink, not their whole
   * height: MuPDF removes any letter whose font box an area overlaps, and the font boxes of
   * closely set lines overlap, so the whole height would remove letters from the next line.
   */
  readonly textArea: Box;
  /** What the box prints when labels are on, like `[PERSON]`. */
  readonly printed: string;
}

// The label font is Helvetica in WinAnsiEncoding, which matches Latin-1 on these code points.
const inWinAnsi = (c: string) => {
  const code = c.charCodeAt(0);
  return c.length === 1 && ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff));
};

/**
 * A text edit's box and ink band on each line. An edit that is not wholly on the page's text
 * would leave text unmarked, so it fails.
 */
function textAreas({ text, ink }: ReturnType<typeof readText>, edit: Extract<Edit, { kind: "text" }>): { box: Box; textArea: Box }[] {
  const fits = edit.end <= text.chars.length;
  const boxes = fits ? rangeBoxes(text, edit.start, edit.end) : [];
  const bands = fits ? rangeBoxes(ink, edit.start, edit.end) : [];
  if (boxes.length === 0 || bands.length !== boxes.length) throw new CheckFailed(`A mark on page ${edit.page + 1} does not match the page's text.`);
  return boxes.map((box, line) => ({ box, textArea: bands[line] ?? box }));
}

/** Each page's redaction boxes, with text edits turned into one box per line from the original's own text. */
function redactionsByPage(original: mupdf.Document, edits: readonly Edit[]): Map<PageIndex, Redaction[]> {
  const byPage = new Map<PageIndex, Redaction[]>();
  for (const edit of edits) {
    if (edit.page >= original.countPages()) throw new Error("An edit names a page the file does not have");
    const areas = edit.kind === "box" ? [{ box: edit.box, textArea: edit.box }] : textAreas(withPage(original, edit.page, readText), edit);
    const list = byPage.get(edit.page) ?? [];
    const printed = `[${[...edit.label.toUpperCase()].map((c) => (inWinAnsi(c) ? c : "?")).join("")}]`;
    list.push(...areas.map((area) => ({ ...area, printed })));
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
        const mark = (area: Box) => page.createAnnotation("Redact").setRect([area.x0, area.y0, area.x1, area.y1]);
        for (const { textArea } of redactions) mark(textArea);
        page.applyRedactions(false, mupdf.PDFPage.REDACT_IMAGE_NONE, mupdf.PDFPage.REDACT_LINE_ART_NONE, mupdf.PDFPage.REDACT_TEXT_REMOVE);
        for (const { box } of redactions) mark(box);
        page.applyRedactions(false, mupdf.PDFPage.REDACT_IMAGE_PIXELS, mupdf.PDFPage.REDACT_LINE_ART_REMOVE_IF_COVERED, mupdf.PDFPage.REDACT_TEXT_NONE);
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
    // Without encryption, which MuPDF would otherwise keep from the original, lock and all.
    const saved = document.saveToBuffer("garbage=4,compress,encrypt=none").asUint8Array();
    const copy = new Uint8Array(saved.length);
    copy.set(saved);
    return copy;
  } finally {
    document.destroy();
  }
}

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
function check(original: mupdf.PDFDocument, output: mupdf.PDFDocument, byPage: Map<PageIndex, Redaction[]>, appearance: Appearance): void {
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
    check(document.original, output, byPage, appearance);
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
  const request = parsePdfRequest(event.data);
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
    case "match":
      match(request.match, request.keys, request.documents);
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
