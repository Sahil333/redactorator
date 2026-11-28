// What Auto mode offers: the resolver turns one ended run's hits into findings
// (docs/designs/auto-mode.md, Technical Plan, section 3). It needs no page text, as each hit
// carries its own, and the same input always gives the same output.
import { packOrder } from "./detection";
import type { Candidate, Evidence, EvidenceLevel, Finding, FindingChange, FindingPlace, Hit } from "./findings";
import { identifierPacks } from "./identifiers";
import { keyOf } from "./match";
import { markKey, type Mark } from "./marks";
import type { MarkType } from "./markTypes";

export interface ResolverInput {
  readonly hits: readonly Hit[];
  /** The document's marks, without its lost marks: their stored positions point at other characters. */
  readonly marks: readonly Mark[];
  /** The keys of the document's rejected values. */
  readonly rejected: readonly string[];
  /** What the user changed in the open findings review, by finding key. */
  readonly changes: ReadonlyMap<string, FindingChange>;
}

const strength: Readonly<Record<EvidenceLevel, number>> = { checked: 0, labelled: 1, format: 2 };

const strongest = (evidence: readonly Evidence[]): EvidenceLevel =>
  evidence.reduce<EvidenceLevel>((best, { level }) => (strength[level] < strength[best] ? level : best), "format");

/** Where each value is marked: by key, then by page, the ranges of its text marks. */
type Marked = ReadonlyMap<string, ReadonlyMap<number, readonly FindingPlace[]>>;

function markedPlaces(marks: readonly Mark[]): Marked {
  const marked = new Map<string, Map<number, FindingPlace[]>>();
  for (const mark of marks) {
    const key = markKey(mark);
    if (mark.target.kind !== "text" || key === undefined) continue;
    const pages = marked.get(key) ?? new Map<number, FindingPlace[]>();
    marked.set(key, pages);
    for (const { page, start, end } of mark.target.pieces) {
      const places = pages.get(page) ?? [];
      pages.set(page, places);
      places.push({ page, start, end });
    }
  }
  return marked;
}

/** Whether a text mark of the value `key` shares a character with `place`. */
const isMarked = (marked: Marked, key: string, place: FindingPlace): boolean =>
  marked.get(key)?.get(place.page)?.some(({ start, end }) => start < place.end && place.start < end) ?? false;

/** One identifier for a span, or for a finding: its evidence, and the index of its first hit, which keeps the order of the rules. */
interface Reading {
  readonly identifier: MarkType;
  readonly evidence: readonly Evidence[];
  readonly order: number;
}

/** The hits on one span: one reading per identifier. */
interface Span {
  readonly place: FindingPlace;
  readonly text: string;
  readonly key: string;
  readonly readings: ReadonlyMap<MarkType, Reading>;
}

function evidenceId(evidence: Evidence): string {
  switch (evidence.kind) {
    case "label":
      return `label:${evidence.level}:${evidence.label}`;
    case "list":
      return `list:${evidence.level}:${evidence.list}`;
    case "companion":
      return `companion:${evidence.level}:${evidence.companion}`;
    default:
      return `${evidence.kind}:${evidence.level}`;
  }
}

function joined(was: Reading | undefined, now: Reading): Reading {
  if (was === undefined) return now;
  const evidence = new Map([...was.evidence, ...now.evidence].map((each) => [evidenceId(each), each]));
  return { identifier: was.identifier, evidence: [...evidence.values()], order: Math.min(was.order, now.order) };
}

const packRank = (identifier: MarkType): number => {
  const pack = identifierPacks[identifier];
  return pack === undefined ? packOrder.length : packOrder.indexOf(pack);
};

/** The default first: the stronger evidence, then the order of the packs, then the order of the rules. */
const byDefault = (a: Reading, b: Reading): number =>
  strength[strongest(a.evidence)] - strength[strongest(b.evidence)] || packRank(a.identifier) - packRank(b.identifier) || a.order - b.order;

const byPlace = (a: FindingPlace, b: FindingPlace): number => a.page - b.page || a.start - b.start || a.end - b.end;

/** Every finding has a place: one whose places are all marked is left out. */
function byFirstPlace({ places: [a] }: Finding, { places: [b] }: Finding): number {
  return a === undefined || b === undefined ? 0 : byPlace(a, b);
}

/** Steps 1 to 3: the hits not already marked as the same value nor rejected, joined by exact span. */
function spansOf({ hits, rejected }: ResolverInput, marked: Marked): Span[] {
  const refused = new Set(rejected);
  const spans = new Map<string, Span & { readonly readings: Map<MarkType, Reading> }>();
  hits.forEach((hit, order) => {
    const key = keyOf(hit.text);
    const place: FindingPlace = { page: hit.page, start: hit.start, end: hit.end };
    if (refused.has(key) || isMarked(marked, key, place)) return;
    const id = `${place.page}:${place.start}:${place.end}`;
    const span = spans.get(id) ?? { place, text: hit.text, key, readings: new Map() };
    spans.set(id, span);
    span.readings.set(hit.identifier, joined(span.readings.get(hit.identifier), { identifier: hit.identifier, evidence: hit.evidence, order }));
  });
  return [...spans.values()].sort((a, b) => byPlace(a.place, b.place));
}

/** A finding before the user's changes: its places in order, and its readings with the default first. */
interface Found {
  readonly key: string;
  readonly text: string;
  readonly places: readonly FindingPlace[];
  readonly readings: readonly Reading[];
}

/** Step 4: places that share a key are one finding, which has every identifier found at any of them. */
function foundOf(spans: readonly Span[]): Found[] {
  const byKey = new Map<string, { text: string; places: FindingPlace[]; readings: Map<MarkType, Reading> }>();
  for (const { key, text, place, readings } of spans) {
    const found = byKey.get(key) ?? { text, places: [], readings: new Map<MarkType, Reading>() };
    byKey.set(key, found);
    found.places.push(place);
    for (const [identifier, reading] of readings) found.readings.set(identifier, joined(found.readings.get(identifier), reading));
  }
  return [...byKey].map(([key, { text, places, readings }]) => ({ key, text, places, readings: [...readings.values()].sort(byDefault) }));
}

const candidateOf = ({ identifier, evidence }: Reading): Candidate => ({ identifier, level: strongest(evidence), reasons: evidence });

/** A finding with the user's change to it, and the key of its value as changed. */
interface Changed {
  readonly value: string;
  readonly finding: Finding;
}

function changedOf({ key, text, places, readings }: Found, change: FindingChange | undefined): Changed {
  const candidates = readings.map(candidateOf);
  const picked = candidates.findIndex(({ identifier }) => identifier === change?.candidate);
  const chosen = Math.max(picked, 0);
  const { level, reasons } = candidates[chosen] ?? { level: "format", reasons: [] };
  const edge = change?.edge;
  const finding: Finding = { key, text, places, candidates, chosen, level, reasons, ticked: change?.ticked ?? true, ...(edge === undefined ? {} : { edge }) };
  return { value: edge === undefined ? key : keyOf(edge), finding };
}

/** Two findings whose values became one after the user's changes: the first keeps its key and choices, and gains the other's places and identifiers. */
function merged(first: Finding, other: Finding): Finding {
  const known = new Set(first.candidates.map(({ identifier }) => identifier));
  return {
    ...first,
    places: [...first.places, ...other.places].sort(byPlace),
    candidates: [...first.candidates, ...other.candidates.filter(({ identifier }) => !known.has(identifier))],
    ticked: first.ticked || other.ticked,
  };
}

/** Step 5: the user's changes by key; findings whose values became one are joined, and places where that value is marked are left out. */
function withChanges(found: readonly Found[], changes: ResolverInput["changes"], marked: Marked): Finding[] {
  const byValue = new Map<string, Finding>();
  for (const each of found) {
    const { value, finding } = changedOf(each, changes.get(each.key));
    const first = byValue.get(value);
    byValue.set(value, first === undefined ? finding : merged(first, finding));
  }
  return [...byValue].flatMap(([value, finding]) => {
    const places = finding.places.filter((place) => !isMarked(marked, value, place));
    return places.length === 0 ? [] : [{ ...finding, places }];
  });
}

/** The findings of `input`, strongest evidence first, then by first place (step 6). */
export function resolve(input: ResolverInput): Finding[] {
  const marked = markedPlaces(input.marks);
  const findings = withChanges(foundOf(spansOf(input, marked)), input.changes, marked);
  return findings.sort((a, b) => strength[a.level] - strength[b.level] || byFirstPlace(a, b));
}
