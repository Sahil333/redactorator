// Fakes for failure and timing cases only: at the PDF worker's wire, and at the browser's file
// writes. Each is named by what it does and checks itself: the `fakes` fixture (coverage.ts)
// fails a test whose fake never acted, and a hold fails when it is released holding nothing.
import { expect, type BrowserContext, type Page } from "@playwright/test";
import type { PdfReply, PdfRequest } from "../../engine/pdf-protocol/messages";

/** A message as it crosses the wire: the same shape, with plain numbers for branded ones. */
type Wire<T> = T extends number
  ? number
  : T extends string | boolean | undefined | ArrayBuffer | Uint8ClampedArray
    ? T
    : T extends readonly (infer E)[]
      ? Wire<E>[]
      : { -readonly [K in keyof T]: Wire<T[K]> };

/** The PDF worker's global scope, as a fake running in it sees it. */
interface WorkerScope {
  postMessage: (message: Wire<PdfReply>, transfer?: Transferable[]) => void;
  addEventListener(type: "message", listener: (event: MessageEvent<Wire<PdfRequest>>) => void): void;
}

/** Tells the test, through the page, that the fake `key` acted, from the page or the PDF worker. */
type Acted = (key: string) => void;

function acted(key: string): void {
  new BroadcastChannel("fakes").postMessage(key);
}

/** Source that runs `fake` in the scope it is loaded into, the PDF worker or the page, with `args` copied in as JSON. */
function sourceOf<S, A extends unknown[]>(fake: (scope: S, acted: Acted, ...args: A) => void, ...args: A): string {
  return `(${String(fake)})(globalThis, ${String(acted)}, ...${JSON.stringify(args)});`;
}

interface PageFakes {
  /** How many times each fake acted, by key. */
  readonly acted: Map<string, number>;
  /** The fakes that must have acted by the end of the test. */
  readonly expected: Set<string>;
  /** The PDF worker's script: replaced, or the real one with preludes run before it. */
  worker: { readonly script: string } | { readonly preludes: string[] } | undefined;
  served: boolean;
}

const installed = new Map<Page, PageFakes>();

/** Passes on to the test each act a fake reports. */
function listenToWorker() {
  new BroadcastChannel("fakes").onmessage = ({ data }) => void Reflect.get(globalThis, "fakeActed")(data);
}

async function fakesOf(page: Page): Promise<PageFakes> {
  const known = installed.get(page);
  if (known !== undefined) return known;
  const fakes: PageFakes = { acted: new Map(), expected: new Set(), worker: undefined, served: false };
  installed.set(page, fakes);
  await page.exposeFunction("fakeActed", (key: string) => fakes.acted.set(key, (fakes.acted.get(key) ?? 0) + 1));
  await page.addInitScript(listenToWorker);
  if (page.url().startsWith("http")) await page.evaluate(listenToWorker);
  return fakes;
}

async function fakeWorker(page: Page, key: string, change: { readonly script: string } | { readonly prelude: string }): Promise<PageFakes> {
  const fakes = await fakesOf(page);
  const { worker } = fakes;
  if (worker === undefined) {
    await page.route("**/assets/worker-*.js", async (route) => {
      fakes.served = true;
      if (fakes.worker !== undefined && "script" in fakes.worker) {
        await route.fulfill({ contentType: "text/javascript", body: fakes.worker.script });
        return;
      }
      const response = await route.fetch();
      await route.fulfill({ response, body: `${fakes.worker?.preludes.join("\n") ?? ""}\n${await response.text()}` });
    });
  }
  if ("script" in change) {
    if (worker !== undefined) throw new Error(`${key} replaces the PDF worker, which another fake already changes`);
    fakes.worker = { script: change.script };
  } else if (worker === undefined) {
    fakes.worker = { preludes: [change.prelude] };
  } else if ("preludes" in worker) {
    worker.preludes.push(change.prelude);
  } else {
    throw new Error(`${key} wraps the PDF worker, which another fake has replaced`);
  }
  return fakes;
}

/** A fake in the PDF worker that must act before the test ends. */
async function workerFake(page: Page, key: string, change: { readonly script: string } | { readonly prelude: string }): Promise<void> {
  (await fakeWorker(page, key, change)).expected.add(key);
}

/** Waits until the fake `key` has held something, so releasing it lets that go. */
async function heldSomething(fakes: PageFakes, key: string): Promise<void> {
  await expect.poll(() => fakes.acted.get(key) ?? 0, { message: `${key} was released without holding anything` }).toBeGreaterThan(0);
}

/** The PDF worker throws as it starts. */
export async function failWorkerStart(page: Page): Promise<void> {
  const script = sourceOf((_: unknown, acted) => {
    acted("failWorkerStart");
    throw new Error("The fake PDF worker failed to start");
  });
  await workerFake(page, "failWorkerStart", { script });
}

/** The PDF worker says it is ready, then sends `message`. */
export async function replyWith(page: Page, message: unknown): Promise<void> {
  const script = sourceOf(
    (scope: { postMessage: (message: unknown) => void }, acted, reply: unknown) => {
      scope.postMessage({ type: "ready" });
      acted("replyWith");
      scope.postMessage(reply);
    },
    message,
  );
  await workerFake(page, "replyWith", { script });
}

/**
 * A PDF worker that says every file is a one-page PDF, holds back its answer to the first document
 * opened, then sends it once the second is opened, and fails the second.
 */
export async function staleOpenReply(page: Page): Promise<void> {
  const script = sourceOf((scope: WorkerScope, acted) => {
    scope.postMessage({ type: "ready" });
    let first: number | undefined;
    scope.addEventListener("message", ({ data }) => {
      if (data.type === "inspect") {
        scope.postMessage({ type: "inspected", inspection: data.inspection, reading: { texts: [{ chars: [] }], images: [] } });
        return;
      }
      if (data.type !== "open") return;
      if (first === undefined) {
        first = data.file;
        return;
      }
      acted("staleOpenReply");
      scope.postMessage({ type: "opened", file: first, document: { pages: [{ index: 0, width: 612, height: 792 }] } });
      scope.postMessage({ type: "error", file: data.file, error: { code: "open-failed", message: "Second file failed." } });
    });
  });
  await workerFake(page, "staleOpenReply", { script });
}

/** The PDF worker reads the first file inspected, then throws on the next inspection instead of answering it. */
export async function stopWorkerAfter(page: Page): Promise<void> {
  const prelude = sourceOf((scope: WorkerScope, acted) => {
    let seen = 0;
    scope.addEventListener("message", (event) => {
      if (event.data.type !== "inspect") return;
      seen++;
      if (seen === 1) return;
      event.stopImmediatePropagation();
      acted("stopWorkerAfter");
      throw new Error("The fake stopped the PDF worker");
    });
  });
  await workerFake(page, "stopWorkerAfter", { prelude });
}

/** From the PDF worker's next start, it throws on the first search for values instead of answering it. */
export async function stopWorkerOnSearch(page: Page): Promise<void> {
  const prelude = sourceOf((scope: WorkerScope, acted) => {
    scope.addEventListener("message", (event) => {
      if (event.data.type !== "match") return;
      event.stopImmediatePropagation();
      acted("stopWorkerOnSearch");
      throw new Error("The fake stopped the PDF worker");
    });
  });
  await workerFake(page, "stopWorkerOnSearch", { prelude });
}

/** The PDF worker sends the text of the page at `pageIndex` `ms` late. */
export async function delayPageText(page: Page, pageIndex: number, ms: number): Promise<void> {
  const prelude = sourceOf(
    (scope: WorkerScope, acted, pageIndex: number, ms: number) => {
      const send = scope.postMessage.bind(scope);
      scope.postMessage = (message, transfer) => {
        if (message.type !== "text" || message.page !== pageIndex) return send(message, transfer);
        acted("delayPageText");
        setTimeout(() => send(message, transfer), ms);
      };
    },
    pageIndex,
    ms,
  );
  await workerFake(page, "delayPageText", { prelude });
}

/** Each text mark in an apply request runs past the page's text, as if the app sent an edit the worker's text does not hold. */
export async function tamperApply(page: Page): Promise<void> {
  const prelude = sourceOf((scope: WorkerScope, acted) => {
    scope.addEventListener("message", ({ data }) => {
      if (data.type !== "apply") return;
      for (const edit of data.edits) {
        if (edit.kind !== "text") continue;
        edit.end += 10000;
        acted("tamperApply");
      }
    });
  });
  await workerFake(page, "tamperApply", { prelude });
}

/** The PDF worker sends each cleaned output `ms` late. */
export async function delayApplied(page: Page, ms: number): Promise<void> {
  const prelude = sourceOf(
    (scope: WorkerScope, acted, ms: number) => {
      const send = scope.postMessage.bind(scope);
      scope.postMessage = (message, transfer) => {
        if (message.type !== "applied") return send(message, transfer);
        acted("delayApplied");
        setTimeout(() => send(message, transfer), ms);
      };
    },
    ms,
  );
  await workerFake(page, "delayApplied", { prelude });
}

/**
 * The PDF worker fails to draw the original's page at `pageIndex` the first time it is asked, and
 * holds that answer back until the next apply is asked, so it arrives while the apply runs. The
 * returned function waits until the page has been asked for.
 */
export async function failRenderUntilApply(page: Page, pageIndex: number, message: string): Promise<() => Promise<void>> {
  const key = "failRenderUntilApply";
  const prelude = sourceOf(
    (scope: WorkerScope, acted, key: string, pageIndex: number, message: string) => {
      let failure: Wire<PdfReply> | "sent" | undefined;
      scope.addEventListener("message", (event) => {
        const { data } = event;
        if (failure === undefined && data.type === "render" && data.source === "original" && data.page === pageIndex) {
          event.stopImmediatePropagation();
          failure = { type: "error", file: data.file, error: { code: "render-failed", message } };
          acted(key);
        } else if (failure !== undefined && failure !== "sent" && data.type === "apply") {
          // Sent before the worker reads the apply, as it would answer a request asked before it.
          scope.postMessage(failure);
          failure = "sent";
        }
      });
    },
    key,
    pageIndex,
    message,
  );
  const fakes = await fakeWorker(page, key, { prelude });
  fakes.expected.add(key);
  return () => heldSomething(fakes, key);
}

/**
 * Once a document opens, and after its first pages have had time to be drawn, the PDF worker sends
 * an error about it that answers no request.
 */
export const errorAfterOpen = (page: Page, message: string) => errorAfter(page, "errorAfterOpen", { after: "opened", message });

/** Once the PDF worker is ready, it reports a request it could not read, which names no document. */
export const errorAfterReady = (page: Page, message: string) => errorAfter(page, "errorAfterReady", { after: "ready", message });

/**
 * The real PDF worker, which after each `after` reply sends an error with `message`: about the
 * document that reply names, a second later, or, after `ready`, about no document at once.
 */
async function errorAfter(page: Page, key: string, options: { readonly after: "ready" | "opened"; readonly message: string }): Promise<void> {
  const prelude = sourceOf(
    (scope: WorkerScope, acted, key: string, { after, message }: typeof options) => {
      const send = scope.postMessage.bind(scope);
      scope.postMessage = (reply, transfer) => {
        send(reply, transfer);
        if (reply.type === "ready" && after === "ready") {
          acted(key);
          send({ type: "error", file: undefined, error: { code: "bad-message", message } });
        }
        if (reply.type !== "opened" || after !== "opened") return;
        const { file } = reply;
        setTimeout(() => {
          acted(key);
          send({ type: "error", file, error: { code: "render-failed", message } });
        }, 1000);
      };
    },
    key,
    options,
  );
  await workerFake(page, key, { prelude });
}

/** Holds the PDF worker's replies of `type` from its next start until the returned function releases them. */
async function holdWorkerReplies(page: Page, key: string, type: PdfReply["type"]): Promise<() => Promise<void>> {
  const prelude = sourceOf(
    (scope: WorkerScope, acted, key: string, type: string) => {
      const send = scope.postMessage.bind(scope);
      const held: [Wire<PdfReply>, Transferable[] | undefined][] = [];
      let holding = true;
      new BroadcastChannel(`release ${key}`).onmessage = () => {
        holding = false;
        for (const [message, transfer] of held.splice(0)) send(message, transfer);
      };
      scope.postMessage = (message, transfer) => {
        if (!holding || message.type !== type) return send(message, transfer);
        held.push([message, transfer]);
        acted(key);
      };
    },
    key,
    type,
  );
  return releaser(page, await fakeWorker(page, key, { prelude }), key);
}

/** The function that ends the PDF worker's fake `key`, once it has acted, by a message on its `release` channel. */
function releaser(page: Page, fakes: PageFakes, key: string): () => Promise<void> {
  return async () => {
    await heldSomething(fakes, key);
    await page.evaluate((key) => new BroadcastChannel(`release ${key}`).postMessage("release"), key);
  };
}

/** Holds the answer to every search an approval runs, from the PDF worker's next start, until released. */
export const holdApprovalSearch = (page: Page) => holdWorkerReplies(page, "holdApprovalSearch", "matched");

/** From the PDF worker's next start, it refuses every file it is asked to read, as unreadable, until the returned function stops it. */
export async function refuseReadings(page: Page): Promise<() => Promise<void>> {
  const key = "refuseReadings";
  const prelude = sourceOf(
    (scope: WorkerScope, acted, key: string) => {
      const send = scope.postMessage.bind(scope);
      let refusing = true;
      new BroadcastChannel(`release ${key}`).onmessage = () => {
        refusing = false;
      };
      scope.postMessage = (message, transfer) => {
        if (!refusing || message.type !== "inspected") return send(message, transfer);
        acted(key);
        send({ type: "refused", inspection: message.inspection, error: { code: "open-failed", message: "The fake could not read this file." } });
      };
    },
    key,
  );
  return releaser(page, await fakeWorker(page, key, { prelude }), key);
}

/** Holds the PDF worker's reading of each added file, from its next start, until released. */
export const holdInspection = (page: Page) => holdWorkerReplies(page, "holdInspection", "inspected");

/**
 * Holds every write to a file named `file` in the browser's storage, or to any file, from now on
 * and after a reload, until the returned function releases them: newest first, as a disk might
 * finish them, so a write that must land last only does if it waited for the others.
 */
export async function holdWrites(page: Page, file?: string): Promise<() => Promise<void>> {
  const fakes = await fakesOf(page);
  const install = (file: string | null) => {
    const original = FileSystemFileHandle.prototype.createWritable;
    const held: (() => void)[] = [];
    let holding = true;
    Reflect.set(globalThis, "releaseWrites", () => {
      holding = false;
      for (const go of held.splice(0).reverse()) go();
    });
    FileSystemFileHandle.prototype.createWritable = async function (...args) {
      if (holding && (file === null || this.name === file)) {
        const released = new Promise<void>((resolve) => held.push(resolve));
        void Reflect.get(globalThis, "fakeActed")("holdWrites");
        await released;
      }
      return original.apply(this, args);
    };
  };
  await page.addInitScript(install, file ?? null);
  if (page.url().startsWith("http")) await page.evaluate(install, file ?? null);
  return async () => {
    await heldSomething(fakes, "holdWrites");
    await page.evaluate(() => Reflect.get(globalThis, "releaseWrites")());
  };
}

/** Run in the page: holds the `nth` read of a file named `file`, its bytes read at once, until `releaseRead` is called. */
function holdReads({ file, nth, key }: { readonly file: string; readonly nth: number; readonly key: string }) {
  const original = Blob.prototype.bytes;
  const { promise: released, resolve } = Promise.withResolvers<void>();
  let count = 0;
  Reflect.set(globalThis, "releaseRead", resolve);
  Blob.prototype.bytes = async function () {
    const bytes = await original.call(this);
    if (this instanceof File && this.name === file && ++count === nth) {
      void Reflect.get(globalThis, "fakeActed")(key);
      await released;
    }
    return bytes;
  };
}

async function releaseRead(page: Page, fakes: PageFakes, key: string): Promise<void> {
  await heldSomething(fakes, key);
  await page.evaluate(() => Reflect.get(globalThis, "releaseRead")());
}

/**
 * Holds the `nth` read from now on (counting from 1) of a file named `file`: its bytes are read at
 * once, as the file is then, and handed over only on release.
 */
export async function holdRead(page: Page, file: string, nth: number): Promise<() => Promise<void>> {
  const fakes = await fakesOf(page);
  await page.evaluate(holdReads, { file, nth, key: "holdRead" });
  return () => releaseRead(page, fakes, "holdRead");
}

/** As `holdRead`, but counting from the start of each later load of the page, so a read made as the app starts can be held. */
export async function holdReadFromStart(page: Page, file: string, nth: number): Promise<() => Promise<void>> {
  const fakes = await fakesOf(page);
  await page.addInitScript(holdReads, { file, nth, key: "holdReadFromStart" });
  return () => releaseRead(page, fakes, "holdReadFromStart");
}

/** Makes every write to the browser's private storage fail from now on, or only the `nth` one (counting from 1). */
export async function failWrites(page: Page, nth?: number): Promise<void> {
  (await fakesOf(page)).expected.add("failWrites");
  await page.evaluate((only) => {
    const original = FileSystemFileHandle.prototype.createWritable;
    let count = 0;
    Reflect.set(globalThis, "restoreWrites", () => {
      FileSystemFileHandle.prototype.createWritable = original;
    });
    FileSystemFileHandle.prototype.createWritable = async function (...args) {
      count++;
      Reflect.set(globalThis, "writeAttempts", count);
      if (only !== undefined && count !== only) return original.apply(this, args);
      await Reflect.get(globalThis, "fakeActed")("failWrites");
      throw new DOMException("The disk is full", "QuotaExceededError");
    };
  }, nth);
}

/** Lets writes through again after `failWrites`. */
export const restoreWrites = (page: Page) => page.evaluate(() => Reflect.get(globalThis, "restoreWrites")());

/** How many writes `failWrites` has seen. */
export const writeAttempts = (page: Page): Promise<unknown> => page.evaluate(() => Reflect.get(globalThis, "writeAttempts"));

/** Counts, from now on, the writes this page starts to files named `file`; the returned function reads the count. */
export async function countWrites(page: Page, file: string): Promise<() => Promise<number>> {
  const fakes = await fakesOf(page);
  const key = `countWrites ${file}`;
  fakes.expected.add(key);
  await page.evaluate(
    ({ file, key }) => {
      const original = FileSystemFileHandle.prototype.createWritable;
      FileSystemFileHandle.prototype.createWritable = async function (...args) {
        if (this.name === file) await Reflect.get(globalThis, "fakeActed")(key);
        return original.apply(this, args);
      };
    },
    { file, key },
  );
  return async () => fakes.acted.get(key) ?? 0;
}

/** Reports each WebSocket or EventSource constructed in this scope, and still constructs it. */
function watchConnections(scope: object, acted: Acted): void {
  for (const name of ["WebSocket", "EventSource"]) {
    const original: unknown = Reflect.get(scope, name);
    if (typeof original !== "function") continue;
    Reflect.set(scope, name, new Proxy(original, {
      construct(target, args, newTarget) {
        acted(`connection ${name}`);
        return Reflect.construct(target, args, newTarget);
      },
    }));
  }
}

/**
 * Watches, from now on, the page and the PDF worker for WebSocket and EventSource connections;
 * the returned function lists those made.
 */
export async function connectionsMade(page: Page): Promise<() => string[]> {
  const watch = sourceOf(watchConnections);
  const fakes = await fakeWorker(page, "connectionsMade", { prelude: watch });
  await page.addInitScript(watch);
  if (page.url().startsWith("http")) await page.evaluate(watch);
  return () => [...fakes.acted.keys()].filter((key) => key.startsWith("connection "));
}

/** Fails the test if a fake on one of `context`'s pages changed no worker script, or never acted. */
export async function checkFakes(context: BrowserContext): Promise<void> {
  const problems: string[] = [];
  for (const [page, fakes] of installed) {
    if (page.context() !== context) continue;
    installed.delete(page);
    if (fakes.worker !== undefined && !fakes.served) problems.push("a fake of the PDF worker served no worker script");
    const missing = () => [...fakes.expected].filter((key) => !fakes.acted.has(key));
    // A fake in the worker reports through the page, so its word can come a moment after the act.
    await expect.poll(() => missing(), { timeout: 2000 }).toEqual([]).catch(() => undefined);
    problems.push(...missing().map((key) => `${key} never acted`));
  }
  if (problems.length > 0) throw new Error(`The test's fakes did not do their job: ${problems.join("; ")}.`);
}
