// Keeping text marks on their letters when a build reads a page's text otherwise. A piece's
// stored letters and boxes are what it marks; its offsets only point at them.
import type { PageText } from "./document";
import type { PageIndex } from "./geometry";
import type { TextPiece, TextTarget } from "./marks";
import { contains, rangeText } from "./pageText";

type Texts = ReadonlyMap<PageIndex, PageText>;

/** Whether `text` still reads at its offsets on its page, as `rangeText` reads them. Empty text is unknown, so it never does. */
export const readsAt = (texts: Texts, { page, start, end, text }: Pick<TextPiece, "page" | "start" | "end" | "text">): boolean => {
  const pageText = texts.get(page);
  return text !== "" && pageText !== undefined && rangeText(pageText, start, end) === text;
};

const isLost = (piece: TextPiece, texts: Texts): boolean => !readsAt(texts, piece);

/** The indexes of the target's pieces whose letters are no longer at their offsets. */
export const lostPieces = (target: TextTarget, texts: Texts): readonly number[] =>
  target.pieces.flatMap((piece, index) => (isLost(piece, texts) ? [index] : []));

/** Whether a character can start or end a range: it is drawn, and is not a space. */
const isEdge = (text: PageText, offset: number): boolean => {
  const char = text.chars[offset];
  return char?.box !== undefined && char.c.trim() !== "";
};

/** The offsets of the characters on the page whose centres fall inside the piece's boxes. */
const insideBoxes = (piece: TextPiece, text: PageText): number[] =>
  text.chars.flatMap((char, offset) => {
    if (char.box === undefined) return [];
    const x = (char.box.x0 + char.box.x1) / 2;
    const y = (char.box.y0 + char.box.y1) / 2;
    return piece.boxes.some((box) => contains(box, x, y)) ? [offset] : [];
  });

/**
 * Every range from `first` to `last`, edges included, that reads as `letters`, as `rangeText`
 * reads a range: line ends and runs of white space are one space. The span is read once in that
 * form, keeping where each character came from, and searched, so a page-long mark stays quick.
 */
function rangesReading(text: PageText, first: number, last: number, letters: string): [number, number][] {
  let read = "";
  const from: number[] = [];
  for (let offset = first; offset <= last; offset++) {
    const char = text.chars[offset];
    const c = char === undefined || char.box === undefined || char.c.trim() === "" ? " " : char.c;
    if (c === " " && read.endsWith(" ")) continue;
    for (let unit = 0; unit < c.length; unit++) from.push(offset);
    read += c;
  }
  const found: [number, number][] = [];
  if (letters === "") return found;
  for (let at = read.indexOf(letters); at !== -1; at = read.indexOf(letters, at + 1)) {
    const start = from[at];
    const end = from[at + letters.length - 1];
    // A range starts and ends on a drawn letter, as the piece's own did.
    if (start !== undefined && end !== undefined && isEdge(text, start) && isEdge(text, end)) found.push([start, end + 1]);
  }
  return found;
}

/**
 * The piece placed again on its page: among the characters whose centres fall inside its boxes,
 * from the first to the last, the one range that reads as its letters. Undefined when there is
 * none, or more than one.
 */
function placed(piece: TextPiece, text: PageText): TextPiece | undefined {
  const inside = insideBoxes(piece, text);
  const first = inside[0];
  const last = inside.at(-1);
  if (first === undefined || last === undefined) return undefined;
  const [only, ...more] = rangesReading(text, first, last, piece.text);
  return only === undefined || more.length > 0 ? undefined : { ...piece, start: only[0], end: only[1] };
}

/** The target with each lost piece placed again, or "lost" when one can't be. Unchanged when none is lost. */
export function reanchor(target: TextTarget, texts: Texts): TextTarget | "lost" {
  const lost = new Set(lostPieces(target, texts));
  if (lost.size === 0) return target;
  const pieces: TextPiece[] = [];
  for (const [index, piece] of target.pieces.entries()) {
    const text = texts.get(piece.page);
    const again = !lost.has(index) ? piece : text && placed(piece, text);
    if (again === undefined) return "lost";
    pieces.push(again);
  }
  const [one, ...rest] = pieces;
  return one === undefined ? "lost" : { ...target, pieces: [one, ...rest] };
}

/**
 * Fills the letters of pieces stored before pieces kept them: a one-piece mark's are the mark's
 * own text, and the others' are read at their offsets in the text the older build stored. With
 * no such text, they stay empty, so the mark is lost.
 */
export function migratePieces(target: TextTarget, oldTexts: Texts | undefined): TextTarget {
  const [first, ...rest] = target.pieces;
  if (rest.length === 0) return first.text === "" ? { ...target, pieces: [{ ...first, text: target.text }] } : target;
  const fill = (piece: TextPiece): TextPiece => {
    if (piece.text !== "") return piece;
    const text = oldTexts?.get(piece.page);
    return { ...piece, text: text === undefined ? "" : rangeText(text, piece.start, piece.end) };
  };
  return { ...target, pieces: [fill(first), ...rest.map(fill)] };
}
