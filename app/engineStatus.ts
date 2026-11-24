import type { EngineState } from "../engine/api/state";

/** What the PDF worker is doing when that is all there is to say, or undefined while it is ready. */
export function engineStatus(worker: EngineState["worker"]): string | undefined {
  if (worker.status === "starting") return "Starting the PDF engine…";
  if (worker.status === "stopped") return "The PDF engine is not running.";
  if (worker.status === "applying") return "Applying and checking…";
  return undefined;
}
