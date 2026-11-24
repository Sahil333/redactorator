import { useState } from "react";
import type { EngineError } from "../engine/api/errors";
import type { EngineState } from "../engine/api/state";

/**
 * What went wrong with the open document: the PDF worker's latest error, or a request's that the
 * worker explained. Opening a document or applying clears it.
 */
export function useEngineError(worker: EngineState["worker"]) {
  const [error, setError] = useState(worker.error);
  const [seen, setSeen] = useState(worker.error);
  if (worker.error !== seen) {
    setSeen(worker.error);
    if (worker.error !== undefined) setError(worker.error);
  }
  return {
    error,
    // Only a sentence the worker wrote about the request is shown: a stale answer, or one after the
    // worker stopped, has nothing to add to what the status already says.
    failed: (failure: EngineError) => {
      if (failure.message !== undefined) setError(failure);
    },
    clear: () => {
      // Once the worker stops, that is all there is to say.
      if (worker.status !== "stopped") setError(undefined);
    },
  };
}
