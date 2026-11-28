import { useId } from "react";
import type { Evidence, Finding } from "../engine/model/findings";
import { markTypeLabel } from "../engine/model/markTypes";
import { PageLink } from "./PageLink";
import { pagesList, plural } from "./marks";

/**
 * Why a finding was found, in the design's words. A hit does not carry the name of its label, its
 * list or its companion, which no rule has before slice P0: a list is named by the identifier, and
 * a label and a companion by nothing.
 */
function reasonText({ kind }: Evidence, name: string): string {
  switch (kind) {
    case "checksum":
      return "passed its check";
    case "list":
      return `is a known ${name}`;
    case "label":
      return "next to a label";
    case "companion":
      return "near a related value";
    case "format":
      return `has the format of a ${name}`;
    case "model":
      return "found by a model";
  }
}

/** "1 place, page 1", or "3 places, pages 1 and 4". */
function placesText({ places }: Finding): string {
  const pages = [...new Set(places.map(({ page }) => page + 1))].toSorted((a, b) => a - b);
  return `${plural(places.length, "place")}, ${pagesList(pages)}`;
}

/** One found value: its tick, the exact text that would be removed, its identifier's name, its places and why it was found. */
export function FindingRow({ finding }: { readonly finding: Finding }) {
  const nameId = useId();
  const textId = useId();
  const identifier = finding.candidates[finding.chosen]?.identifier ?? "";
  const name = markTypeLabel(identifier);
  const [first] = finding.places;
  return (
    // Tests read the value, its identifier and its places here, as the pack tests compare them with a truth file.
    <li data-text={finding.text} data-identifier={identifier} data-places={finding.places.length} className="flex items-start gap-2 border-b border-rule px-4 py-2">
      {/* Ticking comes with slice R1. */}
      <input type="checkbox" checked={finding.ticked} readOnly disabled aria-labelledby={`${nameId} ${textId}`} className="mt-1 size-4 shrink-0 accent-accent" />
      <div className="min-w-0 flex-1">
        {first === undefined ? (
          <span id={textId} className="block truncate leading-6">
            {finding.text}
          </span>
        ) : (
          <PageLink id={textId} page={first.page} className="block min-h-6 truncate leading-6 hover:underline">
            {finding.text}
          </PageLink>
        )}
        <p className="text-xs text-ink-muted">
          <span id={nameId}>{name}</span> · {placesText(finding)}
        </p>
        <p className="text-xs text-ink-muted">{finding.reasons.map((reason) => reasonText(reason, name)).join(", ")}</p>
      </div>
    </li>
  );
}
