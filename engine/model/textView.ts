// A page's characters as one string, with the way back from each position in the string to the
// character it came from. A character can be more than one UTF-16 unit, or several units after
// normalising, so string positions and character indexes drift apart; this map is the one place
// that drift is handled.

/** A string made from a page's characters, and for each of its code units the index of the character it came from. */
export interface TextView {
  readonly text: string;
  readonly from: readonly number[];
}

/** Builds a text view: `write` puts each piece of the string with the index of the character it stands for. */
export function mapText(write: (put: (units: string, index: number) => void) => void): TextView {
  let text = "";
  const from: number[] = [];
  write((units, index) => {
    text += units;
    for (let unit = 0; unit < units.length; unit++) from.push(index);
  });
  return { text, from };
}

/** The page's characters as written, line ends and block ends included. */
export const textView = (chars: readonly string[]): TextView =>
  mapText((put) => {
    for (const [index, c] of chars.entries()) put(c, index);
  });

/** The characters [start, end) of `chars` that the string range [start, end) of `view` covers; undefined when the range is empty. */
export function charRange({ from }: TextView, start: number, end: number): { readonly start: number; readonly end: number } | undefined {
  const first = from[start];
  const last = from[end - 1];
  return end > start && first !== undefined && last !== undefined ? { start: first, end: last + 1 } : undefined;
}
