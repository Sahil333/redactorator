// The recognizer of this phase: a pack's rules as regular expressions over the page as written,
// each match checked for its neighbours and by its validator.
import type { PageChar, PageText } from "../model/document";
import type { Evidence, EvidenceLevel, Hit } from "../model/findings";
import { pointBox, type PageIndex } from "../model/geometry";
import { rangeText } from "../model/pageText";
import { charRange, textView } from "../model/textView";
import type { NotNextTo, Recognizer, Rule } from "./recognizer";
import type { CompiledRules, RegexEngine, Span } from "./regexEngine";
import type { Validator } from "./validators";

const neighbours: Readonly<Record<NotNextTo, RegExp>> = {
  letter: /^\p{L}$/u,
  digit: /^\p{Nd}$/u,
  "letter-or-digit": /^[\p{L}\p{Nd}]$/u,
};

const strength: Readonly<Record<EvidenceLevel, number>> = { checked: 3, labelled: 2, format: 1 };

const checksum: Evidence = { kind: "checksum", level: "checked" };
const format: Evidence = { kind: "format", level: "format" };

/**
 * The page's characters as a page text, for `rangeText`, so a hit's text is read as a mark's is.
 * The page message carries no boxes, and `rangeText` reads a box only to tell a line end, which
 * has none, from the rest, so each other character gets an empty one.
 */
function pageTextOf(chars: readonly string[]): PageText {
  const box = pointBox(0, 0, 0, 0);
  if (box === undefined) throw new Error("An empty box could not be made");
  return { chars: chars.map((c): PageChar => (c === "\n" ? { c, box: undefined } : { c, box })) };
}

/** Whether the whole character before the value, or the one after it, is what the rule may not sit next to. */
function isNextTo(text: string, { start, end }: Span, notNextTo: NotNextTo): boolean {
  const before = [...text.slice(Math.max(0, start - 2), start)].at(-1);
  const after = [...text.slice(end, end + 2)][0];
  return [before, after].some((c) => c !== undefined && neighbours[notNextTo].test(c));
}

/** A rule ready to scan with, its validator looked up. */
interface Loaded {
  readonly rule: Rule;
  readonly pattern: string;
  readonly valueGroup: number;
  readonly validator?: Validator;
}

function loaded(rule: Rule, validators: Readonly<Record<string, Validator>>): Loaded {
  const { pattern, valueGroup } = rule;
  if (rule.validator === undefined) return { rule, pattern, valueGroup };
  const validator = validators[rule.validator];
  if (validator === undefined) throw new Error("A rule names a validator that does not exist");
  return { rule, pattern, valueGroup, validator };
}

/** The value's evidence, or "error" when its validator failed with one. A validator sees the value's letters and digits only. */
function evidenceOf({ validator }: Loaded, value: string): Evidence | "error" {
  if (validator === undefined) return format;
  try {
    return validator(value.replace(/[^\p{L}\p{N}]/gu, "")) ? checksum : format;
  } catch {
    // A fault in one check costs that value only (docs/designs/auto-mode.md, section 8).
    return "error";
  }
}

/** Runs the loaded packs' rules through `engine`, each checked by the validator it names in `validators`. */
export function patternRecognizer(engine: RegexEngine, validators: Readonly<Record<string, Validator>>): Recognizer {
  let compiled: CompiledRules<Loaded> | undefined;

  return {
    load(packs) {
      compiled = engine.compile(packs.flatMap(({ rules }) => rules.map((rule) => loaded(rule, validators))));
    },
    detect(page: PageIndex, chars: readonly string[]) {
      if (compiled === undefined) throw new Error("No packs are loaded");
      const view = textView(chars);
      const text = pageTextOf(chars);
      const hits: Hit[] = [];
      let errors = 0;
      for (const { rule: entry, value } of compiled.scan(view.text)) {
        const { rule } = entry;
        const range = charRange(view, value.start, value.end);
        if (range === undefined || (rule.notNextTo !== undefined && isNextTo(view.text, value, rule.notNextTo))) continue;
        const evidence = evidenceOf(entry, view.text.slice(value.start, value.end));
        if (evidence === "error") errors++;
        else if (strength[evidence.level] >= strength[rule.needs]) {
          hits.push({ page, ...range, text: rangeText(text, range.start, range.end), identifier: rule.identifier, evidence: [evidence], rule: rule.id, recognizer: "pattern" });
        }
      }
      return { hits, errors };
    },
  };
}
