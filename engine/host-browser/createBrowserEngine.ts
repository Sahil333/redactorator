import type { Engine } from "../api/facade";
import { createEngine } from "../core/createEngine";
import type { FirstStore } from "../core/library/facade";
import { interimOf, type Interim } from "./interim";
import { webLocks } from "./locks";
import { startPdfWorker } from "./workerChannel";

/** The engine for this page: the PDF worker, Web Locks, and the first store the app worked out. */
export function createBrowserEngine(first: FirstStore): { readonly engine: Engine; readonly interim: Interim } {
  const { engine, interim } = createEngine({ ...first, worker: startPdfWorker(), lock: webLocks });
  return { engine, interim: interimOf(interim) };
}
