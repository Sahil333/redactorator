import type { FileNumber, PdfError, PdfReply } from "../pdf-protocol/messages";

type Send = (message: PdfReply, transfer?: ArrayBuffer[]) => void;

let send: Send;

/** Sets how replies leave the handler; the worker entry passes the Web Worker's own postMessage. */
export function setSend(fn: Send): void {
  send = fn;
}

export function post(message: PdfReply, transfer?: ArrayBuffer[]): void {
  send(message, transfer);
}

export function fail(file: FileNumber, code: PdfError["code"], message: string): void {
  post({ type: "error", file, error: { code, message } });
}
