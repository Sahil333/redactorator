import type { Engine } from "../api/facade";
import { createEngine } from "../core/createEngine";
import type { FirstStore } from "../core/library/facade";
import { webLocks } from "./locks";
import { startPdfWorker } from "./workerChannel";

/** The engine for this page: the PDF worker, Web Locks, and the first store the app worked out. */
export const createBrowserEngine = (first: FirstStore): Engine => createEngine({ ...first, worker: startPdfWorker(), lock: webLocks });
