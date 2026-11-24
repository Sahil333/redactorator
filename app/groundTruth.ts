// Builds a ground-truth file (dataset/ground-truth.schema.json, version 1) from the marks
// on one PDF. Labelling mode downloads it; nothing here leaves the browser.
import type { Box, PageIndex } from "../engine/model/geometry";
import type { Mark } from "../engine/model/marks";
import type { MarkType } from "../engine/model/markTypes";
import schema from "../dataset/ground-truth.schema.json";

interface Choice {
  readonly id: string;
  readonly label: string;
}

const { country, format, split } = schema.properties.document.properties;
const choices = (options: readonly { readonly const: string; readonly title: string }[]): readonly Choice[] =>
  options.map((option) => ({ id: option.const, label: option.title }));

// The schema's own lists, so a file the app writes always passes it.
export const countries: readonly string[] = country.enum;
export const formats = choices(format.oneOf);
export const splits = choices(split.oneOf);

/** What the labeller says about the document. */
export interface DocumentFacts {
  readonly source: string;
  readonly licence: string;
  readonly country: string;
  readonly format: string;
  readonly split: string;
}

interface Entity {
  readonly id: string;
  readonly type: MarkType;
  readonly value?: string;
  readonly link_id?: string;
}

interface Occurrence {
  readonly entity_id: string;
  readonly page: PageIndex;
  readonly start?: number;
  readonly end?: number;
  readonly boxes: readonly Box[];
}

/**
 * One entity per spelling: text marks with the same type, text and link id share one,
 * and each box mark is its own (it has no text to match on). A mark across pages is one
 * entity with an occurrence on each page.
 */
export function groundTruth(marks: readonly Mark[], facts: DocumentFacts, sha256: string) {
  const entities: Entity[] = [];
  const bySpelling = new Map<string, string>();
  const occurrences: Occurrence[] = marks.flatMap((mark): Occurrence[] => {
    const link = mark.linkId.trim();
    const linkId = link === "" ? {} : { link_id: link };
    if (mark.target.kind === "box") {
      const id = `e${entities.length + 1}`;
      entities.push({ id, type: mark.type, ...linkId });
      return [{ entity_id: id, page: mark.target.page, boxes: [mark.target.box] }];
    }
    const spelling = JSON.stringify([mark.type, mark.target.text, link]);
    let id = bySpelling.get(spelling);
    if (id === undefined) {
      id = `e${entities.length + 1}`;
      bySpelling.set(spelling, id);
      entities.push({ id, type: mark.type, value: mark.target.text, ...linkId });
    }
    const entity = id;
    return mark.target.pieces.map(({ page, start, end, boxes }) => ({ entity_id: entity, page, start, end, boxes }));
  });
  return {
    schema_version: 1,
    document: { ...facts, sha256, box_unit: "pt" },
    entities,
    occurrences,
    hidden_occurrences: [],
  };
}
