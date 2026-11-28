// The stored formats of a document's findings review and of its last run, kept in the reader
// folder (docs/designs/auto-mode.md, Technical Plan, section 5). Each carries its own format name
// and version, and is checked whole when read.
import { packOrder, runEndings, type RunRecord } from "../../model/detection";
import { detectionErrorCodes } from "../../model/errors";
import { droppedReasons, type DroppedReason, type FindingChange, type Hit } from "../../model/findings";
import { isPageIndex, type PageIndex } from "../../model/geometry";
import { isName, isOffset, isRecord, isText, parseAll } from "../../model/guards";
import { parseHit } from "../../detect-protocol/parse";
import { oneOf, parseProfile, versioned } from "./project";

const HITS_FORMAT = "redactorator-hits";
const STATE_FORMAT = "redactorator-findings-state";
const RUN_FORMAT = "redactorator-run";
const HITS_VERSION = 1;
const STATE_VERSION = 1;
const RUN_VERSION = 1;

/** A run's hits, which never change: the run's id, the pages it did not search, and every hit. They hold the found values' text. */
export interface StoredHits {
  readonly run: string;
  readonly notSearched: readonly PageIndex[];
  readonly hits: readonly Hit[];
}

/**
 * A findings review's state: open on the run `run`, with the user's changes by finding key; or
 * dropped, with the notice that says why.
 */
export type FindingsState =
  | { readonly kind: "open"; readonly run: string; readonly changes: ReadonlyMap<string, FindingChange> }
  | { readonly kind: "dropped"; readonly reason: DroppedReason };

const parsePages = (value: unknown) => parseAll(value, (each) => (isPageIndex(each) ? each : undefined));

export const hitsJson = (stored: StoredHits): string => JSON.stringify({ format: HITS_FORMAT, version: HITS_VERSION, ...stored });

export function parseHits(text: string): StoredHits | undefined {
  const stored = versioned(text, HITS_FORMAT, HITS_VERSION);
  if (typeof stored === "string") return undefined;
  const { run } = stored.data;
  const notSearched = parsePages(stored.data.notSearched);
  const hits = parseAll(stored.data.hits, parseHit);
  return isName(run) && notSearched && hits ? { run, notSearched, hits } : undefined;
}

export const stateJson = (state: FindingsState): string =>
  JSON.stringify({ format: STATE_FORMAT, version: STATE_VERSION, ...state, ...(state.kind === "open" && { changes: Object.fromEntries(state.changes) }) });

function parseChange(value: unknown): FindingChange | undefined {
  if (!isRecord(value)) return undefined;
  const { ticked, candidate, edge } = value;
  if ((ticked !== undefined && typeof ticked !== "boolean") || (candidate !== undefined && !isName(candidate)) || (edge !== undefined && !isText(edge))) return undefined;
  return { ...(ticked !== undefined && { ticked }), ...(candidate !== undefined && { candidate }), ...(edge !== undefined && { edge }) };
}

function parseChanges(value: unknown): ReadonlyMap<string, FindingChange> | undefined {
  if (!isRecord(value)) return undefined;
  const changes = new Map<string, FindingChange>();
  for (const [key, each] of Object.entries(value)) {
    const change = parseChange(each);
    if (change === undefined) return undefined;
    changes.set(key, change);
  }
  return changes;
}

export function parseState(text: string): FindingsState | undefined {
  const stored = versioned(text, STATE_FORMAT, STATE_VERSION);
  if (typeof stored === "string") return undefined;
  const { kind, run } = stored.data;
  if (kind === "dropped") {
    const reason = oneOf(droppedReasons, stored.data.reason);
    return reason && { kind, reason };
  }
  const changes = parseChanges(stored.data.changes);
  return kind === "open" && isName(run) && changes ? { kind, run, changes } : undefined;
}

export const runJson = (record: RunRecord): string => JSON.stringify({ format: RUN_FORMAT, version: RUN_VERSION, ...record });

function parsePack(value: unknown): RunRecord["packs"][number] | undefined {
  if (!isRecord(value)) return undefined;
  const id = oneOf(packOrder, value.id);
  return id !== undefined && isText(value.version) ? { id, version: value.version } : undefined;
}

function parseCounts(value: unknown): RunRecord["hitsPerRule"] | undefined {
  if (!isRecord(value)) return undefined;
  const counts: Record<string, number> = {};
  for (const [rule, count] of Object.entries(value)) {
    if (!isOffset(count)) return undefined;
    counts[rule] = count;
  }
  return counts;
}

export function parseRun(text: string): RunRecord | undefined {
  const stored = versioned(text, RUN_FORMAT, RUN_VERSION);
  if (typeof stored === "string") return undefined;
  const { data } = stored;
  const { run, pages, errors } = data;
  const ended = oneOf(runEndings, data.ended);
  const code = data.code === undefined ? undefined : oneOf(detectionErrorCodes, data.code);
  const profile = parseProfile(data.profile);
  const packs = parseAll(data.packs, parsePack);
  const notSearched = parsePages(data.notSearched);
  const hitsPerRule = parseCounts(data.hitsPerRule);
  if (!isName(run) || !ended || (data.code !== undefined && !code) || !profile || !packs || !isOffset(pages) || !notSearched || !hitsPerRule || !isOffset(errors)) return undefined;
  return { run, ended, ...(code !== undefined && { code }), profile, packs, pages, notSearched, hitsPerRule, errors };
}
