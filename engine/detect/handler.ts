import type { RunNumber } from "../detect-protocol/messages";
import { parseDetectRequest } from "../detect-protocol/parse";
import type { PackId } from "../model/detection";
import { loadPacks } from "./loadPacks";
import { post } from "./messages";
import { patternRecognizer } from "./patternRecognizer";
import type { Recognizer } from "./recognizer";
import { jsRegexEngine } from "./regexEngine";
import { validators } from "./validators";

let loaded: { readonly run: RunNumber; readonly recognizer: Recognizer } | undefined;

/** A recognizer with the packs loaded, or undefined when a pack or list is missing, damaged or does not compile. */
function recognizerOf(found: ReturnType<typeof loadPacks>): Recognizer | undefined {
  if (found === undefined) return undefined;
  const recognizer = patternRecognizer(jsRegexEngine, validators);
  try {
    recognizer.load(found.packs, found.lists);
  } catch {
    return undefined;
  }
  return recognizer;
}

function load(run: RunNumber, ids: readonly PackId[]): void {
  const packs = loadPacks(ids);
  const recognizer = recognizerOf(packs);
  loaded = recognizer && { run, recognizer };
  post(
    packs === undefined || recognizer === undefined
      ? { type: "failed", run, code: "recognizer-failed" }
      : { type: "ready", run, packs: packs.packs.map(({ id, version }) => ({ id, version })) },
  );
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
