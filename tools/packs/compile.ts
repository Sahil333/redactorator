// The pack compiler (docs/designs/auto-mode.md, decision D4): reads every pack's YAML source and
// every list, checks them, and writes the compiled JSON and the index the detection worker
// imports. With --check it writes nothing and fails when the committed files differ from what it
// would write. How to add a rule: tools/packs/README.md.
//
// Run: pnpm packs (which builds this file first), or node tools/.build/compile.mjs [--check].
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { packOrder, type PackId } from "../../engine/model/detection";
import { isName, isRecord } from "../../engine/model/guards";
import { parseCompiledList, parsePack } from "../../engine/detect/recognizer";
import { jsRegexEngine } from "../../engine/detect/regexEngine";
import { isDate, readRule, type CompiledRule } from "./rule";
import { canMatchDigitsOnly, checkNegativeControl, slowness } from "./slow";

const packsFolder = "engine/detect/packs";
const sourceFolder = join(packsFolder, "src");
const listFolder = join(packsFolder, "lists");
const outFolder = join(packsFolder, "generated");

const problems: string[] = [];
const problemIn = (where: string) => (text: string) => problems.push(`${where}: ${text}`);

/** A list as the compiled JSON holds it. An empty list is a placeholder and needs no source yet. */
interface CompiledList {
  readonly name: string;
  readonly title?: string;
  readonly source?: string;
  readonly licence?: string;
  readonly read?: string;
  readonly entries: readonly string[];
}

function readYaml(path: string): unknown {
  try {
    return parse(readFileSync(path, "utf8"));
  } catch (error) {
    problemIn(path)(error instanceof Error ? error.message : "not readable as YAML");
    return undefined;
  }
}

const yamlStems = (folder: string): string[] =>
  readdirSync(folder)
    .filter((name) => name.endsWith(".yaml"))
    .map((name) => name.slice(0, -".yaml".length))
    .toSorted();

function readList(name: string): CompiledList | undefined {
  const path = join(listFolder, `${name}.yaml`);
  const problem = problemIn(path);
  const value = readYaml(path);
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    problem("must be a mapping: `name`, `entries`, and for a filled list `title`, `source`, `licence` and `read`");
    return undefined;
  }
  const { title, source, licence, read, entries } = value;
  if (value.name !== name) problem("`name` must be the file's name");
  if (!Array.isArray(entries) || !entries.every(isName)) {
    problem("`entries` must be a list of codes");
    return undefined;
  }
  if (new Set(entries).size !== entries.length) problem("`entries` holds a code twice");
  if (entries.length === 0) return { name, entries };
  const filled = { title, source, licence, read };
  if (!isFilled(filled)) {
    problem("a list with entries needs `title`, `source`, `licence` (what the source's terms say) and `read` (YYYY-MM-DD)");
    return undefined;
  }
  return { name, ...filled, entries };
}

/** Whether a list with entries says what one entry is, where the list was read, its terms, and when. */
const isFilled = (fields: Record<"title" | "source" | "licence" | "read", unknown>): fields is Record<"title" | "source" | "licence" | "read", string> =>
  isName(fields.title) && isName(fields.source) && isName(fields.licence) && isDate(fields.read);

function readPack(id: PackId): CompiledRule[] {
  const path = join(sourceFolder, `${id}.yaml`);
  const value = readYaml(path);
  if (!isRecord(value) || value.pack !== id || !Array.isArray(value.rules)) {
    problemIn(path)(`must be \`pack: ${id}\` and \`rules:\`, a list (empty for a pack with no rules yet)`);
    return [];
  }
  return value.rules.flatMap((rule: unknown, index) => {
    const where = isRecord(rule) && isName(rule.id) ? `${path}, rule ${rule.id}` : `${path}, rule ${index + 1}`;
    return readRule(rule, id, problemIn(where)) ?? [];
  });
}

/** Problems with a rule's pattern: it does not compile in the worker's engine, is slow, or matches digits only with `needs: format`. */
function patternProblems(rule: CompiledRule): string[] {
  try {
    jsRegexEngine.compile([{ pattern: rule.pattern, valueGroup: rule.valueGroup, ...(rule.list && { listGroup: rule.list.group }) }]);
    const slow = slowness(rule.pattern);
    return [
      ...(slow === undefined ? [] : [`the pattern is slow: ${slow}`]),
      ...(rule.needs === "format" && canMatchDigitsOnly(rule.pattern) ? ["`needs: format` is refused for a pattern that can match digits only"] : []),
    ];
  } catch (error) {
    return [`the pattern does not compile, or lacks a group it names: ${error instanceof Error ? error.message : "unknown error"}`];
  }
}

/** Problems with what a rule names: its list, its companion and the rules it gives way to. */
function referenceProblems(rule: CompiledRule, packRules: readonly CompiledRule[], rules: ReadonlyMap<string, CompiledRule>, lists: ReadonlyMap<string, CompiledList>): string[] {
  const problems: string[] = [];
  if (rule.list !== undefined && (lists.get(rule.list.name)?.entries.length ?? 0) === 0) problems.push(`\`list\` names ${rule.list.name}, which is not a list with entries in ${listFolder}`);
  // The pack's browser test loads that pack alone, so a companion in another pack could never be shown to work.
  const companion = rule.companion && packRules.find(({ id }) => id === rule.companion?.rule);
  const companionFits = companion !== undefined && companion.companion === undefined && companion.id !== rule.id;
  if (rule.companion !== undefined && !companionFits) problems.push("`companion` must name another rule of the same pack that has no companion of its own");
  for (const other of rule.yieldsTo ?? []) if (other === rule.id || !rules.has(other)) problems.push(`\`yieldsTo\` names ${other}, which is not another rule`);
  return problems;
}

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/**
 * A pack's version: the first 12 hex digits of the SHA-256 of the UTF-8 bytes of
 * `JSON.stringify({ rules, lists })`, with no spaces, where `lists` are the compiled lists its rules
 * name, in the order they are first named. A change to a rule or to a list it uses changes it.
 */
function versionOf(rules: readonly CompiledRule[], lists: ReadonlyMap<string, CompiledList>): string {
  const named = [...new Set(rules.flatMap(({ list }) => (list === undefined ? [] : [list.name])))].map((name) => lists.get(name));
  return createHash("sha256").update(JSON.stringify({ rules, lists: named }), "utf8").digest("hex").slice(0, 12);
}

const importName = (name: string): string => name.replace(/-(\w)/g, (_, letter: string) => letter.toUpperCase());

function indexFile(listNames: readonly string[]): string {
  const packImport = (id: PackId) => (id === "in" ? "inPack" : id);
  const lines = [
    "// Written by tools/packs/compile.ts from engine/detect/packs/src and lists: run `pnpm packs`, never edit by hand.",
    'import type { PackId } from "../../../model/detection";',
    ...packOrder.toSorted().map((id) => `import ${packImport(id)} from "./${id}.json";`),
    ...listNames.map((name) => `import ${importName(name)} from "./lists/${name}.json";`),
    "",
    "/** Every compiled pack, by id. */",
    `export const compiledPacks: Readonly<Record<PackId, unknown>> = { ${packOrder.map((id) => (id === "in" ? "in: inPack" : id)).join(", ")} };`,
    "",
    "/** Every compiled list, by name. */",
    `export const compiledLists: Readonly<Record<string, unknown>> = { ${listNames.map((name) => `"${name}": ${importName(name)}`).join(", ")} };`,
  ];
  return `${lines.join("\n")}\n`;
}

function readLists(): Map<string, CompiledList> {
  const lists = new Map<string, CompiledList>();
  for (const name of yamlStems(listFolder)) {
    const list = readList(name);
    if (list !== undefined) lists.set(name, list);
  }
  return lists;
}

/** Every pack's compiled rules, with each problem across packs reported: an unknown file, a rule id used twice, a pattern, a reference. */
function readPacks(lists: ReadonlyMap<string, CompiledList>): { readonly id: PackId; readonly rules: CompiledRule[] }[] {
  for (const stem of yamlStems(sourceFolder)) if (!packOrder.some((id) => id === stem)) problemIn(join(sourceFolder, `${stem}.yaml`))(`is not a pack: the packs are ${packOrder.join(", ")}`);
  const packs = packOrder.map((id) => ({ id, rules: readPack(id) }));
  const rules = new Map<string, CompiledRule>();
  for (const rule of packs.flatMap((pack) => pack.rules)) {
    if (rules.has(rule.id)) problems.push(`${sourceFolder}: the rule id ${rule.id} is used twice`);
    rules.set(rule.id, rule);
  }
  for (const { id, rules: packRules } of packs) {
    for (const rule of packRules) for (const text of [...patternProblems(rule), ...referenceProblems(rule, packRules, rules, lists)]) problemIn(`${join(sourceFolder, `${id}.yaml`)}, rule ${rule.id}`)(text);
  }
  return packs;
}

/** Every file the compiler writes, by its path. Each is read back with the worker's own parser. */
function compiledFiles(): Map<string, string> {
  const lists = readLists();
  const files = new Map<string, string>();
  for (const { id, rules } of readPacks(lists)) {
    const text = json({ id, version: versionOf(rules, lists), rules });
    if (parsePack(JSON.parse(text)) === undefined) problemIn(join(outFolder, `${id}.json`))("the worker could not read this pack; the compiler and engine/detect/recognizer.ts disagree");
    files.set(join(outFolder, `${id}.json`), text);
  }
  for (const [name, list] of lists) {
    const text = json(list);
    if (list.entries.length > 0 && parseCompiledList(JSON.parse(text)) === undefined) problemIn(join(outFolder, "lists", `${name}.json`))("the worker could not read this list");
    files.set(join(outFolder, "lists", `${name}.json`), text);
  }
  files.set(join(outFolder, "index.ts"), indexFile(yamlStems(listFolder)));
  return files;
}

function filesIn(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? filesIn(join(folder, entry.name)) : [join(folder, entry.name)]));
}

function committed(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

/** For --check: each committed file that differs from what the compiler writes, or that it does not write. */
function reportDifferences(files: ReadonlyMap<string, string>, stale: readonly string[]): void {
  for (const [path, text] of files) if (committed(path) !== text) problemIn(path)("differs from what the compiler writes: run `pnpm packs` and commit the result");
  for (const path of stale) problemIn(path)("is not written by the compiler: run `pnpm packs`, which removes it");
}

function main(): void {
  const check = process.argv.includes("--check");
  checkNegativeControl();
  const files = compiledFiles();
  const stale = filesIn(outFolder).filter((path) => !files.has(path));
  if (check) reportDifferences(files, stale);
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    process.exit(1);
  }
  if (check) return;
  for (const path of stale) rmSync(path);
  for (const [path, text] of files) {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, text);
  }
  console.log(`wrote ${files.size} files in ${outFolder}`);
}

main();
