// What scslre's analysis of a pattern tells the pack compiler: whether the pattern has a slow
// shape (docs/designs/auto-mode.md, C0 results, item 3), and whether it can match digits only.
// scslre analyses a pattern without running it; one it cannot parse makes it throw, which fails
// the build.
import { analyse } from "scslre";

type Pattern = ReturnType<typeof analyse>["parsed"]["pattern"];
type Element = Pattern["alternatives"][number]["elements"][number];

/** A pattern whose running time grows exponentially; the check must call it slow, or the check itself is broken. */
const knownSlow = "(a+)+$";

/** Why `pattern` is slow, or undefined when scslre finds no slow shape in it. */
export function slowness(pattern: string): string | undefined {
  const [report] = analyse({ source: pattern, flags: "u" }).reports;
  if (report === undefined) return undefined;
  return `${report.exponential ? "exponential" : "polynomial"} backtracking (${report.type}) on repeated ${JSON.stringify(report.character.pick)}`;
}

/** Throws unless the check calls the known slow pattern slow. */
export function checkNegativeControl(): void {
  if (slowness(knownSlow) === undefined) throw new Error(`The slow-pattern check does not call ${knownSlow} slow`);
}

/** What a number is written with: digits and the separators a rule may put between them. */
const numberCharacters = [..."0123456789 -. ‐–−"];

/** Whether `element` can match a string of number characters only. Assertions are passed over, so the answer errs towards yes. */
function canBeNumber(element: Element): boolean {
  switch (element.type) {
    case "Quantifier":
      return element.min === 0 || canBeNumber(element.element);
    case "Group":
    case "CapturingGroup":
      return element.alternatives.some(({ elements }) => elements.every(canBeNumber));
    case "Assertion":
    case "Backreference":
      return true;
    default: {
      const one = new RegExp(`^(?:${element.raw})$`, "u");
      return numberCharacters.some((c) => one.test(c));
    }
  }
}

/** Whether `pattern` can match a value made of digits and separators only, such as an account number. */
export function canMatchDigitsOnly(pattern: string): boolean {
  return analyse({ source: pattern, flags: "u" }).parsed.pattern.alternatives.some(({ elements }) => elements.every(canBeNumber));
}
