// Text selection over the whole document. A position is a caret place between two
// characters of a page's text, so a selection can start on one page and end on another.
import type { PageText } from "../engine/model/document";
import { isPageIndex, type Box, type PageIndex } from "../engine/model/geometry";
import { bounds, rangeBoxes, rangeText, sharesColumns, wordAt } from "../engine/model/pageText";
import type { TextPiece, TextTarget } from "../engine/model/marks";

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

function pageText(texts: Texts, page: number): readonly [PageIndex, PageText] | undefined {
  const text = isPageIndex(page) ? texts.get(page) : undefined;
  return isPageIndex(page) && text !== undefined ? [page, text] : undefined;
}

const shown = (text: PageText, offset: number) => text.chars[offset]?.box !== undefined;
const onWord = (text: PageText, offset: number) => wordAt(text, offset) !== undefined;

interface Run {
  readonly start: number;
  readonly end: number;
  readonly box: Box;
}

/** A page's lines: each from its first character up to its line end. */
function lines(text: PageText): Run[] {
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

/** The pages a selection spans whose text has not arrived yet. */
export function missingPages(selection: Selection, texts: Texts): PageIndex[] {
  const [first, last] = sorted(selection);
  const missing: PageIndex[] = [];
  for (let number = first.page; number <= last.page; number++) {
    if (isPageIndex(number) && !texts.has(number)) missing.push(number);
  }
  return missing;
}

/** The selection as a text mark: one piece per page. Undefined when it holds no text, or a page's text is missing. */
export function selectionTarget(selection: Selection, texts: Texts): TextTarget | undefined {
  const [first, last] = sorted(selection);
  const pieces: TextPiece[] = [];
  const parts: string[] = [];
  for (let number = first.page; number <= last.page; number++) {
    const found = pageText(texts, number);
    if (found === undefined) return undefined;
    const [page, text] = found;
    let [start, end] = pieceRange(texts, page, text, first, last);
    // Line and block ends at either side are not part of the marked text.
    while (start < end && !shown(text, start)) start++;
    while (end > start && !shown(text, end - 1)) end--;
    const boxes = start < end ? rangeBoxes(text, start, end) : [];
    if (boxes.length === 0) continue;
    pieces.push({ page, start, end, boxes });
    parts.push(rangeText(text, start, end));
  }
  const [one, ...more] = pieces;
  return one && { kind: "text", text: parts.join(" "), pieces: [one, ...more] };
}

/** The first character from `from` onwards (or before it, going back) that is `wanted`, on any page after (or before). */
function find(
  texts: Texts,
  from: Position,
  forward: boolean,
  wanted: (text: PageText, offset: number) => boolean,
): Position | undefined {
  const step = forward ? 1 : -1;
  let found = pageText(texts, from.page);
  let offset = forward ? from.offset : from.offset - 1;
  while (found !== undefined) {
    const [page, text] = found;
    for (; offset >= 0 && offset < text.chars.length; offset += step) {
      if (wanted(text, offset)) return { page, offset };
    }
    found = pageText(texts, page + step);
    offset = forward || found === undefined ? 0 : found[1].chars.length - 1;
  }
  return undefined;
}

export const wordAround = (texts: Texts, at: Position | undefined) => {
  const text = at && texts.get(at.page);
  const word = at && text && wordAt(text, at.offset);
  return at && word && { anchor: { page: at.page, offset: word[0] }, focus: { page: at.page, offset: word[1] } };
};

/** Shift with ← or →: the focus one character on. */
function charStep(texts: Texts, from: Position, forward: boolean): Position | undefined {
  const at = find(texts, from, forward, shown);
  return at && { page: at.page, offset: forward ? at.offset + 1 : at.offset };
}

/** Option (or Ctrl) and Shift with ← or →: the focus to the end of the next word, or the start of the one before. */
function wordEdge(texts: Texts, from: Position, forward: boolean): Position | undefined {
  const word = wordAround(texts, find(texts, from, forward, onWord));
  return word && (forward ? word.focus : word.anchor);
}

const caretX = (text: PageText, offset: number) =>
  text.chars[offset]?.box?.x0 ?? text.chars[offset - 1]?.box?.x1 ?? 0;

interface LineOnPage {
  readonly page: PageIndex;
  readonly text: PageText;
  readonly line: Run;
}

/**
 * The line on screen below (or above) the one holding `from`, on this page or else the next
 * (or previous). It is the nearest line in the same column as the current one, falling back
 * to any line, and of the lines at that height the nearest across to `x`. Lines on screen,
 * not in reading order: in a table reading order runs along each row.
 */
function lineBeside(texts: Texts, from: Position, x: number, forward: boolean): LineOnPage | undefined {
  const here = pageText(texts, from.page);
  const own = here && lines(here[1]);
  const current = own?.findLast((line) => line.start <= from.offset);
  if (here === undefined || own === undefined || current === undefined) return undefined;
  const middle = (current.box.y0 + current.box.y1) / 2;
  const beyond = own.filter((line) => (forward ? line.box.y0 > middle : line.box.y1 < middle));
  const other = beyond.length > 0 ? undefined : pageText(texts, from.page + (forward ? 1 : -1));
  const [page, text] = other ?? here;
  const all = other === undefined ? beyond : lines(other[1]);
  const column = all.filter((line) => sharesColumns(line.box, current.box));
  const choices = column.length > 0 ? column : all;
  // The near edge of each line, then the lines within half a line of the nearest one.
  const edge = (line: Run) => (forward ? line.box.y0 : -line.box.y1);
  const nearest = Math.min(...choices.map(edge));
  const height = current.box.y1 - current.box.y0;
  const apart = (line: Run) => Math.max(line.box.x0 - x, 0, x - line.box.x1);
  const [line] = choices.filter((each) => edge(each) - nearest < height / 2).toSorted((a, b) => apart(a) - apart(b));
  return line && { page, text, line };
}

/** Shift with ↑ or ↓: the focus to the place nearest across on the line below or above. */
function lineStep(texts: Texts, from: Position, forward: boolean): Position | undefined {
  const text = texts.get(from.page);
  const x = text === undefined ? 0 : caretX(text, from.offset);
  const target = lineBeside(texts, from, x, forward);
  if (target === undefined) return undefined;
  const { line } = target;
  let best = line.start;
  for (let offset = line.start; offset <= line.end; offset++) {
    if (Math.abs(caretX(target.text, offset) - x) < Math.abs(caretX(target.text, best) - x)) best = offset;
  }
  return { page: target.page, offset: best };
}

/** ← or →: the next word, or the one before. */
export function nextWord(texts: Texts, selection: Selection, forward: boolean): Selection | undefined {
  const [first, last] = sorted(selection);
  return wordAround(texts, find(texts, forward ? last : first, forward, onWord));
}

/** ↑ or ↓: the word on the line below or above that is nearest across to the start of the selection. */
export function wordOnNextLine(texts: Texts, selection: Selection, forward: boolean): Selection | undefined {
  const [start] = sorted(selection);
  const text = texts.get(start.page);
  const x = text === undefined ? 0 : caretX(text, start.offset);
  const target = lineBeside(texts, start, x, forward);
  if (target === undefined) return undefined;
  const { page, line } = target;
  let nearest: { readonly offset: number; readonly apart: number } | undefined;
  for (let offset = line.start; offset < line.end; offset++) {
    const word = wordAt(target.text, offset);
    const box = word?.[0] === offset ? rangeBoxes(target.text, ...word)[0] : undefined;
    const apart = box === undefined ? Infinity : Math.max(box.x0 - x, 0, x - box.x1);
    if (apart < (nearest?.apart ?? Infinity)) nearest = { offset, apart };
  }
  return nearest && wordAround(texts, { page, offset: nearest.offset });
}

/** The first word inside `view` (points on the page), or the page's first word. */
export function firstWordIn(texts: Texts, page: PageIndex, view: Box | undefined): Selection | undefined {
  const text = texts.get(page);
  if (text === undefined) return undefined;
  for (let offset = 0; offset < text.chars.length; offset++) {
    const box = text.chars[offset]?.box;
    const inView = view === undefined || (box !== undefined && box.y0 >= view.y0 && box.y1 <= view.y1);
    if (inView && onWord(text, offset)) return wordAround(texts, { page, offset });
  }
  return wordAround(texts, find(texts, { page, offset: 0 }, true, onWord));
}

/** The selection after Shift with an arrow key: by character, by word with `byWord`, or by line. */
export function extend(texts: Texts, selection: Selection, key: string, byWord: boolean): Selection | undefined {
  const forward = key === "ArrowRight" || key === "ArrowDown";
  const focus =
    key === "ArrowUp" || key === "ArrowDown"
      ? lineStep(texts, selection.focus, forward)
      : byWord
        ? wordEdge(texts, selection.focus, forward)
        : charStep(texts, selection.focus, forward);
  return focus && { anchor: selection.anchor, focus };
}
