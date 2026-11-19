// Pure functions over a page's text model, shared by the UI and the worker so a
// text mark is boxed the same way on screen and in the file.
import type { Box, PageText } from "./contract";

const min = <T extends number>(a: T, b: T): T => (a < b ? a : b);
const max = <T extends number>(a: T, b: T): T => (a > b ? a : b);

const union = (a: Box, b: Box): Box => ({
  x0: min(a.x0, b.x0),
  y0: min(a.y0, b.y0),
  x1: max(a.x1, b.x1),
  y1: max(a.y1, b.y1),
});

/** The smallest box around all of `boxes`. */
export const bounds = ([first, ...rest]: readonly [Box, ...Box[]]): Box => rest.reduce(union, first);

/** Whether two boxes overlap across: they share part of a column. */
export const sharesColumns = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1;

/**
 * Puts text blocks, or the lines in a block, in reading order. Each item goes before the
 * first item already placed that shares its columns and starts below it, or else at the
 * end. So a running header that MuPDF lists after the body moves to the top, and
 * side-by-side columns keep MuPDF's order.
 */
export function readingOrder<T extends { readonly box: Box }>(items: readonly T[]): T[] {
  const placed: T[] = [];
  for (const item of items) {
    const below = placed.findIndex((other) => sharesColumns(item.box, other.box) && item.box.y0 < other.box.y0);
    placed.splice(below === -1 ? placed.length : below, 0, item);
  }
  return placed;
}

/** One box per line for the characters in [start, end). */
export function rangeBoxes(text: PageText, start: number, end: number): Box[] {
  const boxes: Box[] = [];
  let line: Box | undefined;
  for (const char of text.chars.slice(start, end)) {
    if (char.box === undefined) {
      if (line !== undefined) boxes.push(line);
      line = undefined;
    } else {
      line = line === undefined ? char.box : union(line, char.box);
    }
  }
  if (line !== undefined) boxes.push(line);
  return boxes;
}

/** The characters in [start, end), with each line or block end and any run of whitespace read as one space. */
export const rangeText = (text: PageText, start: number, end: number): string =>
  text.chars
    .slice(start, end)
    .map((char) => (char.box === undefined ? " " : char.c))
    .join("")
    .replace(/\s+/g, " ")
    .trim();

export const contains = (box: Box, x: number, y: number) => x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1;

/** The offset of the character under (x, y), or else the nearest one. Undefined on a page with no text. */
export function charAt(text: PageText, x: number, y: number): number | undefined {
  let nearest: number | undefined;
  let nearestDistance = Infinity;
  for (const [offset, char] of text.chars.entries()) {
    if (char.box === undefined) continue;
    if (contains(char.box, x, y)) return offset;
    const dx = Math.max(char.box.x0 - x, 0, x - char.box.x1);
    const dy = Math.max(char.box.y0 - y, 0, y - char.box.y1);
    const distance = dx * dx + dy * dy;
    if (distance < nearestDistance) {
      nearest = offset;
      nearestDistance = distance;
    }
  }
  return nearest;
}

const isWordChar = (text: PageText, offset: number): boolean => {
  const char = text.chars[offset];
  return char?.box !== undefined && char.c.trim() !== "";
};

/** The [start, end) of the word around `offset`, or undefined when it is not on a word. */
export function wordAt(text: PageText, offset: number): readonly [number, number] | undefined {
  if (!isWordChar(text, offset)) return undefined;
  let start = offset;
  let end = offset + 1;
  while (isWordChar(text, start - 1)) start--;
  while (isWordChar(text, end)) end++;
  return [start, end];
}
