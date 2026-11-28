// The Web Worker entry: the only file in engine/detect that knows it runs in a worker.
import { handle } from "./handler";
import { setSend } from "./messages";

setSend((message) => postMessage(message));
addEventListener("message", (event: MessageEvent<unknown>) => handle(event.data));
