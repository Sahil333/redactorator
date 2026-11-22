import { describe, expect, test } from "vitest";
import { findAll, keyOf } from "./match";

/** Finds `value` in one page of text, and returns each place as the text it covers. */
function places(page: string, value: string): string[] {
  const chars = [...page];
  return findAll([chars], [keyOf(value)]).map(({ start, end }) => chars.slice(start, end).join(""));
}

describe("keyOf", () => {
  test("folds case, collapses spacing and drops punctuation at the ends", () => {
    expect(keyOf("  Jane \n  ROE, ")).toBe("jane roe");
  });

  test("drops the spaces, dashes and dots inside a number, but not those between words", () => {
    expect(keyOf("1234 5678")).toBe("12345678");
    expect(keyOf("1234-5678")).toBe("12345678");
    expect(keyOf("12.34.56")).toBe("123456");
    expect(keyOf("Smith-Jones")).toBe("smith-jones");
  });

  test("reads a ligature as its letters", () => {
    expect(keyOf("ﬁle")).toBe("file");
  });

  test("is empty for a value with no letters or digits", () => {
    expect(keyOf(" , ")).toBe("");
  });
});

describe("findAll", () => {
  test("matches across case, spacing and line ends", () => {
    expect(places("Statement by JANE  ROE about it, signed by Jane\nRoe.", "Jane Roe")).toEqual(["JANE  ROE", "Jane\nRoe"]);
  });

  test("matches a number however its groups are written", () => {
    expect(places("Account 1234-5678, also 1234.5678 and 12345678.", "1234 5678")).toEqual(["1234-5678", "1234.5678", "12345678"]);
  });

  test("matches whole words only", () => {
    expect(places("Monroe met Roe and Roebuck; Roe's.", "Roe")).toEqual(["Roe", "Roe"]);
  });

  test("finds a number alone on its line, between figures on the lines around it", () => {
    const chars = [..."10", "\n", ..."2026", "\n", ..."15"];
    expect(findAll([chars], [keyOf("2026")])).toEqual([{ key: 0, page: 0, start: 3, end: 7 }]);
  });

  test("never matches part of a longer number", () => {
    expect(places("Ref 91234 5678 and 1234 5678", "1234 5678")).toEqual(["1234 5678"]);
  });

  test("finds each key on each page, and never across a page break", () => {
    const pages = [[..."one Jane"], [..."Roe two Jane Roe"]];
    expect(findAll(pages, ["roe", keyOf("Jane Roe")])).toEqual([
      { key: 0, page: 1, start: 0, end: 3 },
      { key: 0, page: 1, start: 13, end: 16 },
      { key: 1, page: 1, start: 8, end: 16 },
    ]);
  });

  test("gives offsets into the page's characters, where a line end is one character", () => {
    const chars = ["D", "r", "\n", "J", "o", "\n", "\n"];
    expect(findAll([chars], [keyOf("Dr Jo")])).toEqual([{ key: 0, page: 0, start: 0, end: 5 }]);
  });
});
