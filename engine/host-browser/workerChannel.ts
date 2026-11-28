import type { WorkerChannel } from "../core/ports";

/** The channel to a worker the host started. */
function channelOf(worker: Worker): WorkerChannel {
  return {
    post: (message, transfer = []) => worker.postMessage(message, transfer),
    onMessage: (listener) => worker.addEventListener("message", (event: MessageEvent<unknown>) => listener(event.data)),
    onMessageError: (listener) => worker.addEventListener("messageerror", () => listener()),
    onError: (listener) => worker.addEventListener("error", () => listener()),
    terminate: () => worker.terminate(),
  };
}

/** Starts the PDF worker, a Web Worker running MuPDF, and gives the channel to it. */
export function startPdfWorker(): WorkerChannel {
  // fallow-ignore-next-line boundary-violation
  return channelOf(new Worker(new URL("../pdf/worker.ts", import.meta.url), { type: "module" }));
}

/** Starts a detection worker, a Web Worker running Auto mode's recognizers, and gives the channel to it. */
export function startDetectionWorker(): WorkerChannel {
  // fallow-ignore-next-line boundary-violation
  return channelOf(new Worker(new URL("../detect/detectWorker.ts", import.meta.url), { type: "module" }));
}
