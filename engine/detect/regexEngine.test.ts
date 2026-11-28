// Reasons for a unit test: a match of length zero makes a `RegExp` loop repeat for ever unless the
// position is moved by hand, and a browser test would see that only as a timeout; and a value
// inside a longer match that was rejected was lost (found in review).
import { describe, expect, test } from "vitest";
import { jsRegexEngine } from "./regexEngine";

const values = (pattern: string, text: string, valueGroup = 1) =>
  jsRegexEngine.compile([{ pattern, valueGroup }]).scan(text, ({ value }) => text.slice(value.start, value.end));

describe("jsRegexEngine", () => {
  test("goes past matches of length zero and finds the values between them", () => {
    expect(values("(\\d*)", "ab12cd345")).toEqual(["12", "345"]);
  });

  test("goes past a match of length zero on a character of two units", () => {
    expect(values("(\\d*)", "𝒜1𝒜22")).toEqual(["1", "22"]);
  });

  test("gives one rule's matches left to right, without overlap", () => {
    expect(values("(\\d{2})", "12345")).toEqual(["12", "34"]);
  });

  test("gives the span of the whole match and of the value group", () => {
    const [found] = jsRegexEngine.compile([{ pattern: "No\\. (\\d+)", valueGroup: 1 }]).scan("See No. 42", (match) => match);
    expect(found?.match).toEqual({ start: 4, end: 10 });
    expect(found?.value).toEqual({ start: 8, end: 10 });
  });

  test("after a match it rejects, tries again one character later, so a value inside it is found", () => {
    const text = "2026 4111 1111";
    const found = jsRegexEngine
      .compile([{ pattern: "(\\d{4}(?: \\d{4})+)", valueGroup: 1 }])
      .scan(text, ({ value }) => (value.start === 0 ? undefined : text.slice(value.start, value.end)));
    expect(found).toEqual(["4111 1111"]);
  });

  test("refuses a rule whose value group the pattern does not have", () => {
    expect(() => jsRegexEngine.compile([{ pattern: "(\\d+)", valueGroup: 2 }])).toThrow();
  });
});
