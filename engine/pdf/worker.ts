// The Web Worker entry: the only file in engine/pdf that knows it runs in a worker.
import { READER_TAG } from "../pdf-protocol/messages";
import { handle } from "./handler";
import { post, setSend } from "./messages";

setSend((message, transfer) => postMessage(message, transfer ?? []));
addEventListener("message", (event: MessageEvent<unknown>) => handle(event.data));
post({ type: "ready", readerTag: READER_TAG });
