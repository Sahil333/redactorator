// What a recognizer is: it loads packs once, then finds hits on one page at a time. It returns
// hits, never findings; the resolver in the core makes findings of them.
import { packOrder, type PackId } from "../model/detection";
import type { EvidenceLevel, Hit } from "../model/findings";
import type { PageIndex } from "../model/geometry";
import { isRecord, isText, parseAll } from "../model/guards";
import type { MarkType } from "../model/markTypes";

/** What may not sit right before or after a value, checked in code after the match. */
export type NotNextTo = "letter" | "digit" | "letter-or-digit";

/** One rule of a pack, as the pack compiler writes it. Labels, lists, companions and `yieldsTo` come with slice P0. */
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
}

export interface Pack {
  readonly id: PackId;
  /** The first 12 hex digits of the SHA-256 of its compiled rules. */
  readonly version: string;
  readonly rules: readonly Rule[];
}

export interface PageResult {
  readonly hits: readonly Hit[];
  /** How many values met an error in a check. */
  readonly errors: number;
}

export interface Recognizer {
  /** Once, before any page. Throws when a pack cannot be loaded. */
  load(packs: readonly Pack[]): void;
  detect(page: PageIndex, chars: readonly string[]): PageResult;
}

const levels: readonly EvidenceLevel[] = ["checked", "labelled", "format"];
const notNextTos: readonly NotNextTo[] = ["letter", "digit", "letter-or-digit"];

const isName = (value: unknown): value is string => isText(value) && value !== "";

/** Undefined when `value` is absent or null, else what `parse` makes of it, or null when that fails. */
function optional<T>(value: unknown, parse: (value: unknown) => T | undefined): T | undefined | null {
  if (value === undefined || value === null) return undefined;
  return parse(value) ?? null;
}

function parseRule(value: unknown): Rule | undefined {
  if (!isRecord(value)) return undefined;
  const { id, identifier, pattern, valueGroup } = value;
  const needs = levels.find((level) => level === value.needs);
  const notNextTo = optional(value.notNextTo, (side) => notNextTos.find((known) => known === side));
  const validator = optional(value.validator, (name) => (isName(name) ? name : undefined));
  if (!isName(id) || !isName(identifier) || !isName(pattern) || typeof valueGroup !== "number" || needs === undefined || notNextTo === null || validator === null) {
    return undefined;
  }
  return { id, identifier, pattern, valueGroup, needs, ...(notNextTo === undefined ? {} : { notNextTo }), ...(validator === undefined ? {} : { validator }) };
}

/** A compiled pack, or undefined when it does not have a pack's shape. Fields a later slice reads are left out. */
export function parsePack(value: unknown): Pack | undefined {
  if (!isRecord(value)) return undefined;
  const id = packOrder.find((known) => known === value.id);
  const rules = parseAll(value.rules, parseRule);
  return id !== undefined && isText(value.version) && /^[0-9a-f]{12}$/.test(value.version) && rules ? { id, version: value.version, rules } : undefined;
}
