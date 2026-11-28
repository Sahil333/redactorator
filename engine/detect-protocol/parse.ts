import { packOrder, type PackId } from "../model/detection";
import type { Evidence, EvidenceKind, EvidenceLevel, Hit } from "../model/findings";
import { isPageIndex } from "../model/geometry";
import { isOffset, isRecord, isText, parseAll } from "../model/guards";
import { isRunNumber, type DetectReply, type DetectRequest, type LoadedPack } from "./messages";

const evidenceKinds: readonly EvidenceKind[] = ["checksum", "list", "label", "companion", "format", "model"];
const evidenceLevels: readonly EvidenceLevel[] = ["checked", "labelled", "format"];

const packIdOf = (value: unknown): PackId | undefined => packOrder.find((id) => id === value);

const isChars = (value: unknown): value is readonly string[] => Array.isArray(value) && value.every(isText);

export function parseDetectRequest(data: unknown): DetectRequest | undefined {
  if (!isRecord(data) || !isRunNumber(data.run)) return undefined;
  const { run } = data;
  switch (data.type) {
    case "load": {
      const packs = parseAll(data.packs, packIdOf);
      return packs && { type: "load", run, packs };
    }
    case "page":
      return isPageIndex(data.page) && isChars(data.chars) ? { type: "page", run, page: data.page, chars: data.chars } : undefined;
    default:
      return undefined;
  }
}

function parseEvidence(value: unknown): Evidence | undefined {
  if (!isRecord(value)) return undefined;
  const kind = evidenceKinds.find((known) => known === value.kind);
  const level = evidenceLevels.find((known) => known === value.level);
  if (kind === undefined || level === undefined || (value.label !== undefined && !isOffset(value.label))) return undefined;
  return { kind, level, ...(value.label === undefined ? {} : { label: value.label }) };
}

const isName = (value: unknown): value is string => isText(value) && value !== "";

function parseHit(value: unknown): Hit | undefined {
  if (!isRecord(value)) return undefined;
  const { page, start, end, text, identifier, rule, recognizer } = value;
  const evidence = parseAll(value.evidence, parseEvidence);
  return isPageIndex(page) && isOffset(start) && isOffset(end) && start < end && isText(text) && isName(identifier) && evidence && isName(rule) && isName(recognizer)
    ? { page, start, end, text, identifier, evidence, rule, recognizer }
    : undefined;
}

function parseLoadedPack(value: unknown): LoadedPack | undefined {
  if (!isRecord(value)) return undefined;
  const id = packIdOf(value.id);
  return id !== undefined && isText(value.version) && /^[0-9a-f]{12}$/.test(value.version) ? { id, version: value.version } : undefined;
}

export function parseDetectReply(data: unknown): DetectReply | undefined {
  if (!isRecord(data) || !isRunNumber(data.run)) return undefined;
  const { run } = data;
  switch (data.type) {
    case "ready": {
      const packs = parseAll(data.packs, parseLoadedPack);
      return packs && { type: "ready", run, packs };
    }
    case "hits": {
      const hits = parseAll(data.hits, parseHit);
      return hits && isPageIndex(data.page) && isOffset(data.errors) ? { type: "hits", run, page: data.page, hits, errors: data.errors } : undefined;
    }
    case "failed":
      return data.code === "recognizer-failed" ? { type: "failed", run, code: data.code } : undefined;
    default:
      return undefined;
  }
}
