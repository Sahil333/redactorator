// What Auto mode finds in a document and offers the user: hits, the evidence for each, and the
// findings the resolver makes of them (docs/designs/auto-mode.md, Technical Plan, section 3).
import type { PageIndex } from "./geometry";
import type { MarkType } from "./markTypes";

/** `checked` is the strongest, `format` the weakest. */
export const evidenceLevels = ["checked", "labelled", "format"] as const;
export type EvidenceLevel = (typeof evidenceLevels)[number];

/** The kinds of evidence that carry nothing but their level. */
export const plainEvidenceKinds = ["checksum", "format", "model"] as const;

/**
 * Why a value was found. A label, a list and a companion carry the rule's own words, so the panel
 * can name them; never text read from the page.
 */
export type Evidence =
  | { readonly kind: (typeof plainEvidenceKinds)[number]; readonly level: EvidenceLevel }
  /** `label`: the rule's label that matched, as the pack writes it. */
  | { readonly kind: "label"; readonly level: EvidenceLevel; readonly label: string }
  /** `list`: the list's name for the user, such as "Indian bank code". */
  | { readonly kind: "list"; readonly level: EvidenceLevel; readonly list: string }
  /** `companion`: the identifier of the value found beside this one. */
  | { readonly kind: "companion"; readonly level: EvidenceLevel; readonly companion: MarkType };

/** One match by one recognizer: `start` and `end` index the page's `chars` for the value only, and `text` is what `rangeText` reads there. */
export interface Hit {
  readonly page: PageIndex;
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly identifier: MarkType;
  readonly evidence: readonly Evidence[];
  readonly rule: string;
  readonly recognizer: string;
}

export interface FindingPlace {
  readonly page: PageIndex;
  readonly start: number;
  readonly end: number;
}

/** One identifier for a finding's span. */
export interface Candidate {
  readonly identifier: MarkType;
  readonly level: EvidenceLevel;
  readonly reasons: readonly Evidence[];
}

/** One value in one document, with all its places: what the user ticks or unticks. Made by the resolver, never stored. */
export interface Finding {
  readonly key: string;
  /** As written at the first place. */
  readonly text: string;
  readonly places: readonly FindingPlace[];
  readonly candidates: readonly Candidate[];
  /** The index of the chosen candidate. */
  readonly chosen: number;
  /** The normalised text of the span the user moved the edges to. */
  readonly edge?: string;
  /** The chosen candidate's. */
  readonly level: EvidenceLevel;
  readonly reasons: readonly Evidence[];
  readonly ticked: boolean;
}

/** What the user changed in an open findings review, by finding key. */
export interface FindingChange {
  readonly ticked?: boolean;
  readonly candidate?: MarkType;
  readonly edge?: string;
}
