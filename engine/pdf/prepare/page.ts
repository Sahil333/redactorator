// Preparation steps 5 and 6: page content cleaned by MuPDF's patched content filter, then content
// outside the visible page removed.
import * as mupdf from "mupdf";
import type { RemovalKind } from "../../model/document";
import { quadCorners, transform, type Point } from "../geometry";
import { nameAt, objectAt, valuesOf } from "../objects";
import { withPage } from "../text";
import { layersOf, type Layers } from "./layers";
import { reopen } from "./reopen";

const STEP_5 = "clean,sanitize,drop-hidden-oc,drop-mc-properties,blank-unshown-pixels";

/** How far each outside area reaches from the page's edge, in points. */
const FAR = 100_000;

type Rect = readonly [number, number, number, number];

interface Extent {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

const isOutside = ([x0, y0, x1, y1]: Rect, box: Extent) => box.x1 <= x0 || box.x0 >= x1 || box.y1 <= y0 || box.y0 >= y1;

/**
 * The extent of `points`. Unlike `around` it never throws, as it runs inside MuPDF's device
 * callbacks, where a throw could leave MuPDF half run; a point that is not finite compares false.
 */
function extent(points: readonly Point[]): Extent {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

const isLayer = (properties: mupdf.PDFObject) => {
  const type = nameAt(properties.resolve(), "Type");
  return type === "OCG" || type === "OCMD";
};

// A name as the PDF lexer reads it: it ends at white space (NUL included) or a delimiter, so /E
// is not /EMC or /ExtGState, and a #xx escape stands for one byte.
const NAME = /\/([^\0\t\n\f\r ()<>[\]{}/%]*)/g;
const ESCAPE = /#([0-9A-Fa-f]{2})/g;
// The marked-content properties step 5 drops. A string that holds one counts too, which can only
// over-report.
const DROPPED = new Set(["ActualText", "Alt", "E"]);
// The names are ASCII, so bytes that are not UTF-8 decode to replacement characters harmlessly.
const decoder = new TextDecoder();

/** Whether a content stream holds a property step 5 drops; inline property lists live only there. */
function holdsMarkedContent(stream: mupdf.PDFObject): boolean {
  for (const [, name = ""] of decoder.decode(stream.readStream().asUint8Array()).matchAll(NAME)) {
    if (DROPPED.has(name.replace(ESCAPE, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16))))) return true;
  }
  return false;
}

/** The page's content streams. */
function contentsOf(page: mupdf.PDFObject): mupdf.PDFObject[] {
  const contents = page.get("Contents");
  if (contents.isNull()) return [];
  const resolved = contents.resolve();
  const streams: mupdf.PDFObject[] = [];
  if (resolved.isArray()) resolved.forEach((each) => streams.push(each));
  else streams.push(contents);
  return streams.filter((stream) => stream.isStream());
}

interface Scan {
  readonly layers: Layers;
  readonly removed: Set<RemovalKind>;
  /** The indirect objects scanned already. */
  readonly seen: Set<number>;
}

/** Whether `object` was scanned before; from now on it has been. */
function scannedBefore(scan: Scan, object: mupdf.PDFObject): boolean {
  if (!object.isIndirect()) return false;
  const number = object.asIndirect();
  if (scan.seen.has(number)) return true;
  scan.seen.add(number);
  return false;
}

/** A content stream step 5 filters besides the page's own: a form, a tiling pattern, a soft mask's group, a Type 3 glyph. */
function streamKinds(scan: Scan, stream: mupdf.PDFObject): void {
  if (!stream.isStream() || scannedBefore(scan, stream)) return;
  if (holdsMarkedContent(stream)) scan.removed.add("marked-content");
  resourceKinds(scan, stream.resolve().get("Resources"));
}

function xobjectKinds(scan: Scan, xobject: mupdf.PDFObject): void {
  if (scan.layers.isOff(xobject.resolve().get("OC"))) scan.removed.add("hidden-layers");
  const subtype = nameAt(xobject.resolve(), "Subtype");
  if (subtype === "Form") streamKinds(scan, xobject);
  // The filter drops a PostScript XObject, which no PDF 2.0 reader draws (owner, 25 Nov 2026).
  else if (subtype === "PS") scan.removed.add("app-data");
}

function fontKinds(scan: Scan, font: mupdf.PDFObject): void {
  if (scannedBefore(scan, font)) return;
  const glyphs = objectAt(font.resolve(), "CharProcs");
  if (glyphs === undefined) return;
  for (const glyph of valuesOf(glyphs)) if (glyph.isStream() && holdsMarkedContent(glyph)) scan.removed.add("marked-content");
  resourceKinds(scan, font.resolve().get("Resources"));
}

/** What a page's resources, and those of the content streams they hold, say step 5 will remove. */
function resourceKinds(scan: Scan, resources: mupdf.PDFObject): void {
  if (resources.isNull()) return;
  const resolved = resources.resolve();
  if (!resolved.isDictionary()) return;
  for (const properties of valuesOf(objectAt(resolved, "Properties"))) {
    if (!isLayer(properties)) scan.removed.add("marked-content");
    else if (scan.layers.isOff(properties)) scan.removed.add("hidden-layers");
  }
  for (const xobject of valuesOf(objectAt(resolved, "XObject"))) xobjectKinds(scan, xobject);
  // A shading pattern is a dictionary, with no content.
  for (const pattern of valuesOf(objectAt(resolved, "Pattern"))) streamKinds(scan, pattern);
  for (const font of valuesOf(objectAt(resolved, "Font"))) fontKinds(scan, font);
  for (const state of valuesOf(objectAt(resolved, "ExtGState"))) {
    const group = objectAt(state.resolve(), "SMask");
    if (group?.isDictionary()) streamKinds(scan, group.get("G"));
  }
}

/**
 * Before step 5: the kinds its filter will remove, found by one device pass over each page and its
 * resources. Content on a layer that is off is reported by `beginLayer` even when it is skipped.
 */
function contentKinds(document: mupdf.PDFDocument, removed: Set<RemovalKind>): void {
  const layers = layersOf(document);
  const scan: Scan = { layers, removed, seen: new Set() };
  for (let index = 0; index < document.countPages(); index++) {
    const page = document.findPage(index);
    resourceKinds(scan, page.getInheritable("Resources"));
    if (contentsOf(page).some(holdsMarkedContent)) removed.add("marked-content");
    withPage(document, index, (page) => {
      const bounds = page.getBounds();
      let clips = 0;
      const placed = (_image: mupdf.Image, ctm: mupdf.Matrix) => {
        const box = extent([transform(ctm, [0, 0]), transform(ctm, [1, 0]), transform(ctm, [0, 1]), transform(ctm, [1, 1])]);
        const [x0, y0, x1, y1] = bounds;
        if (clips > 0 || box.x0 < x0 || box.y0 < y0 || box.x1 > x1 || box.y1 > y1) removed.add("unshown-image-pixels");
      };
      const clip = () => {
        clips++;
      };
      const device = new mupdf.Device({
        beginLayer(name) {
          if (layers.offNames.has(name)) removed.add("hidden-layers");
        },
        fillImage: placed,
        fillImageMask: placed,
        clipPath: clip,
        clipStrokePath: clip,
        clipText: clip,
        clipStrokeText: clip,
        clipImageMask: clip,
        // A soft-mask group clips like a rectangle at its bounds.
        beginMask: clip,
        popClip() {
          clips--;
        },
      });
      try {
        page.run(device, mupdf.Matrix.identity);
        device.close();
      } finally {
        device.destroy();
      }
    });
  }
}

/** Step 5: one save through the patched content filter. `document` is used up. */
export function cleanContent(document: mupdf.PDFDocument, removed: Set<RemovalKind>): mupdf.PDFDocument {
  contentKinds(document, removed);
  return reopen(document, STEP_5);
}

/** Whether any glyph, or any part of a drawing, on the page lies wholly outside it. */
function anythingOutside(page: mupdf.PDFPage): boolean {
  const bounds = page.getBounds();
  const text = page.toStructuredText("clip=no");
  let outside = false;
  try {
    text.walk({
      onChar(_c, _origin, _font, _size, quad) {
        if (isOutside(bounds, extent(quadCorners(quad)))) outside = true;
      },
    });
  } finally {
    text.destroy();
  }
  if (outside) return true;
  const parts = (path: mupdf.Path, ctm: mupdf.Matrix, grow: number) => {
    const all: Point[][] = [];
    let part: Point[] = [];
    const add = (x: number, y: number) => part.push(transform(ctm, [x, y]));
    path.walk({
      moveTo(x, y) {
        if (part.length > 0) all.push(part);
        part = [];
        add(x, y);
      },
      lineTo: add,
      curveTo(x1, y1, x2, y2, x3, y3) {
        add(x1, y1);
        add(x2, y2);
        add(x3, y3);
      },
    });
    if (part.length > 0) all.push(part);
    for (const each of all) {
      const box = extent(each);
      if (isOutside(bounds, { x0: box.x0 - grow, y0: box.y0 - grow, x1: box.x1 + grow, y1: box.y1 + grow })) outside = true;
    }
  };
  const device = new mupdf.Device({
    fillPath: (path, _evenOdd, ctm) => parts(path, ctm, 0),
    strokePath: (path, stroke, ctm) => parts(path, ctm, stroke.getLineWidth() / 2),
  });
  try {
    page.run(device, mupdf.Matrix.identity);
    device.close();
  } finally {
    device.destroy();
  }
  return outside;
}

/**
 * Step 6: removes the text and drawing parts wholly outside each page's visible area, by four
 * redaction areas that run from its edges outwards and never overlap it. Pixels outside it were
 * blanked in step 5.
 */
export function removeOutside(document: mupdf.PDFDocument, removed: Set<RemovalKind>): void {
  for (let index = 0; index < document.countPages(); index++) {
    const page = document.loadPage(index);
    try {
      if (anythingOutside(page)) removed.add("outside-page");
      const [x0, y0, x1, y1] = page.getBounds();
      const areas: Rect[] = [
        [-FAR, -FAR, x0, FAR],
        [x1, -FAR, FAR, FAR],
        [-FAR, -FAR, FAR, y0],
        [-FAR, y1, FAR, FAR],
      ];
      for (const [ax0, ay0, ax1, ay1] of areas) page.createAnnotation("Redact").setRect([ax0, ay0, ax1, ay1]);
      page.applyRedactions(false, mupdf.PDFPage.REDACT_IMAGE_NONE, mupdf.PDFPage.REDACT_LINE_ART_REMOVE_IF_COVERED, mupdf.PDFPage.REDACT_TEXT_REMOVE);
    } finally {
      page.destroy();
    }
  }
}
