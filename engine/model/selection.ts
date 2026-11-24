// Text selection over the whole document. A position is a caret place between two
// characters of a page's text, so a selection can start on one page and end on another.
import type { PageText } from "./document";
import { isPageIndex, type Box, type PageIndex } from "./geometry";
import type { TextPiece, TextTarget } from "./marks";
import { bounds, rangeBoxes, rangeText } from "./pageText";

/** Before character `offset` of a page's text; from 0 to the text's length. */
export interface Position {
  readonly page: PageIndex;
  readonly offset: number;
}

export interface Selection {
  readonly anchor: Position;
  readonly focus: Position;
}

/** The text of each page that has arrived from the engine. */
export type Texts = ReadonlyMap<PageIndex, PageText>;

const compare = (a: Position, b: Position) => a.page - b.page || a.offset - b.offset;

export const sorted = ({ anchor, focus }: Selection): readonly [Position, Position] =>
  compare(anchor, focus) <= 0 ? [anchor, focus] : [focus, anchor];

export function pageText(texts: Texts, page: number): readonly [PageIndex, PageText] | undefined {
  const text = isPageIndex(page) ? texts.get(page) : undefined;
  return isPageIndex(page) && text !== undefined ? [page, text] : undefined;
}

export const shown = (text: PageText, offset: number) => text.chars[offset]?.box !== undefined;

export interface Run {
  readonly start: number;
  readonly end: number;
  readonly box: Box;
}

/** A page's lines: each from its first character up to its line end. */
export function lines(text: PageText): Run[] {
  const found: Run[] = [];
  let start = 0;
  text.chars.forEach((char, offset) => {
    if (char.box !== undefined) return;
    const [first, ...rest] = text.chars.slice(start, offset).flatMap((each) => (each.box ? [each.box] : []));
    if (first) found.push({ start, end: offset, box: bounds([first, ...rest]) });
    start = offset + 1;
  });
  return found;
}

/** A page's blocks, each with its line and block ends. A block end follows a line end. */
function blocks(text: PageText): Run[] {
  const found: Run[] = [];
  let open: Run | undefined;
  for (const line of lines(text)) {
    open = open === undefined ? line : { start: open.start, end: line.end, box: bounds([open.box, line.box]) };
    if (text.chars[line.end + 1]?.box === undefined && line.end + 1 < text.chars.length) {
      found.push({ ...open, end: line.end + 2 });
      open = undefined;
    }
  }
  return found;
}

// Running text, such as a header or a page number, is at the same place on the next page
// and reads the same there but for its numbers.
const RUNNING_PLACE = 3;
const runningKey = (text: PageText, block: Run) => rangeText(text, block.start, block.end).replace(/\d+/g, "#");

/** The starts of the page's blocks (`own`) that repeat on a neighbouring page. */
function runningBlocks(texts: Texts, page: PageIndex, text: PageText, own: readonly Run[]): Set<number> {
  const theirs = [page - 1, page + 1].flatMap((neighbour) => {
    const found = pageText(texts, neighbour);
    return found ? blocks(found[1]).map((block) => ({ box: block.box, key: runningKey(found[1], block) })) : [];
  });
  const repeats = (block: Run) => {
    const key = runningKey(text, block);
    return theirs.some(
      (other) =>
        other.key === key &&
        Math.abs(other.box.x0 - block.box.x0) < RUNNING_PLACE &&
        Math.abs(other.box.y0 - block.box.y0) < RUNNING_PLACE,
    );
  };
  return new Set(own.filter(repeats).map((block) => block.start));
}

/**
 * The selected range of one page. Where the selection runs over a page edge it leaves out
 * the page's running headers and footers, unless one of its ends is inside one.
 */
function pieceRange(texts: Texts, page: PageIndex, text: PageText, first: Position, last: Position): [number, number] {
  const start = page === first.page ? first.offset : 0;
  const end = page === last.page ? last.offset : text.chars.length;
  if (first.page === last.page) return [start, end];
  const all = blocks(text);
  const running = runningBlocks(texts, page, text, all);
  const top =
    page === first.page
      ? start
      : pastRunning(all, running, (block) => [block.start, block.end], (block) => page === last.page && end < block.end);
  const foot =
    page === last.page
      ? end
      : pastRunning(all.toReversed(), running, (block) => [block.end, block.start], (block) => page === first.page && start >= block.start);
  return [top, foot];
}

/**
 * From one edge of the page past the running blocks in a row there, taking `order` from that
 * edge inwards. `across` gives a block's near and far edge. A block `kept` (one an end of the
 * selection is inside) stops it.
 */
function pastRunning(
  order: readonly Run[],
  running: ReadonlySet<number>,
  across: (block: Run) => readonly [near: number, far: number],
  kept: (block: Run) => boolean,
): number {
  const [first] = order;
  let at = first === undefined ? 0 : across(first)[0];
  for (const block of order) {
    const [near, far] = across(block);
    if (near !== at || !running.has(block.start) || kept(block)) break;
    at = far;
  }
  return at;
}

/** A text mark's part on one page, before its boxes and text are worked out. */
export type TextPieceRange = Omit<TextPiece, "boxes">;

/**
 * The selection from `first` to `last` as one range per page, with line and block ends trimmed
 * from either side. A page left with nothing, as one that is all running blocks, has no range.
 */
export function selectionPieces(texts: Texts, first: Position, last: Position): readonly TextPieceRange[] | "page-text-missing" {
  const pieces: TextPieceRange[] = [];
  for (let number = first.page; number <= last.page; number++) {
    const found = pageText(texts, number);
    if (found === undefined) return "page-text-missing";
    const [page, text] = found;
    let [start, end] = pieceRange(texts, page, text, first, last);
    while (start < end && !shown(text, start)) start++;
    while (end > start && !shown(text, end - 1)) end--;
    if (start < end) pieces.push({ page, start, end });
  }
  return pieces;
}

/** A text mark's target over `pieces`: each piece's boxes, one per line, and the text, joined by a space. */
export function textTarget(texts: Texts, pieces: readonly TextPieceRange[]): TextTarget | "page-text-missing" | "empty-target" {
  const boxed: TextPiece[] = [];
  const parts: string[] = [];
  for (const { page, start, end } of pieces) {
    const text = texts.get(page);
    if (text === undefined) return "page-text-missing";
    const boxes = rangeBoxes(text, start, end);
    if (boxes.length === 0) continue;
    boxed.push({ page, start, end, boxes });
    parts.push(rangeText(text, start, end));
  }
  const [one, ...more] = boxed;
  return one === undefined ? "empty-target" : { kind: "text", text: parts.join(" "), pieces: [one, ...more] };
}
