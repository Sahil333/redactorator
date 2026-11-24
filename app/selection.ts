import type { PageText } from "../engine/model/document";
import { isPageIndex, type Box, type PageIndex } from "../engine/model/geometry";
import type { TextPiece, TextTarget } from "../engine/model/marks";
import { rangeBoxes, rangeText, sharesColumns, wordAt } from "../engine/model/pageText";
import {
  lines,
  pageText,
  pieceRange,
  shown,
  sorted,
  type Position,
  type Run,
  type Selection,
  type Texts,
} from "../engine/model/selection";

const onWord = (text: PageText, offset: number) => wordAt(text, offset) !== undefined;

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
