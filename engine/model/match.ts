// How a hidden value is found again in other text. Two spellings match when they differ only
// in case, in spaces and line ends, or in the spaces, dashes and dots inside a number. A match
// sits on word boundaries, so "Roe" never matches inside "Monroe", and never crosses pages.
import { charRange, mapText, type TextView } from "./textView";

const isSpace = (c: string) => c.trim() === "";
// What can sit between the groups of a number written as 1234 5678, 1234-5678 or 12.34.56,
// besides white space: a hyphen, a dot, the dashes U+2010 to U+2015 and the minus sign.
const joinerMarks = "\\-.\\u2010-\\u2015\\u2212";
const isJoinerMark = new RegExp(`^[${joinerMarks}]$`);
const isJoiner = (c: string) => isSpace(c) || isJoinerMark.test(c);

/** The joiners as a regular expression's character class: white space and the marks above. */
export const joinerClass = `[\\s${joinerMarks}]`;

const isDigit = (c: string | undefined) => c !== undefined && /^\p{Nd}$/u.test(c);
const isWordUnit = (c: string | undefined) => c !== undefined && /^[\p{L}\p{N}\p{M}]$/u.test(c);

/** Where the run of joiners starting at `start` ends; `start` itself when there is none there. */
function runEnd(chars: readonly string[], start: number): number {
  let end = start;
  while (end < chars.length && isJoiner(chars[end] ?? "")) end++;
  return end;
}

/**
 * What the joiners in [start, end) read as, each with the index it came from: nothing between
 * two digits on one line, so every way of grouping a number reads the same; else their dashes
 * and dots, with each run of spaces as one space. A line end keeps numbers apart, as in a
 * column of figures.
 */
function joinerUnits(chars: readonly string[], start: number, end: number): [string, number][] {
  const inNumber = isDigit(chars[start - 1]) && isDigit(chars[end]) && !chars.slice(start, end).includes("\n");
  if (inNumber) return [];
  const units: [string, number][] = [];
  for (let at = start; at < end; at++) {
    const c = chars[at] ?? "";
    if (!isSpace(c)) units.push([c, at]);
    else if (units.at(-1)?.[0] !== " ") units.push([" ", at]);
  }
  return units;
}

/** Folds case and compatibility forms (a ligature reads as its letters), and collapses spacing. */
export const normalise = (chars: readonly string[]): TextView =>
  mapText((put) => {
    let index = 0;
    while (index < chars.length) {
      const end = runEnd(chars, index);
      if (end === index) {
        put((chars[index] ?? "").normalize("NFKC").toLowerCase(), index);
        index++;
      } else {
        for (const [unit, at] of joinerUnits(chars, index, end)) put(unit, at);
        index = end;
      }
    }
  });

/**
 * The form of a value that every spelling of it shares, without punctuation at either end, so
 * "Jane Roe," finds "Jane Roe". Empty when the value has no letters or digits.
 */
export const keyOf = (value: string): string =>
  normalise([...value]).text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

/** Where a key was found on a page: [start, end) of the page's characters. */
export interface Found {
  /** The key's index in the keys searched for. */
  readonly key: number;
  readonly page: number;
  readonly start: number;
  readonly end: number;
}

/** Every place each key sits on word boundaries in a document, given as each page's characters. */
export function findAll(pages: readonly (readonly string[])[], keys: readonly string[]): Found[] {
  const found: Found[] = [];
  pages.forEach((chars, page) => {
    const view = normalise(chars);
    const { text } = view;
    keys.forEach((key, index) => {
      if (key === "") return;
      let at = text.indexOf(key);
      while (at !== -1) {
        const end = at + key.length;
        const range = charRange(view, at, end);
        const onBoundaries = !isWordUnit(text[at - 1]) && !isWordUnit(text[end]);
        if (onBoundaries && range !== undefined) found.push({ key: index, page, ...range });
        at = text.indexOf(key, onBoundaries ? end : at + 1);
      }
    });
  });
  return found;
}
