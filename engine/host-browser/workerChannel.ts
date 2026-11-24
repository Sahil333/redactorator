import type { WorkerChannel } from "../core/ports";

/** Starts the PDF worker, a Web Worker running MuPDF, and gives the channel to it. */
export function startPdfWorker(): WorkerChannel {
  const worker = new Worker(new URL("../worker.ts", import.meta.url), { type: "module" });
  return {
    post: (message, transfer = []) => worker.postMessage(message, transfer),
    onMessage: (listener) => worker.addEventListener("message", (event: MessageEvent<unknown>) => listener(event.data)),
    onMessageError: (listener) => worker.addEventListener("messageerror", () => listener()),
    onError: (listener) => worker.addEventListener("error", () => listener()),
    terminate: () => worker.terminate(),
  };
}
