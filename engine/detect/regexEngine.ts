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
  /**
   * What `judge` makes of each match of each rule, leaving out the matches it rejects with
   * undefined, rule by rule in the order given. One rule's kept matches come left to right and
   * do not overlap. After a rejected match the rule is tried again one character later, so a
   * value is not lost because a longer match that took it in was rejected.
   */
  scan<T>(text: string, judge: (match: RegexMatch<R>) => T | undefined): T[];
}

/** Compiles rules once, to scan many texts. Throws when a pattern does not compile or has no group `valueGroup`. */
export interface RegexEngine {
  compile<R extends RegexRule>(rules: readonly R[]): CompiledRules<R>;
}

const groupCount = (expression: RegExp): number => (new RegExp(`${expression.source}|`, expression.flags).exec("")?.length ?? 1) - 1;

function scanOne<R extends RegexRule, T>(rule: R, expression: RegExp, text: string, judge: (match: RegexMatch<R>) => T | undefined, into: T[]): void {
  expression.lastIndex = 0;
  for (let found = expression.exec(text); found !== null; found = expression.exec(text)) {
    const start = found.index;
    const value = found.indices?.[rule.valueGroup];
    const kept = value !== undefined && value[1] > value[0] ? judge({ rule, match: { start, end: start + found[0].length }, value: { start: value[0], end: value[1] } }) : undefined;
    if (kept !== undefined) into.push(kept);
    // A kept match goes on from its end. Anything else, a match of length zero included, which
    // leaves lastIndex where it was and would loop for ever, goes on one character later.
    else expression.lastIndex = start + ((text.codePointAt(start) ?? 0) > 0xffff ? 2 : 1);
  }
}

function compile<R extends RegexRule>(rules: readonly R[]): CompiledRules<R> {
  const compiled = rules.map((rule) => {
    const expression = new RegExp(rule.pattern, "dgu");
    if (!Number.isInteger(rule.valueGroup) || rule.valueGroup < 1 || rule.valueGroup > groupCount(expression)) {
      throw new Error("A rule names a value group its pattern does not have");
    }
    return { rule, expression };
  });
  return {
    scan<T>(text: string, judge: (match: RegexMatch<R>) => T | undefined): T[] {
      const kept: T[] = [];
      for (const { rule, expression } of compiled) scanOne(rule, expression, text, judge, kept);
      return kept;
    },
  };
}

/** JavaScript's own `RegExp`: `d` for the groups' positions, `u` for whole characters, `g` to go on from each match. */
export const jsRegexEngine: RegexEngine = { compile };
