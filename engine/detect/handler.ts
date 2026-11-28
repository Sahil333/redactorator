import type { RunNumber } from "../detect-protocol/messages";
import { parseDetectRequest } from "../detect-protocol/parse";
import type { PackId } from "../model/detection";
import { post } from "./messages";
import { compiledPacks } from "./packs/generated";
import { patternRecognizer } from "./patternRecognizer";
import { parsePack, type Pack, type Recognizer } from "./recognizer";
import { jsRegexEngine } from "./regexEngine";
import { validators } from "./validators";

let loaded: { readonly run: RunNumber; readonly recognizer: Recognizer } | undefined;

function packsOf(ids: readonly PackId[]): Pack[] | undefined {
  const packs = ids.map((id) => parsePack(compiledPacks[id]));
  return packs.every((pack) => pack !== undefined) ? packs : undefined;
}

function load(run: RunNumber, ids: readonly PackId[]): void {
  loaded = undefined;
  const packs = packsOf(ids);
  const recognizer = patternRecognizer(jsRegexEngine, validators);
  try {
    if (packs === undefined) throw new Error("A pack is missing or damaged");
    recognizer.load(packs);
  } catch {
    post({ type: "failed", run, code: "recognizer-failed" });
    return;
  }
  loaded = { run, recognizer };
  post({ type: "ready", run, packs: packs.map(({ id, version }) => ({ id, version })) });
}

/**
 * Answers one message from the core. A message it cannot read, or a page of a run whose packs
 * are not loaded, is a fault: it throws, and the core sees the worker fail.
 */
export function handle(data: unknown): void {
  const request = parseDetectRequest(data);
  if (request === undefined) throw new Error("The detection worker could not read a message");
  if (request.type === "load") {
    load(request.run, request.packs);
    return;
  }
  if (loaded?.run !== request.run) throw new Error("A page came for a run whose packs are not loaded");
  const { hits, errors } = loaded.recognizer.detect(request.page, request.chars);
  post({ type: "hits", run: request.run, page: request.page, hits, errors });
}
