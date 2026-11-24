import type * as mupdf from "mupdf";
import type { PageChar, PageText } from "../model/document";
import type { Box, PageIndex } from "../model/geometry";
import { bounds, readingOrder } from "../model/pageText";
import type { FileNumber } from "../pdf-protocol/messages";
import { around, bodyOf, quadCorners } from "./geometry";
import type { PageGlyph } from "./glyphs";
import { fail, post } from "./messages";
import { current } from "./state";

interface Run<T> {
  readonly box: Box;
  readonly items: readonly T[];
}

const run = <T extends { readonly box: Box }>([first, ...rest]: readonly [T, ...T[]]): Run<T> => ({
  box: bounds([first.box, ...rest.map((item) => item.box)]),
  items: [first, ...rest],
});

const LINE_END: Extract<PageChar, { box: undefined }> = { c: "\n", box: undefined };

/**
 * The page's characters, blocks and lines in reading order (see `PageChar` for the offset
 * rule), and the same characters with each letter's ink band as its box.
 */
export function readText(page: mupdf.Page): { readonly text: PageText; readonly ink: PageText } {
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

export const pageText = (page: mupdf.Page): PageText => readText(page).text;

export function withPage<T>(document: mupdf.Document, index: number, use: (page: mupdf.Page) => T): T {
  const page = document.loadPage(index);
  try {
    return use(page);
  } finally {
    page.destroy();
  }
}

export function text(file: FileNumber, index: PageIndex): void {
  const document = current(file)?.original;
  try {
    if (document === undefined || index >= document.countPages()) throw new Error("No such page");
    post({ type: "text", file, page: index, text: withPage(document, index, pageText) });
  } catch {
    fail(file, "text-failed", `The text on page ${index + 1} could not be read. Open the PDF again.`);
  }
}
