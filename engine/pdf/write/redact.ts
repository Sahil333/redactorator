import * as mupdf from "mupdf";
import type { Appearance, Edit } from "../../model/document";
import type { Box, PageIndex } from "../../model/geometry";
import { rangeBoxes, rangeText } from "../../model/pageText";
import { around } from "../geometry";
import { centre, glyphsOf, inside, overlap, type PageGlyph } from "../glyphs";
import { READING_OPTIONS } from "../readingOptions";
import { readText, withPage } from "../text";
import { openPdf, WriteRefused, type Redaction } from "./common";

// The label font is Helvetica in WinAnsiEncoding, which matches Latin-1 on these code points.
const inWinAnsi = (c: string) => {
  const code = c.charCodeAt(0);
  return c.length === 1 && ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff));
};

/**
 * A text edit's box and ink band on each line. An edit whose letters are not the page's at its
 * offsets would remove other text and keep its own, so it is refused as lost (the guard).
 */
function textAreas({ text, ink }: ReturnType<typeof readText>, edit: Extract<Edit, { kind: "text" }>): { box: Box; textArea: Box }[] {
  const fits = edit.end <= text.chars.length && rangeText(text, edit.start, edit.end) === edit.text;
  const boxes = fits ? rangeBoxes(text, edit.start, edit.end) : [];
  const bands = fits ? rangeBoxes(ink, edit.start, edit.end) : [];
  if (boxes.length === 0 || bands.length !== boxes.length) throw new WriteRefused("mark-lost", { page: edit.page });
  return boxes.map((box, line) => ({ box, textArea: bands[line] ?? box }));
}

/**
 * A text mark's box, trimmed above and below so that it covers none of the letters it leaves. On
 * lines set closer than their font's height, a line's full height reaches into the next line's
 * letters, and a box drawn over them would hide letters the file still holds. It is never trimmed
 * into the marked letters' own ink band: where their ink truly meets another line's, the check
 * still refuses.
 */
function trimmed({ box, textArea }: { box: Box; textArea: Box }, kept: readonly PageGlyph[]): Box {
  let { y0, y1 }: { y0: number; y1: number } = box;
  for (const { body } of kept) {
    const middle = (body.y0 + body.y1) / 2;
    // A letter on the marked line itself is beside the box, not above or below it.
    if (!overlap(box, body) || (middle > textArea.y0 && middle < textArea.y1)) continue;
    if (middle <= textArea.y0) y0 = Math.max(y0, body.y1);
    else y1 = Math.min(y1, body.y0);
  }
  return around([
    [box.x0, Math.min(y0, textArea.y0)],
    [box.x1, Math.max(y1, textArea.y1)],
  ]);
}

/** A page's redactions with each text mark's box trimmed clear of the letters no box removes. */
function trimmedOnPage(original: mupdf.Document, page: PageIndex, redactions: readonly Redaction[], fromText: ReadonlySet<Redaction>): Redaction[] {
  if (!redactions.some((redaction) => fromText.has(redaction))) return [...redactions];
  const kept = withPage(original, page, (each) => glyphsOf(each, READING_OPTIONS)).filter(
    (glyph) => glyph.c.trim() !== "" && !redactions.some(({ textArea }) => inside(textArea, centre(glyph.body))),
  );
  return redactions.map((redaction) => (fromText.has(redaction) ? { ...redaction, box: trimmed(redaction, kept) } : redaction));
}

/** Each page's redaction boxes, with text edits turned into one box per line from the original's own text. */
export function redactionsByPage(original: mupdf.Document, edits: readonly Edit[]): Map<PageIndex, Redaction[]> {
  const byPage = new Map<PageIndex, Redaction[]>();
  const fromText = new Set<Redaction>();
  for (const edit of edits) {
    if (edit.page >= original.countPages()) throw new Error("An edit names a page the file does not have");
    const areas = edit.kind === "box" ? [{ box: edit.box, textArea: edit.box }] : textAreas(withPage(original, edit.page, readText), edit);
    const list = byPage.get(edit.page) ?? [];
    const printed = `[${[...edit.label.toUpperCase()].map((c) => (inWinAnsi(c) ? c : "?")).join("")}]`;
    const made = areas.map((area) => ({ ...area, printed }));
    if (edit.kind === "text") for (const each of made) fromText.add(each);
    list.push(...made);
    byPage.set(edit.page, list);
  }
  for (const [page, list] of byPage) byPage.set(page, trimmedOnPage(original, page, list, fromText));
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

export function redact(bytes: Uint8Array, byPage: Map<PageIndex, Redaction[]>, appearance: Appearance): Uint8Array<ArrayBuffer> {
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
        // Applying takes the Redact annotations out of /Annots but leaves the empty array, which
        // the working copy never had and the outside checker's structure check rejects.
        const annotations = page.getObject().get("Annots");
        if (annotations.isArray() && annotations.length === 0) page.getObject().delete("Annots");
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
