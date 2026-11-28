// Reason for a unit test: a character stored as two UTF-16 units, or a ligature, before a value
// shifts string positions against `chars` indexes; this fault has happened here before.
import { describe, expect, test } from "vitest";
import { normalise } from "./match";
import { charRange, textView } from "./textView";

/** The characters of `chars` that the string range of `value` in the view covers. */
function charsOf(chars: readonly string[], view: ReturnType<typeof textView>, value: string): string {
  const at = view.text.indexOf(value);
  const range = charRange(view, at, at + value.length);
  return range === undefined ? "" : chars.slice(range.start, range.end).join("");
}

describe("textView", () => {
  test("maps a value after a character of two units back to its own characters", () => {
    const chars = ["𝒜", " ", ..."4111111111111111"];
    const view = textView(chars);
    expect(view.text.indexOf("4111")).toBe(3);
    expect(charRange(view, 3, 19)).toEqual({ start: 2, end: 18 });
    expect(charsOf(chars, view, "4111111111111111")).toBe("4111111111111111");
  });

  test("keeps a ligature as written, one unit for one character", () => {
    const chars = ["ﬁ", "l", "e", " ", ..."42"];
    expect(charRange(textView(chars), 4, 6)).toEqual({ start: 4, end: 6 });
  });

  test("keeps line ends visible", () => {
    expect(textView(["a", "\n", "b"]).text).toBe("a\nb");
  });

  test("has no characters for an empty range", () => {
    expect(charRange(textView([..."abc"]), 1, 1)).toBeUndefined();
  });
});

describe("normalise, through the same map", () => {
  test("maps a value after a ligature, which reads as two letters, back to its own characters", () => {
    const chars = ["ﬁ", "l", "e", " ", ..."42"];
    const view = normalise(chars);
    expect(view.text).toBe("file 42");
    expect(charsOf(chars, view, "42")).toBe("42");
  });

  test("maps a value after a character of two units back to its own characters", () => {
    const chars = ["𝒜", " ", ..."Roe"];
    expect(charsOf(chars, normalise(chars), "roe")).toBe("Roe");
  });
});
