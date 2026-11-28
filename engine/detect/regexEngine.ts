/** [start, end) in a text view's string. */
export interface Span {
  readonly start: number;
  readonly end: number;
}

/** What the engine needs of a rule: its pattern, and which group of it is the value. */
export interface RegexRule {
  readonly pattern: string;
  readonly valueGroup: number;
}

export interface RegexMatch<R extends RegexRule> {
  readonly rule: R;
  readonly match: Span;
  readonly value: Span;
}

export interface CompiledRules<R extends RegexRule> {
  /** Every match of every rule. One rule's matches come left to right and do not overlap. */
  scan(text: string): RegexMatch<R>[];
}

/** Compiles rules once, to scan many texts. Throws when a pattern does not compile or has no group `valueGroup`. */
export interface RegexEngine {
  compile<R extends RegexRule>(rules: readonly R[]): CompiledRules<R>;
}

const groupCount = (expression: RegExp): number => (new RegExp(`${expression.source}|`, expression.flags).exec("")?.length ?? 1) - 1;

function scanOne<R extends RegexRule>(rule: R, expression: RegExp, text: string, into: RegexMatch<R>[]): void {
  expression.lastIndex = 0;
  for (let found = expression.exec(text); found !== null; found = expression.exec(text)) {
    const start = found.index;
    const end = start + found[0].length;
    // A match of length zero leaves lastIndex where it was; without this step the loop never ends.
    if (end === start) expression.lastIndex = start + ((text.codePointAt(start) ?? 0) > 0xffff ? 2 : 1);
    const value = found.indices?.[rule.valueGroup];
    if (value !== undefined && value[1] > value[0]) into.push({ rule, match: { start, end }, value: { start: value[0], end: value[1] } });
  }
}

/** JavaScript's own `RegExp`: `d` for the groups' positions, `u` for whole characters, `g` to go on from each match. */
export const jsRegexEngine: RegexEngine = {
  compile(rules) {
    const compiled = rules.map((rule) => {
      const expression = new RegExp(rule.pattern, "dgu");
      if (!Number.isInteger(rule.valueGroup) || rule.valueGroup < 1 || rule.valueGroup > groupCount(expression)) {
        throw new Error("A rule names a value group its pattern does not have");
      }
      return { rule, expression };
    });
    return {
      scan(text) {
        const matches: RegexMatch<(typeof rules)[number]>[] = [];
        for (const { rule, expression } of compiled) scanOne(rule, expression, text, matches);
        return matches;
      },
    };
  },
};
