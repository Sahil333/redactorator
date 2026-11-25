import type { FileNumber, PdfError, PdfErrorData, PdfReply } from "../pdf-protocol/messages";

type Send = (message: PdfReply, transfer?: ArrayBuffer[]) => void;

let send: Send;

export function setSend(fn: Send): void {
  send = fn;
}

export function post(message: PdfReply, transfer?: ArrayBuffer[]): void {
  send(message, transfer);
}

/** Tells the engine a request about `file` failed. A code with no `message` has the app's own sentence. */
export function fail(file: FileNumber, code: PdfError["code"], message?: string, data?: PdfErrorData): void {
  post({ type: "error", file, error: { code, ...(message === undefined ? {} : { message }), ...(data === undefined ? {} : { data }) } });
}
