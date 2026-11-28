// What a recognizer is: it loads packs once, then finds hits on one page at a time. It returns
// hits, never findings; the resolver in the core makes findings of them.
import type { LoadedPack } from "../detect-protocol/messages";
import { parseLoadedPack } from "../detect-protocol/parse";
import { evidenceLevels, type EvidenceLevel, type Hit } from "../model/findings";
import type { PageIndex } from "../model/geometry";
import { isName, isRecord, isText, parseAll } from "../model/guards";
import type { MarkType } from "../model/markTypes";

export const notNextTos = ["letter", "digit", "letter-or-digit"] as const;

/** What may not sit right before or after a value, checked in code after the match. */
export type NotNextTo = (typeof notNextTos)[number];

export const labelSides = ["before", "after", "either"] as const;

/** Where a label may sit, seen from the value. */
export type LabelSide = (typeof labelSides)[number];

/** A rule's labels: one of `words` within `distance` characters of the value, on `side`, in the same block. */
export interface Labels {
  readonly words: readonly string[];
  readonly side: LabelSide;
  readonly distance: number;
}

/** One rule of a pack, as the pack compiler writes it (docs/designs/auto-mode.md, Technical Plan, section 3). */
export interface Rule {
  readonly id: string;
  readonly identifier: MarkType;
  /** Run with the flags `u` and `d`, on the page as written. */
  readonly pattern: string;
  /** Which group of the pattern is the value. */
  readonly valueGroup: number;
  /** The least evidence a hit needs. */
  readonly needs: EvidenceLevel;
  readonly notNextTo?: NotNextTo;
  /** A name in the registry of validators. */
  readonly validator?: string;
  readonly labels?: Labels;
  /** A list the text of the pattern's group `group` is looked up in. */
  readonly list?: { readonly name: string; readonly group: number };
  /** A rule whose hit within `distance` characters, in the same block, is evidence for this one. */
  readonly companion?: { readonly rule: string; readonly distance: number };
  /** Rules whose hit with a label on the same span drops this rule's hit. */
  readonly yieldsTo?: readonly string[];
}

export interface Pack extends LoadedPack {
  readonly rules: readonly Rule[];
}

/** A committed list of known codes, such as the Indian banks' codes. */
export interface List {
  readonly name: string;
  /** What one entry is, for the user: "is a known {title}". */
  readonly title: string;
  readonly entries: readonly string[];
}

export interface PageResult {
  readonly hits: readonly Hit[];
  /** How many values met an error in a check. */
  readonly errors: number;
}

export interface Recognizer {
  /** Once, before any page. Throws when a pack cannot be loaded. */
  load(packs: readonly Pack[], lists: readonly List[]): void;
  detect(page: PageIndex, chars: readonly string[]): PageResult;
}

export const isCount = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value > 0;

/** Undefined when `value` is absent, else what `parse` makes of it, or null when that fails. */
function optional<T>(value: unknown, parse: (value: unknown) => T | undefined): T | undefined | null {
  if (value === undefined) return undefined;
  return parse(value) ?? null;
}

const parseNames = (value: unknown): string[] | undefined => parseAll(value, (name) => (isName(name) ? name : undefined));

function parseLabels({ labels, labelSide, distance }: Record<string, unknown>): Labels | undefined {
  const words = parseNames(labels);
  const side = labelSides.find((known) => known === labelSide);
  return words && words.length > 0 && side !== undefined && isCount(distance) ? { words, side, distance } : undefined;
}

function parseList(value: unknown): Rule["list"] {
  return isRecord(value) && isName(value.name) && isCount(value.group) ? { name: value.name, group: value.group } : undefined;
}

function parseCompanion(value: unknown): Rule["companion"] {
  return isRecord(value) && isName(value.rule) && isCount(value.distance) ? { rule: value.rule, distance: value.distance } : undefined;
}

/** A rule's optional fields, or undefined when one is present but does not parse. */
function parseOptionals(value: Record<string, unknown>): Partial<Rule> | undefined {
  const notNextTo = optional(value.notNextTo, (side) => notNextTos.find((known) => known === side));
  const validator = optional(value.validator, (name) => (isName(name) ? name : undefined));
  const labels = optional(value.labels, () => parseLabels(value));
  const list = optional(value.list, parseList);
  const companion = optional(value.companion, parseCompanion);
  const yieldsTo = optional(value.yieldsTo, parseNames);
  if (notNextTo === null || validator === null || labels === null || list === null || companion === null || yieldsTo === null) return undefined;
  return { ...(notNextTo && { notNextTo }), ...(validator && { validator }), ...(labels && { labels }), ...(list && { list }), ...(companion && { companion }), ...(yieldsTo && { yieldsTo }) };
}

function parseRule(value: unknown): Rule | undefined {
  if (!isRecord(value)) return undefined;
  const { id, identifier, pattern, valueGroup } = value;
  const needs = evidenceLevels.find((level) => level === value.needs);
  const optionals = parseOptionals(value);
  if (!isName(id) || !isName(identifier) || !isName(pattern) || !isCount(valueGroup) || needs === undefined || optionals === undefined) return undefined;
  return { ...optionals, id, identifier, pattern, valueGroup, needs };
}

/** A compiled pack, or undefined when it does not have a pack's shape. The rules' sources are not read here. */
export function parsePack(value: unknown): Pack | undefined {
  if (!isRecord(value)) return undefined;
  const loaded = parseLoadedPack(value);
  const rules = parseAll(value.rules, parseRule);
  return loaded && rules ? { ...loaded, rules } : undefined;
}

/** A compiled list, or undefined when it does not have a list's shape. Its source and terms are not read here. */
export function parseCompiledList(value: unknown): List | undefined {
  if (!isRecord(value) || !isName(value.name) || !isName(value.title)) return undefined;
  const entries = parseAll(value.entries, (entry) => (isText(entry) && entry !== "" ? entry : undefined));
  return entries && { name: value.name, title: value.title, entries };
}
