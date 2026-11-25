import { useState } from "react";
import type { EngineError } from "../engine/api/errors";
import type { EngineState } from "../engine/api/state";
import { writerErrorCodes } from "../engine/model/errors";

// Why a Preview was refused, which the app words itself.
const refusals = new Set<string>(writerErrorCodes);

/**
 * What went wrong with the PDF worker: its latest error, or a request's that the worker explained.
 * Opening a document or applying clears it, on Home too. `worker` is undefined until the engine starts.
 */
export function useEngineError(worker: EngineState["worker"] | undefined) {
  const [error, setError] = useState(worker?.error);
  const [seen, setSeen] = useState(worker?.error);
  if (worker?.error !== seen) {
    setSeen(worker?.error);
    if (worker?.error !== undefined) setError(worker.error);
  }
  return {
    error,
    // Only a sentence the worker wrote about the request, or a refusal of the cleaned file, is shown:
    // a stale answer, or one after the worker stopped, has nothing to add to what the status says.
    failed: (failure: EngineError) => {
      if (failure.message !== undefined || refusals.has(failure.code)) setError(failure);
    },
    clear: () => {
      // Once the worker stops, that is all there is to say.
      if (worker?.status !== "stopped") setError(undefined);
    },
  };
}
