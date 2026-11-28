import { describe, expect, test } from "vitest";
import type { Evidence, FindingChange, Hit } from "./findings";
import { isPageIndex, pointBox, type PageIndex } from "./geometry";
import type { Mark } from "./marks";
import { resolve, type ResolverInput } from "./resolver";

function pageAt(index: number): PageIndex {
  if (!isPageIndex(index)) throw new Error("A bad page");
  return index;
}
const first = pageAt(0);
const second = pageAt(1);
const box = pointBox(0, 0, 1, 1);

const checksum: Evidence = { kind: "checksum", level: "checked" };
const label: Evidence = { kind: "label", level: "labelled", label: "UAN" };
const format: Evidence = { kind: "format", level: "format" };

const hit = (text: string, start: number, more: Partial<Hit> = {}): Hit => ({
  page: first,
  start,
  end: start + text.length,
  text,
  identifier: "us-ssn",
  evidence: [format],
  rule: "us-ssn",
  recognizer: "pattern",
  ...more,
});

function textMark(id: number, text: string, start: number, page: PageIndex = first): Mark {
  if (box === undefined) throw new Error("A bad box");
  return { id, type: "other", linkId: "", isNew: false, target: { kind: "text", text, pieces: [{ page, start, end: start + text.length, boxes: [box], text }] } };
}

const resolved = (input: Partial<ResolverInput>) => resolve({ hits: [], marks: [], rejected: [], changes: new Map(), ...input });

describe("resolve", () => {
  test("a hit where a mark of the same value sits is left out; one inside or around a mark of another value is kept", () => {
    const hits = [hit("123-45-6789", 0), hit("987-65-4321", 20), hit("555-12-3456", 40)];
    const marks = [
      // The same value, written another way, over part of the hit's place.
      textMark(1, "123 45 6789", 2),
      // Inside the second hit.
      textMark(2, "65-4321", 24),
      // Around the third hit.
      textMark(3, "SSN 555-12-3456", 36),
    ];
    expect(resolved({ hits, marks }).map(({ text }) => text)).toEqual(["987-65-4321", "555-12-3456"]);
  });

  test("a mark of the same value on another page, or beside the hit, leaves it in", () => {
    const hits = [hit("123-45-6789", 0)];
    expect(resolved({ hits, marks: [textMark(1, "123-45-6789", 0, second), textMark(2, "123-45-6789", 11)] })).toHaveLength(1);
  });

  test("a hit of a rejected value is left out", () => {
    expect(resolved({ hits: [hit("123-45-6789", 0), hit("987-65-4321", 20)], rejected: ["123456789"] }).map(({ key }) => key)).toEqual(["987654321"]);
  });

  test("hits on one span are one finding with a candidate per identifier, the stronger evidence the default", () => {
    const hits = [hit("123456789012", 0, { identifier: "in-uan", evidence: [label] }), hit("123456789012", 0, { identifier: "in-aadhaar", evidence: [checksum] })];
    const [finding, ...rest] = resolved({ hits });
    expect(rest).toEqual([]);
    expect(finding?.candidates.map(({ identifier }) => identifier)).toEqual(["in-aadhaar", "in-uan"]);
    expect(finding).toMatchObject({ chosen: 0, level: "checked", reasons: [checksum], ticked: true });
  });

  test("with equal evidence, the order of the packs, then of the rules, picks the default", () => {
    const card = hit("4111111111111111", 0, { identifier: "us-bank-account" });
    const other = { ...card, identifier: "payment-card" };
    const firstRule = { ...card, identifier: "in-bank-account" };
    const secondRule = { ...card, identifier: "in-aadhaar" };
    expect(resolved({ hits: [card, other] })[0]?.candidates.map(({ identifier }) => identifier)).toEqual(["payment-card", "us-bank-account"]);
    expect(resolved({ hits: [firstRule, secondRule] })[0]?.candidates.map(({ identifier }) => identifier)).toEqual(["in-bank-account", "in-aadhaar"]);
  });

  test("two hits whose spans overlap are two findings", () => {
    const hits = [hit("12-34-56 12345678", 0, { identifier: "uk-sort-code-account" }), hit("12345678", 9, { identifier: "us-bank-account" })];
    expect(resolved({ hits }).map(({ text, places }) => [text, places])).toEqual([
      ["12-34-56 12345678", [{ page: first, start: 0, end: 17 }]],
      ["12345678", [{ page: first, start: 9, end: 17 }]],
    ]);
  });

  test("places that share a key are one finding, written as at its first place, with every identifier found at any of them", () => {
    const hits = [hit("123 45 6789", 0, { page: second }), hit("123-45-6789", 30, { identifier: "us-itin", evidence: [checksum] }), hit("123-45-6789", 50)];
    const [finding, ...rest] = resolved({ hits });
    expect(rest).toEqual([]);
    expect(finding).toMatchObject({
      key: "123456789",
      text: "123-45-6789",
      places: [
        { page: first, start: 30, end: 41 },
        { page: first, start: 50, end: 61 },
        { page: second, start: 0, end: 11 },
      ],
      level: "checked",
    });
    expect(finding?.candidates.map(({ identifier }) => identifier)).toEqual(["us-itin", "us-ssn"]);
  });

  test("sorts the strongest evidence first, then by first place", () => {
    const hits = [hit("111-11-1111", 0), hit("222-22-2222", 20, { evidence: [label] }), hit("333-33-3333", 40, { evidence: [checksum] }), hit("444-44-4444", 0, { page: second, evidence: [label] })];
    expect(resolved({ hits }).map(({ text }) => text)).toEqual(["333-33-3333", "222-22-2222", "444-44-4444", "111-11-1111"]);
  });

  test("applies the user's changes by key, and ignores a change whose finding is gone", () => {
    const hits = [hit("123456789012", 0, { identifier: "in-uan", evidence: [label] }), hit("123456789012", 0, { identifier: "in-aadhaar", evidence: [checksum] })];
    const changes = new Map<string, FindingChange>([
      ["123456789012", { ticked: false, candidate: "in-uan" }],
      ["gone", { ticked: false }],
    ]);
    expect(resolved({ hits, changes })).toMatchObject([{ ticked: false, chosen: 1, level: "labelled", reasons: [label] }]);
  });

  test("findings whose values became one are joined, ticked if either was, and a place where the value as changed is marked is left out", () => {
    const hits = [hit("123-45-6789", 0), hit("123-45", 20), hit("123-45-6789", 40)];
    const changes = new Map<string, FindingChange>([
      ["123456789", { ticked: false, edge: "123-45" }],
      ["12345", { ticked: true }],
    ]);
    const [finding, ...rest] = resolved({ hits, changes, marks: [textMark(1, "123-45", 40)] });
    expect(rest).toEqual([]);
    expect(finding).toMatchObject({
      key: "123456789",
      edge: "123-45",
      ticked: true,
      places: [
        { page: first, start: 0, end: 11 },
        { page: first, start: 20, end: 26 },
      ],
    });
  });

  test("the same input gives the same output", () => {
    const hits = [hit("123-45-6789", 0), hit("987-65-4321", 20, { evidence: [checksum] })];
    expect(resolved({ hits })).toEqual(resolved({ hits }));
  });

  test("resolves 5,000 hits against 5,000 marks within 200 ms", () => {
    const values = Array.from({ length: 5000 }, (_, at) => String(100_000_000 + at * 7));
    const hits = values.map((value, at) => hit(value, (at % 50) * 20, { page: pageAt(Math.floor(at / 50)), evidence: [at % 3 === 0 ? checksum : format] }));
    // Every other value is marked where it was found; the rest are marked elsewhere.
    const marks = values.map((value, at) => textMark(at + 1, value, at % 2 === 0 ? (at % 50) * 20 : 1000 + at, pageAt(Math.floor(at / 50))));
    const started = Date.now();
    const findings = resolved({ hits, marks });
    const took = Date.now() - started;
    expect(findings).toHaveLength(2500);
    expect(took).toBeLessThan(200);
  });
});
