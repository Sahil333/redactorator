// The recognizer of this phase: a pack's rules as regular expressions over the page as written.
// Each match is checked for its neighbours, by its validator, in its list and for a label near
// it; then the evidence that needs two hits is worked out: a companion, and one rule giving way
// to another (docs/designs/auto-mode.md, Technical Plan, section 3).
import { packOrder } from "../model/detection";
import type { PageChar, PageText } from "../model/document";
import type { Evidence, EvidenceLevel, Hit } from "../model/findings";
import { pointBox, type PageIndex } from "../model/geometry";
import { keyOf, normalise } from "../model/match";
import { rangeText } from "../model/pageText";
import { charRange, textView } from "../model/textView";
import type { Labels, List, NotNextTo, Recognizer, Rule } from "./recognizer";
import type { CompiledRules, RegexEngine, RegexMatch, Span } from "./regexEngine";
import type { Validator } from "./validators";

const neighbours: Readonly<Record<NotNextTo, RegExp>> = {
  letter: /^\p{L}$/u,
  digit: /^\p{Nd}$/u,
  "letter-or-digit": /^[\p{L}\p{Nd}]$/u,
};

const isWordUnit = (c: string | undefined) => c !== undefined && /^[\p{L}\p{N}\p{M}]$/u.test(c);

const strength: Readonly<Record<EvidenceLevel, number>> = { checked: 3, labelled: 2, format: 1 };

const strongest = (evidence: readonly Evidence[]): number => Math.max(...evidence.map(({ level }) => strength[level]));

const checksum: Evidence = { kind: "checksum", level: "checked" };
const format: Evidence = { kind: "format", level: "format" };

const emptyBox = pointBox(0, 0, 0, 0);

/**
 * The page's characters as a page text. It exists so a hit's text is read by `rangeText`, the
 * function a mark's text is read by. The page message carries no boxes; by its contract an entry
 * is "\n" exactly where the stored character has no box. `rangeText` reads a box only to tell
 * those apart, so every other entry gets an empty box and the text read is the same.
 */
function pageTextOf(chars: readonly string[]): PageText {
  const box = emptyBox;
  if (box === undefined) throw new Error("An empty box could not be made");
  return { chars: chars.map((c): PageChar => (c === "\n" ? { c, box: undefined } : { c, box })) };
}

/** Whether the whole character before the value, or the one after it, is what the rule may not sit next to. */
function isNextTo(text: string, { start, end }: Span, notNextTo: NotNextTo): boolean {
  const before = [...text.slice(Math.max(0, start - 2), start)].at(-1);
  const after = [...text.slice(end, end + 2)][0];
  return [before, after].some((c) => c !== undefined && neighbours[notNextTo].test(c));
}

/** A rule ready to scan with: its validator and list looked up, its labels as keys. */
interface Loaded {
  readonly rule: Rule;
  readonly pattern: string;
  readonly valueGroup: number;
  readonly listGroup?: number;
  readonly validator?: Validator;
  readonly list?: { readonly title: string; readonly entries: ReadonlySet<string> };
  readonly labels?: Labels & { readonly keys: readonly string[] };
}

function loaded(rule: Rule, validators: Readonly<Record<string, Validator>>, lists: ReadonlyMap<string, List>): Loaded {
  const { pattern, valueGroup, labels } = rule;
  const validator = rule.validator === undefined ? undefined : validators[rule.validator];
  if (rule.validator !== undefined && validator === undefined) throw new Error("A rule names a validator that does not exist");
  const list = rule.list && lists.get(rule.list.name);
  if (rule.list !== undefined && list === undefined) throw new Error("A rule names a list that is not loaded");
  return {
    rule,
    pattern,
    valueGroup,
    ...(rule.list && { listGroup: rule.list.group }),
    ...(validator && { validator }),
    ...(list && { list: { title: list.title, entries: new Set(list.entries.map((entry) => entry.toLowerCase())) } }),
    ...(labels && { labels: { ...labels, keys: labels.words.map(keyOf) } }),
  };
}

/** [start, end) of the page's characters. */
interface Range {
  readonly start: number;
  readonly end: number;
}

/** A line end followed by a second one ends a block (`PageChar`). */
const isBlockEnd = (chars: readonly string[], at: number): boolean => chars[at] === "\n" && chars[at + 1] === "\n";

/** The characters at most `distance` before `start` (or after `end`), stopping at a block end. */
function nearby(chars: readonly string[], { start, end }: Range, distance: number, side: "before" | "after"): Range {
  if (side === "before") {
    let from = start;
    while (from > Math.max(0, start - distance) && !isBlockEnd(chars, from - 2)) from--;
    return { start: from, end: start };
  }
  let to = end;
  while (to < Math.min(chars.length, end + distance) && !isBlockEnd(chars, to)) to++;
  return { start: end, end: to };
}

/** Where `key` sits in `region` on word boundaries: each place as a range of the page's characters. */
function placesOf(chars: readonly string[], region: Range, key: string): Range[] {
  const view = normalise(chars.slice(region.start, region.end));
  const places: Range[] = [];
  for (let at = view.text.indexOf(key); at !== -1; at = view.text.indexOf(key, at + 1)) {
    const start = (view.from[at] ?? 0) + region.start;
    const end = (view.from[at + key.length - 1] ?? 0) + region.start + 1;
    const before = at === 0 ? chars[start - 1] : view.text[at - 1];
    const after = at + key.length === view.text.length ? chars[end] : view.text[at + key.length];
    if (!isWordUnit(before) && !isWordUnit(after)) places.push({ start, end });
  }
  return places;
}

/** The label nearest the value on one side, as the rule writes it, with how far it lies; undefined when none is there. */
function nearestLabel(chars: readonly string[], value: Range, { words, keys, distance }: NonNullable<Loaded["labels"]>, side: "before" | "after"): { readonly word: string; readonly gap: number } | undefined {
  const region = nearby(chars, value, distance, side);
  let nearest: { word: string; gap: number } | undefined;
  for (const [index, key] of keys.entries()) {
    const word = words[index] ?? key;
    for (const place of placesOf(chars, region, key)) {
      const gap = side === "before" ? value.start - place.end : place.start - value.end;
      if (nearest === undefined || gap < nearest.gap) nearest = { word, gap };
    }
  }
  return nearest;
}

function labelEvidence(chars: readonly string[], value: Range, labels: NonNullable<Loaded["labels"]>): Evidence | undefined {
  const sides: readonly ("before" | "after")[] = labels.side === "either" ? ["before", "after"] : [labels.side];
  const found = sides.map((side) => nearestLabel(chars, value, labels, side)).filter((label) => label !== undefined);
  const [nearest] = found.toSorted((a, b) => a.gap - b.gap);
  return nearest && { kind: "label", level: "labelled", label: nearest.word };
}

/** A match the first pass kept, with the evidence it has on its own. */
interface Candidate {
  readonly entry: Loaded;
  readonly range: Range;
  readonly evidence: readonly Evidence[];
}

const meetsNeeds = ({ entry, evidence }: Candidate): boolean => strongest(evidence) >= strength[entry.rule.needs];

/** Whether no block end lies between two ranges of one page. */
function inOneBlock(chars: readonly string[], a: Range, b: Range): boolean {
  for (let at = Math.min(a.end, b.end); at < Math.max(a.start, b.start) - 1; at++) if (isBlockEnd(chars, at)) return false;
  return true;
}

const gapBetween = (a: Range, b: Range): number => Math.max(a.start - b.end, b.start - a.end);

/** The candidate with companion evidence added when a hit of its companion rule lies near it. */
function withCompanion(candidate: Candidate, all: readonly Candidate[], chars: readonly string[]): Candidate {
  const { companion } = candidate.entry.rule;
  if (companion === undefined) return candidate;
  const near = all.find((other) => {
    const gap = gapBetween(candidate.range, other.range);
    return other.entry.rule.id === companion.rule && meetsNeeds(other) && gap >= 0 && gap <= companion.distance && inOneBlock(chars, candidate.range, other.range);
  });
  return near ? { ...candidate, evidence: [...candidate.evidence, { kind: "companion", level: "labelled", companion: near.entry.rule.identifier }] } : candidate;
}

/** How many values met an error, a value being a span of the page; the retry after a rejected match can meet one value more than once. */
function errorCount(spans: readonly Range[]): number {
  let count = 0;
  let end = -1;
  for (const span of spans.toSorted((a, b) => a.start - b.start)) {
    if (span.start >= end) count++;
    end = Math.max(end, span.end);
  }
  return count;
}

/**
 * A value's evidence of its own: its check, its list and its label, else its format; or "error"
 * when its validator failed with one. A validator sees the value's letters and digits only.
 */
function ownEvidence(entry: Loaded, chars: readonly string[], range: Range, value: string, listed: string | undefined): readonly Evidence[] | "error" {
  const evidence: Evidence[] = [];
  try {
    if (entry.validator?.(value.replace(/[^\p{L}\p{N}]/gu, ""))) evidence.push(checksum);
  } catch {
    // A fault in one check costs that value only (docs/designs/auto-mode.md, section 8).
    return "error";
  }
  if (entry.list !== undefined && listed !== undefined && entry.list.entries.has(listed.toLowerCase())) evidence.push({ kind: "list", level: "checked", list: entry.list.title });
  const label = entry.labels && labelEvidence(chars, range, entry.labels);
  if (label !== undefined) evidence.push(label);
  return evidence.length > 0 ? evidence : [format];
}

/**
 * Runs the loaded packs' rules through `engine`, each checked by the validator it names in
 * `validators` and looked up in the list it names. Hits come rule by rule: the packs in
 * `packOrder`, each pack's rules in the order they are written. The resolver breaks a tie between
 * identifiers on one span by that order.
 */
export function patternRecognizer(engine: RegexEngine, validators: Readonly<Record<string, Validator>>): Recognizer {
  let compiled: CompiledRules<Loaded> | undefined;

  return {
    load(packs, lists) {
      const byName = new Map(lists.map((list) => [list.name, list]));
      const inOrder = [...packs].sort((a, b) => packOrder.indexOf(a.id) - packOrder.indexOf(b.id));
      compiled = engine.compile(inOrder.flatMap(({ rules }) => rules.map((rule) => loaded(rule, validators, byName))));
    },
    detect(page: PageIndex, chars: readonly string[]) {
      if (compiled === undefined) throw new Error("No packs are loaded");
      const view = textView(chars);
      const errored: Range[] = [];

      /** The match's evidence, or undefined when it is not a value: next to what it may not be, a check that failed with an error, or too little evidence. */
      const firstPass = ({ rule: entry, value, list }: RegexMatch<Loaded>): Candidate | undefined => {
        const { rule } = entry;
        const range = charRange(view, value.start, value.end);
        if (range === undefined || (rule.notNextTo !== undefined && isNextTo(view.text, value, rule.notNextTo))) return undefined;
        const evidence = ownEvidence(entry, chars, range, view.text.slice(value.start, value.end), list && view.text.slice(list.start, list.end));
        if (evidence === "error") {
          errored.push(range);
          return undefined;
        }
        const candidate = { entry, range, evidence };
        // A rule with a companion keeps a match that its companion could still raise to what it needs.
        const couldMeet = rule.companion !== undefined && strength.labelled >= strength[rule.needs];
        return meetsNeeds(candidate) || couldMeet ? candidate : undefined;
      };

      const candidates = compiled.scan(view.text, firstPass);
      const kept = candidates.map((candidate) => withCompanion(candidate, candidates, chars)).filter(meetsNeeds);
      const labelled = new Set(kept.filter(({ evidence }) => evidence.some(({ kind }) => kind === "label")).map(({ entry, range }) => `${entry.rule.id}:${range.start}:${range.end}`));
      const text = pageTextOf(chars);
      const hits = kept
        .filter(({ entry, range }) => !entry.rule.yieldsTo?.some((other) => labelled.has(`${other}:${range.start}:${range.end}`)))
        .map(({ entry: { rule }, range, evidence }): Hit => ({ page, ...range, text: rangeText(text, range.start, range.end), identifier: rule.identifier, evidence, rule: rule.id, recognizer: "pattern" }));
      return { hits, errors: errorCount(errored) };
    },
  };
}
