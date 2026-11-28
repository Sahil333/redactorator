// What a confirmed findings review marks (docs/designs/auto-mode.md, Technical Plan, section 4):
// each place of a ticked finding gets one mark of its own, built as a hand mark over the same
// range is, so marks may overlap.
import type { Finding } from "./findings";
import { nextId, type Mark } from "./marks";
import { textTarget, type Texts } from "./selection";

/**
 * One mark for each place of each ticked finding, over the finding's span there, typed with its
 * chosen identifier, with ids after `marks`; undefined when one of them can't be built from `texts`.
 */
export function findingMarks(texts: Texts, findings: readonly Finding[], marks: readonly Mark[]): Mark[] | undefined {
  let id = nextId(marks);
  const made: Mark[] = [];
  for (const finding of findings) {
    if (!finding.ticked) continue;
    const type = finding.candidates[finding.chosen]?.identifier;
    if (type === undefined) return undefined;
    for (const place of finding.places) {
      const target = textTarget(texts, [place]);
      if (typeof target === "string") return undefined;
      made.push({ id: id++, type, linkId: "", target, isNew: false });
    }
  }
  return made;
}
