import { describe, expect, test } from "vitest";
import type { PageChar, PageText } from "./document";
import { isPageIndex, pointBox, type Box, type PageIndex } from "./geometry";
import type { TextPiece, TextTarget } from "./marks";
import { bounds, rangeBoxes } from "./pageText";
import { lostPieces, migratePieces, reanchor } from "./textAnchor";

function box(x0: number, y0: number, x1: number, y1: number): Box {
  const made = pointBox(x0, y0, x1, y1);
  if (made === undefined) throw new Error("Not a box");
  return made;
}

function pageIndex(n: number): PageIndex {
  if (!isPageIndex(n)) throw new Error("Not a page index");
  return n;
}

const END: PageChar = { c: "\n", box: undefined };

/** A page of lines, each set from x 72 in 6 pt letters, 20 pt apart, each line ending its own block. */
function page(lines: readonly string[], shift = 0): PageText {
  return {
    chars: lines.flatMap((line, row) => [
      ...[...line].map((c, at): PageChar => ({ c, box: box(72 + at * 6 + shift, 80 + row * 20, 78 + at * 6 + shift, 96 + row * 20) })),
      END,
      END,
    ]),
  };
}

/** A piece over [start, end) of `text`, boxed and lettered as a mark made on it. */
function pieceOn(text: PageText, pageNumber: number, start: number, end: number, letters: string): TextPiece {
  return { page: pageIndex(pageNumber), start, end, boxes: rangeBoxes(text, start, end), text: letters };
}

const target = (text: string, first: TextPiece, ...rest: TextPiece[]): TextTarget => ({ kind: "text", text, pieces: [first, ...rest] });
const texts = (...pages: PageText[]) => new Map(pages.map((text, index) => [pageIndex(index), text]));

const letter = page(["Dear Jane Roe, thanks", "Jane Roe again"]);
const jane = target("Jane Roe", pieceOn(letter, 0, 5, 13, "Jane Roe"));

describe("lostPieces", () => {
  test("finds no piece lost while its letters are at its offsets", () => {
    expect(lostPieces(jane, texts(letter))).toEqual([]);
  });

  test("finds a piece lost whose offsets now hold other letters", () => {
    expect(lostPieces(jane, texts(page(["Dear Ms Jane Roe, thanks"])))).toEqual([0]);
  });

  test("finds a piece with no letters lost", () => {
    expect(lostPieces(target("Jane Roe", { ...jane.pieces[0], text: "" }), texts(letter))).toEqual([0]);
  });
});

describe("reanchor", () => {
  test("leaves a mark that is not lost as it is", () => {
    expect(reanchor(jane, texts(letter))).toBe(jane);
  });

  test("places a one-line mark again when letters were added before it", () => {
    const now = page(["Dear Jane Roe, thanks"]);
    const before = { ...jane, pieces: [{ ...jane.pieces[0], start: 3, end: 11 }] } satisfies TextTarget;
    expect(reanchor(before, texts(now))).toEqual(jane);
  });

  test("places a mark again when characters before it were removed", () => {
    const before = { ...jane, pieces: [{ ...jane.pieces[0], start: 9, end: 17 }] } satisfies TextTarget;
    expect(reanchor(before, texts(letter))).toEqual(jane);
  });

  test("places a mark across lines again, line ends included", () => {
    const lines = page(["Signed by Jane", "Roe, here"]);
    const across = target("Jane Roe", pieceOn(lines, 0, 10, 19, "Jane Roe"));
    const moved = { ...across, pieces: [{ ...across.pieces[0], start: 12, end: 21 }] } satisfies TextTarget;
    expect(reanchor(moved, texts(lines))).toEqual(across);
  });

  test("places each piece of a mark across pages again", () => {
    const one = page(["Signed by Jane"]);
    const two = page(["Roe, here"]);
    const [jane, roe] = [pieceOn(one, 0, 10, 14, "Jane"), pieceOn(two, 1, 0, 3, "Roe")];
    const across = target("Jane Roe", jane, roe);
    const moved = target("Jane Roe", { ...jane, start: 2, end: 6 }, { ...roe, start: 1, end: 4 });
    expect(reanchor(moved, texts(one, two))).toEqual(across);
  });

  test("takes the same word inside the boxes, not the one outside them", () => {
    const second = target("Jane Roe", pieceOn(letter, 0, 23, 31, "Jane Roe"));
    const moved = { ...second, pieces: [{ ...second.pieces[0], start: 5, end: 13 }] } satisfies TextTarget;
    expect(lostPieces(moved, texts(letter))).toEqual([]);
    const shifted = { ...second, pieces: [{ ...second.pieces[0], start: 0, end: 8 }] } satisfies TextTarget;
    expect(reanchor(shifted, texts(letter))).toEqual(second);
  });

  test("places a mark whose letters' boxes moved by 0.3 pt", () => {
    const now = page(["Dear Jane Roe, thanks", "Jane Roe again"], 0.3);
    const moved = { ...jane, pieces: [{ ...jane.pieces[0], start: 0, end: 8 }] } satisfies TextTarget;
    expect(reanchor(moved, texts(now))).toEqual(jane);
  });

  test("places a flattened form value, read after the page's own text, again", () => {
    // Flattening adds the field's value as a block after the page's text, so its offsets move.
    const before = page(["Name:"]);
    const valued: PageText = {
      chars: [...before.chars, ...[..."Jane Roe"].map((c, at): PageChar => ({ c, box: box(120 + at * 6, 80, 126 + at * 6, 96) })), END, END],
    };
    const mark = target("Jane Roe", pieceOn(valued, 0, 7, 15, "Jane Roe"));
    const readFirst: PageText = { chars: [...valued.chars.slice(7, 17), ...before.chars] };
    expect(reanchor(mark, texts(readFirst))).toEqual(target("Jane Roe", { ...mark.pieces[0], start: 0, end: 8 }));
  });

  test("stays lost when two ranges inside the boxes read as its letters", () => {
    const twice = page(["Roe Roe"]);
    const both: TextPiece = { page: pageIndex(0), start: 0, end: 3, boxes: [bounds([box(72, 80, 114, 96)])], text: "Roe" };
    expect(reanchor(target("Roe", { ...both, start: 1, end: 4 }), texts(twice))).toBe("lost");
  });

  test("places a mark that runs over a whole page of lines again, quickly", () => {
    const lines = Array.from({ length: 60 }, (_, row) => `Line ${row} of the statement, with account 4400 ${1000 + row}`);
    const long = page(lines);
    const all = target("all", pieceOn(long, 0, 0, long.chars.length - 2, lines.join(" ")));
    const moved = { ...all, pieces: [{ ...all.pieces[0], start: 5, end: long.chars.length - 2 }] } satisfies TextTarget;
    const started = Date.now();
    expect(reanchor(moved, texts(long))).toEqual(all);
    expect(Date.now() - started).toBeLessThan(500);
  });

  test("stays lost when its letters are not found", () => {
    const moved = { ...jane, pieces: [{ ...jane.pieces[0], start: 0, end: 8 }] } satisfies TextTarget;
    expect(reanchor(moved, texts(page(["Dear Joan Roe, thanks"])))).toBe("lost");
  });
});

describe("migratePieces", () => {
  const unknown = (piece: TextPiece): TextPiece => ({ ...piece, text: "" });

  test("gives a one-piece mark the mark's text", () => {
    expect(migratePieces(target("Jane Roe", unknown(jane.pieces[0])), undefined)).toEqual(jane);
  });

  test("reads a multi-piece mark's pieces from the older build's text", () => {
    const one = page(["Signed by Jane"]);
    const two = page(["Roe, here"]);
    const [jane, roe] = [pieceOn(one, 0, 10, 14, "Jane"), pieceOn(two, 1, 0, 4, "Roe,")];
    expect(migratePieces(target("Jane Roe,", unknown(jane), unknown(roe)), texts(one, two))).toEqual(target("Jane Roe,", jane, roe));
  });

  test("leaves a multi-piece mark's pieces empty, so lost, without the older text", () => {
    const one = page(["Signed by Jane"]);
    const two = page(["Roe, here"]);
    const across = target("Jane Roe,", unknown(pieceOn(one, 0, 10, 14, "")), unknown(pieceOn(two, 1, 0, 4, "")));
    const migrated = migratePieces(across, undefined);
    expect(migrated).toEqual(across);
    expect(reanchor(migrated, texts(one, two))).toBe("lost");
  });
});
