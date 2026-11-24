import type { Appearance, DocumentModel, Edit, PageText, Reading, Source } from "../../model/document";
import type { PageIndex } from "../../model/geometry";
import {
  isFileNumber,
  isInspectionNumber,
  isMatchNumber,
  type DocumentFound,
  type FileNumber,
  type InspectionNumber,
  type MatchNumber,
  type PdfError,
  type PdfReply,
  type PdfRequest,
  type Pixels,
} from "../../pdf-protocol/messages";
import { parsePdfReply } from "../../pdf-protocol/parse";
import type { WorkerChannel } from "../ports";
import type { ClientError, ClientErrorCode } from "./errors";
import { notRunning, Waiting } from "./waiting";

export interface WorkerStatus {
  readonly state: "starting" | "ready" | "applying" | "stopped";
  readonly error?: ClientError;
}

/** A newly added PDF as the worker read it. */
interface Inspected {
  readonly reading: Reading;
  readonly pages: number;
}

/** A cleaned file that passed the worker's check. */
export interface Applied {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly model: DocumentModel;
}

/** The PDF worker's requests. `render`, `text` and `apply` act on the document opened last. */
export interface PdfClient {
  /** Calls `listener` now with the current status, then on each change, until the returned function is called. */
  onStatus(listener: (status: WorkerStatus) => void): () => void;
  inspect(bytes: Uint8Array): Promise<Inspected | ClientError>;
  /** Every place each key is in each document's text. */
  match(keys: readonly string[], documents: readonly { readonly texts: readonly PageText[] }[]): Promise<readonly DocumentFound[] | ClientError>;
  open(bytes: Uint8Array): Promise<DocumentModel | ClientError>;
  render(source: Source, page: PageIndex, scale: number): Promise<Pixels | ClientError>;
  text(page: PageIndex): Promise<PageText | ClientError>;
  /** Writes the output, checks it and keeps it open, so `render` can draw it. */
  apply(edits: readonly Edit[], appearance: Appearance): Promise<Applied | ClientError>;
}

/** A request about an open file, waiting for its answer. `about` is what the answer names besides the file. */
type FileRequest = { readonly file: FileNumber; readonly about: string } & (
  | { readonly kind: "open"; readonly settle: (answer: DocumentModel | ClientError) => void }
  | { readonly kind: "render"; readonly settle: (answer: Pixels | ClientError) => void }
  | { readonly kind: "text"; readonly settle: (answer: PageText | ClientError) => void }
  | { readonly kind: "apply"; readonly settle: (answer: Applied | ClientError) => void }
);

const staleHandle: ClientError = { code: "stale-handle" };

const renderAbout = (source: Source, page: PageIndex) => `${source}:${page}`;
const textAbout = (page: PageIndex) => `${page}`;

export function pdfClient(channel: WorkerChannel): PdfClient {
  let status: WorkerStatus = { state: "starting" };
  const listeners = new Set<(status: WorkerStatus) => void>();
  // The worker listens only once MuPDF has loaded; anything sent before it says so would be lost.
  let held: [PdfRequest, ArrayBuffer[]][] | undefined = [];
  let latestFile = 0;
  const inspections = new Waiting<InspectionNumber, Inspected>(isInspectionNumber);
  const matches = new Waiting<MatchNumber, readonly DocumentFound[]>(isMatchNumber);
  // Oldest first. The worker answers in the order it is asked, so the oldest that fits an answer is the one it answers.
  const asked: FileRequest[] = [];

  function setStatus(next: WorkerStatus) {
    status = next;
    for (const listener of listeners) listener(next);
  }

  function doneApplying() {
    if (status.state === "applying") setStatus({ state: "ready" });
  }

  function stop(code: ClientErrorCode) {
    // Fail closed: nothing the worker sends later can land, and its copy of the document is freed.
    channel.terminate();
    const error: ClientError = { code };
    setStatus({ state: "stopped", error });
    inspections.stop(error);
    matches.stop(error);
    for (const request of asked.splice(0)) request.settle(error);
  }

  function post(request: PdfRequest, transfer: ArrayBuffer[] = []) {
    if (held !== undefined) held.push([request, transfer]);
    else channel.post(request, transfer);
  }

  function take<K extends FileRequest["kind"]>(kind: K, file: FileNumber, about = ""): Extract<FileRequest, { readonly kind: K }> | undefined {
    const request = asked.find(
      (each): each is Extract<FileRequest, { readonly kind: K }> => each.kind === kind && each.file === file && each.about === about,
    );
    if (request !== undefined) asked.splice(asked.indexOf(request), 1);
    return request;
  }

  function takeOldest(file: FileNumber): FileRequest | undefined {
    const index = asked.findIndex((each) => each.file === file);
    return index === -1 ? undefined : asked.splice(index, 1)[0];
  }

  /** Asks about the document opened last; with no document open, there is nothing to ask about. */
  function aboutOpenFile<T>(ask: (file: FileNumber, settle: (answer: T | ClientError) => void) => void): Promise<T | ClientError> {
    const file = latestFile;
    if (status.state === "stopped") return Promise.resolve(notRunning);
    if (!isFileNumber(file)) return Promise.resolve(staleHandle);
    return new Promise((settle) => ask(file, settle));
  }

  function ready() {
    setStatus({ state: "ready" });
    for (const [request, transfer] of held ?? []) channel.post(request, transfer);
    held = undefined;
  }

  // An answer about a document opened before the last one is of no use to whoever asked.
  const isStale = (file: FileNumber) => file !== latestFile;

  function answerAboutFile(reply: Extract<PdfReply, { readonly type: "opened" | "rendered" | "text" | "applied" }>) {
    const stale = isStale(reply.file);
    switch (reply.type) {
      case "opened":
        take("open", reply.file)?.settle(stale ? staleHandle : reply.document);
        break;
      case "rendered":
        take("render", reply.file, renderAbout(reply.source, reply.page))?.settle(stale ? staleHandle : reply.image);
        break;
      case "text":
        take("text", reply.file, textAbout(reply.page))?.settle(stale ? staleHandle : reply.text);
        break;
      case "applied":
        if (!stale) doneApplying();
        take("apply", reply.file)?.settle(stale ? staleHandle : { bytes: new Uint8Array(reply.bytes), model: reply.output });
        break;
    }
  }

  function failAboutFile(file: FileNumber, error: PdfError) {
    const stale = isStale(file);
    if (!stale) doneApplying();
    const request = takeOldest(file);
    if (request !== undefined) request.settle(stale ? staleHandle : error);
    // It answers nothing asked, but it is about the open document, so it is still shown.
    else if (!stale) setStatus({ state: status.state, error });
  }

  /** The worker could not read a request, so it cannot say which one failed. */
  function unknownRequest(message: string) {
    const state = status.state === "applying" ? "ready" : status.state;
    setStatus({ state, error: { code: "unknown-request", message } });
  }

  function receive(reply: PdfReply) {
    switch (reply.type) {
      case "ready":
        ready();
        break;
      case "inspected":
        inspections.answer(reply.inspection, { reading: reply.reading, pages: reply.reading.texts.length });
        break;
      case "refused":
        inspections.answer(reply.inspection, reply.error);
        break;
      case "matched":
        matches.answer(reply.match, reply.found);
        break;
      case "error":
        if (reply.file === undefined) unknownRequest(reply.error.message);
        else failAboutFile(reply.file, reply.error);
        break;
      default:
        answerAboutFile(reply);
    }
  }

  channel.onMessage((data) => {
    const reply = parsePdfReply(data);
    if (reply === undefined) stop("unexpected-reply");
    else receive(reply);
  });
  channel.onMessageError(() => stop("unreadable-reply"));
  channel.onError(() => stop("worker-stopped"));

  return {
    onStatus(listener) {
      listeners.add(listener);
      listener(status);
      return () => {
        listeners.delete(listener);
      };
    },
    inspect(bytes) {
      // Sent as a copy, so the caller's array is not detached.
      const copy = bytes.slice().buffer;
      return inspections.ask((inspection) => post({ type: "inspect", inspection, bytes: copy }, [copy]));
    },
    match(keys, documents) {
      const pages = documents.map(({ texts }) => texts.map((text) => text.chars.map((char) => char.c)));
      return matches.ask((match) => post({ type: "match", match, keys, documents: pages }));
    },
    open(bytes) {
      const file = latestFile + 1;
      if (status.state === "stopped" || !isFileNumber(file)) return Promise.resolve(notRunning);
      latestFile = file;
      // An apply still under way was for the document being left: its answer will be stale.
      doneApplying();
      const copy = bytes.slice().buffer;
      return new Promise((settle) => {
        asked.push({ kind: "open", file, about: "", settle });
        post({ type: "open", file, bytes: copy }, [copy]);
      });
    },
    render(source, page, scale) {
      return aboutOpenFile<Pixels>((file, settle) => {
        asked.push({ kind: "render", file, about: renderAbout(source, page), settle });
        post({ type: "render", file, source, page, scale });
      });
    },
    text(page) {
      return aboutOpenFile<PageText>((file, settle) => {
        asked.push({ kind: "text", file, about: textAbout(page), settle });
        post({ type: "text", file, page });
      });
    },
    apply(edits, appearance) {
      return aboutOpenFile<Applied>((file, settle) => {
        setStatus({ state: "applying" });
        asked.push({ kind: "apply", file, about: "", settle });
        post({ type: "apply", file, edits, appearance });
      });
    },
  };
}
