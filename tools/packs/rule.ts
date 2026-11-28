// One rule of a pack's YAML source, checked field by field and turned into the compiled rule the
// worker reads (docs/designs/auto-mode.md, "The source format of a rule"). Examples, near-misses
// and `stdnum` are for the fixture generator and stay out of the compiled rule.
import { builtInMarkTypes } from "../../engine/model/markTypes";
import { evidenceLevels, type EvidenceLevel } from "../../engine/model/findings";
import { identifierPacks } from "../../engine/model/identifiers";
import { isName, isRecord } from "../../engine/model/guards";
import { joinerClass, keyOf } from "../../engine/model/match";
import type { PackId } from "../../engine/model/detection";
import { isCount, labelSides, notNextTos, type LabelSide, type NotNextTo } from "../../engine/detect/recognizer";
import { validators } from "../../engine/detect/validators";

/** A rule as the compiled JSON holds it: the fields of the Technical Plan, section 3, with absent ones left out. */
export interface CompiledRule {
  readonly id: string;
  readonly identifier: string;
  readonly pattern: string;
  readonly valueGroup: number;
  readonly needs: EvidenceLevel;
  readonly notNextTo?: NotNextTo;
  readonly validator?: string;
  readonly labels?: readonly string[];
  readonly labelSide?: LabelSide;
  readonly distance?: number;
  readonly list?: { readonly name: string; readonly group: number };
  readonly companion?: { readonly rule: string; readonly distance: number };
  readonly yieldsTo?: readonly string[];
  readonly source: string;
  readonly licence: string;
  readonly verified: { readonly date: string; readonly at: string };
}

const fields = new Set(["id", "identifier", "pattern", "value", "needs", "labels", "labelSide", "distance", "notNextTo", "validator", "list", "companion", "yieldsTo", "source", "licence", "verified", "examples", "nearMisses", "stdnum"]);

/** "One separator": the matcher's joiners without a line end, so a value never joins across lines. */
const separator = `(?:(?!\\n)${joinerClass})`;

/** The pattern with its named pieces, `{sep}` and `{sep?}`, written out; undefined when it names another piece. */
function expandPieces(pattern: string): string | undefined {
  const expanded = pattern.replaceAll("{sep?}", `${separator}?`).replaceAll("{sep}", separator);
  return /\{[A-Za-z]/.test(expanded) ? undefined : expanded;
}

export const isDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
const isUrl = (value: unknown): value is string => typeof value === "string" && /^https:\/\/\S+$/.test(value);
const absent = (value: unknown) => value === undefined || value === null;

/** An example or a near-miss: a value, or a value with the line it is planted on and whether it is planted only as written. */
function isPlanted(value: unknown): boolean {
  if (isName(value)) return true;
  if (!isRecord(value) || !isName(value.value)) return false;
  const lineFits = absent(value.line) || (isName(value.line) && value.line.includes("{value}"));
  return lineFits && (absent(value.asWritten) || typeof value.asWritten === "boolean");
}

const isPlantedList = (value: unknown): boolean => Array.isArray(value) && value.length > 0 && value.every(isPlanted);

/** The rule's labels, side and distance, all three or none. */
function labelFields(value: Record<string, unknown>, problem: (text: string) => void): Pick<CompiledRule, "labels" | "labelSide" | "distance"> {
  const { labels, labelSide, distance } = value;
  if (absent(labels) && absent(labelSide) && absent(distance)) return {};
  const side = labelSides.find((known) => known === labelSide);
  const words = Array.isArray(labels) && labels.length > 0 && labels.every((label) => isName(label) && keyOf(label) !== "") ? labels.filter(isName) : undefined;
  if (words === undefined) problem("`labels` must be a list of labels, each with a letter or digit");
  if (side === undefined) problem(`\`labelSide\` must be one of ${labelSides.join(", ")}`);
  if (!isCount(distance)) problem("`distance` must be a whole number of characters above 0");
  return words && side && isCount(distance) ? { labels: words, labelSide: side, distance } : {};
}

function listField(value: unknown, problem: (text: string) => void): Pick<CompiledRule, "list"> {
  if (absent(value)) return {};
  if (isRecord(value) && isName(value.name) && isCount(value.group)) return { list: { name: value.name, group: value.group } };
  problem("`list` must be { name, group }: a list's name and the pattern group looked up in it");
  return {};
}

function companionField(value: unknown, problem: (text: string) => void): Pick<CompiledRule, "companion"> {
  if (absent(value)) return {};
  if (isRecord(value) && isName(value.rule) && isCount(value.distance)) return { companion: { rule: value.rule, distance: value.distance } };
  problem("`companion` must be { rule, distance }: another rule's id and a number of characters");
  return {};
}

function optionalFields(value: Record<string, unknown>, problem: (text: string) => void): Partial<CompiledRule> {
  const notNextTo = notNextTos.find((known) => known === value.notNextTo);
  if (!absent(value.notNextTo) && notNextTo === undefined) problem(`\`notNextTo\` must be one of ${notNextTos.join(", ")}`);
  const validator = isName(value.validator) && Object.hasOwn(validators, value.validator) ? value.validator : undefined;
  if (!absent(value.validator) && validator === undefined) problem("`validator` names no validator in engine/detect/validators");
  const yieldsTo = Array.isArray(value.yieldsTo) && value.yieldsTo.every(isName) ? value.yieldsTo.filter(isName) : undefined;
  if (!absent(value.yieldsTo) && yieldsTo === undefined) problem("`yieldsTo` must be a list of rule ids");
  return {
    ...(notNextTo && { notNextTo }),
    ...(validator && { validator }),
    ...labelFields(value, problem),
    ...listField(value.list, problem),
    ...companionField(value.companion, problem),
    ...(yieldsTo && yieldsTo.length > 0 && { yieldsTo }),
  };
}

/** Problems with the evidence a rule says it needs against the evidence it can ever have. */
function needsProblem(needs: EvidenceLevel, rule: Partial<CompiledRule>): string | undefined {
  const canCheck = rule.validator !== undefined || rule.list !== undefined;
  if (needs === "checked" && !canCheck) return "`needs: checked` with neither a validator nor a list can never be met";
  if (needs === "labelled" && !canCheck && rule.labels === undefined && rule.companion === undefined) return "`needs: labelled` with no labels, companion, validator or list can never be met";
  return undefined;
}

/** Its arguments as a tuple, each keeping its own type. */
const tuple = <T extends unknown[]>(...values: T): T => values;

/** Whether every value of a tuple is present. */
const allPresent = <T extends readonly unknown[]>(values: T): values is { [K in keyof T]: Exclude<T[K], undefined> } => values.every((value) => value !== undefined);

function parseVerified(value: unknown): CompiledRule["verified"] | undefined {
  return isRecord(value) && isDate(value.date) && isUrl(value.at) ? { date: value.date, at: value.at } : undefined;
}

/** The identifier, when the schema lists it and it belongs to this pack. */
function identifierOf(value: unknown, pack: PackId, problem: (text: string) => void): string | undefined {
  if (!isName(value) || !builtInMarkTypes.some((type) => type.id === value)) {
    problem("`identifier` is not a type in dataset/ground-truth.schema.json");
    return undefined;
  }
  const owner = identifierPacks[value];
  if (owner !== undefined && owner !== pack) problem(`\`identifier\` belongs to the pack ${owner} (engine/model/identifiers.ts)`);
  return owner === undefined || owner === pack ? value : undefined;
}

/**
 * The compiled rule, or undefined with each problem given to `report`. The pattern is expanded
 * here; whether it compiles, is slow, or can match digits only is checked by the caller.
 */
export function readRule(value: unknown, pack: PackId, report: (text: string) => void): CompiledRule | undefined {
  let failed = false;
  const problem = (text: string) => {
    failed = true;
    report(text);
  };
  /** What `parse` makes of a field that must be there, reporting `text` when it makes nothing. */
  const need = <T>(field: unknown, parse: (field: unknown) => T | undefined, text: string): T | undefined => {
    const parsed = parse(field);
    if (parsed === undefined) problem(text);
    return parsed;
  };
  if (!isRecord(value)) {
    problem("a rule must be a mapping");
    return undefined;
  }
  for (const key of Object.keys(value)) if (!fields.has(key)) problem(`unknown field \`${key}\``);
  const text = (field: unknown) => (isName(field) ? field : undefined);
  const required = tuple(
    need(value.id, text, "`id` is missing"),
    identifierOf(value.identifier, pack, problem),
    need(value.pattern, (field) => (isName(field) ? expandPieces(field) : undefined), "`pattern` is missing or names a piece other than {sep} and {sep?}"),
    need(value.value, (field) => (isCount(field) ? field : undefined), "`value` must be the number of the pattern's group that is the value"),
    need(value.needs, (field) => evidenceLevels.find((level) => level === field), `\`needs\` must be one of ${evidenceLevels.join(", ")}`),
    need(value.source, text, "`source` is missing: where the format and the check come from (goal G2)"),
    need(value.licence, text, "`licence` is missing: the terms of the source"),
    need(value.verified, parseVerified, '`verified` must be { date: "YYYY-MM-DD", at: "https://..." }'),
  );
  need(value.examples, (field) => (isPlantedList(field) ? field : undefined), "`examples` must list at least one value, each a string or { value, line, asWritten }");
  need(value.nearMisses, (field) => (isPlantedList(field) ? field : undefined), "`nearMisses` must list at least one value, each a string or { value, line, asWritten }");
  if (!absent(value.stdnum) && !isName(value.stdnum)) problem("`stdnum` must name a python-stdnum module");
  const optional = optionalFields(value, problem);
  if (!allPresent(required)) return undefined;
  const [id, identifier, pattern, valueGroup, needs, source, licence, verified] = required;
  const needsText = needsProblem(needs, optional);
  if (needsText !== undefined) problem(needsText);
  return failed ? undefined : { id, identifier, pattern, valueGroup, needs, ...optional, source, licence, verified };
}
