// What a run of Auto mode searches with: the packs a profile chooses, and the record a run leaves
// (docs/designs/auto-mode.md, Technical Plan, sections 3 and 6).
import type { DetectionErrorCode } from "./errors";
import type { PageIndex } from "./geometry";

export const countries = ["us", "uk", "in", "ca", "au"] as const;
export type Country = (typeof countries)[number];

export const industries = ["finance", "legal", "medical"] as const;
export type Industry = (typeof industries)[number];

/** Each choice adds one pack; `universal` is in every run. */
export type PackId = "universal" | Country | Industry;

/** Every pack, in the order that breaks a tie between two identifiers with equal evidence for one span. */
export const packOrder: readonly PackId[] = ["universal", ...countries, ...industries];

/** The name the user sees for each pack. */
export const packNames: Readonly<Record<PackId, string>> = {
  universal: "Used everywhere",
  us: "United States",
  uk: "United Kingdom",
  in: "India",
  ca: "Canada",
  au: "Australia",
  finance: "Finance",
  legal: "Legal",
  medical: "Medical",
};

/** The countries and industries a project has chosen. Either may be empty. */
export interface Profile {
  readonly countries: readonly Country[];
  readonly industries: readonly Industry[];
}

/** The packs a run with `profile` loads, in pack order. */
export function profilePacks({ countries: chosenCountries, industries: chosenIndustries }: Profile): PackId[] {
  const chosen = new Set<PackId>(["universal", ...chosenCountries, ...chosenIndustries]);
  return packOrder.filter((pack) => chosen.has(pack));
}

/** What one run did, kept after its findings review ends. It holds no value from the document. */
export interface RunRecord {
  /** The run's id, a UUID made when it starts. */
  readonly run: string;
  readonly ended: "finished" | "stopped" | "failed";
  readonly code?: DetectionErrorCode;
  readonly profile: Profile;
  readonly packs: readonly { readonly id: PackId; readonly version: string }[];
  readonly pages: number;
  readonly notSearched: readonly PageIndex[];
  readonly hitsPerRule: Readonly<Record<string, number>>;
  /** How many values met an error in a check. */
  readonly errors: number;
}
