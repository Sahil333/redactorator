// Reasons for a unit test: the offset fault of textView.test.ts one step later, in the hits a
// recognizer gives; and a validator that throws must cost one value, not the page.
import { describe, expect, test } from "vitest";
import type { PageIndex } from "../model/geometry";
import { isPageIndex } from "../model/geometry";
import { compiledPacks } from "./packs/generated";
import { patternRecognizer } from "./patternRecognizer";
import { parsePack, type Rule } from "./recognizer";
import { jsRegexEngine } from "./regexEngine";
import { validators } from "./validators";

const page = (index: number): PageIndex => {
  if (!isPageIndex(index)) throw new Error("Not a page index");
  return index;
};

function universal() {
  const pack = parsePack(compiledPacks.universal);
  if (pack === undefined) throw new Error("The universal pack does not parse");
  const recognizer = patternRecognizer(jsRegexEngine, validators);
  recognizer.load([pack]);
  return recognizer;
}

const card = "4111 1111 1111 1111";

describe("the payment card rule", () => {
  test("finds a card number after a character of two units and a ligature, at its own characters", () => {
    const chars = [..."𝒜 ", "ﬁ", ..."le: ", ...card, "."];
    const { hits, errors } = universal().detect(page(0), chars);
    expect(errors).toBe(0);
    expect(hits).toHaveLength(1);
    const [hit] = hits;
    expect(chars.slice(hit?.start, hit?.end).join("")).toBe(card);
    expect(hit).toMatchObject({ page: 0, start: 7, end: 26, text: card, identifier: "payment-card", rule: "payment-card", recognizer: "pattern" });
    expect(hit?.evidence).toEqual([{ kind: "checksum", level: "checked" }]);
  });

  test("leaves out a number that fails the check, and one inside a longer number", () => {
    const chars = [..."4111 1111 1111 1112 and 94111111111111111"];
    expect(universal().detect(page(0), chars).hits).toEqual([]);
  });

  test("does not join a value across a line end", () => {
    const chars = [..."4111 1111", "\n", ..."1111 1111"];
    expect(universal().detect(page(0), chars).hits).toEqual([]);
  });
});

describe("a validator that throws", () => {
  const rule: Rule = { id: "test-number", identifier: "account-number", pattern: "(\\d{4})", valueGroup: 1, needs: "checked", validator: "faulty" };
  const faulty = (value: string) => {
    if (value === "1111") throw new Error("A fault in the check");
    return true;
  };

  test("costs that value only: it is counted, not offered, and the page goes on", () => {
    const recognizer = patternRecognizer(jsRegexEngine, { faulty });
    recognizer.load([{ id: "universal", version: "000000000000", rules: [rule] }]);
    const { hits, errors } = recognizer.detect(page(2), [..."1111 2222"]);
    expect(errors).toBe(1);
    expect(hits.map(({ text }) => text)).toEqual(["2222"]);
  });
});
