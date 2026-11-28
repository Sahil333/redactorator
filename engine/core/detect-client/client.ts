import { isRunNumber, type DetectReply, type LoadedPack, type RunNumber } from "../../detect-protocol/messages";
import { parseDetectReply } from "../../detect-protocol/parse";
import type { DetectionErrorCode } from "../../model/errors";
import type { PackId, RunRecord } from "../../model/detection";
import type { Hit } from "../../model/findings";
import type { PageIndex } from "../../model/geometry";
import type { WorkerChannel } from "../ports";

/** The engine-side client for the detection worker, which belongs to one Session. */
export interface DetectionClient {
  /** Loads the packs and searches the pages one at a time; resolves when the run ends. */
  run(input: {
    readonly packs: readonly PackId[];
    readonly pages: readonly { readonly index: PageIndex; readonly chars: readonly string[] }[];
    onPage(result: { readonly page: PageIndex; readonly hits: readonly Hit[]; readonly errors: number }): void;
  }): Promise<Pick<RunRecord, "ended" | "code" | "packs">>;
  /** Ends the worker; a run in progress resolves as "stopped". */
  stop(): void;
}

type RunInput = Parameters<DetectionClient["run"]>[0];
type RunEnd = Awaited<ReturnType<DetectionClient["run"]>>;

/** A worker the client started, and whether it has said anything yet. */
interface Started {
  readonly channel: WorkerChannel;
  answered: boolean;
}

/** The run in progress: the pages it searches, the next one to search, and the packs once loaded. */
interface Current {
  readonly run: RunNumber;
  readonly input: RunInput;
  readonly settle: (end: RunEnd) => void;
  next: number;
  packs?: readonly LoadedPack[];
}

const sameIds = (loaded: readonly LoadedPack[], asked: readonly PackId[]) =>
  loaded.length === asked.length && loaded.every(({ id }, index) => id === asked[index]);

/**
 * The detection client over the workers `start` makes. It starts one at the first run and keeps
 * it for later runs. It ends it on `stop` and on any failure; the next run then starts another.
 * The core sends one page and waits for its answer, with no time limit: a page that never
 * answers keeps the run going until `stop`.
 */
export function detectionClient(start: () => WorkerChannel): DetectionClient {
  let worker: Started | undefined;
  let current: Current | undefined;
  let runs = 0;

  function finish(end: RunEnd): void {
    const run = current;
    current = undefined;
    run?.settle(end);
  }

  function endWorker(): void {
    worker?.channel.terminate();
    worker = undefined;
  }

  function fail(code: DetectionErrorCode): void {
    const packs = current?.packs ?? [];
    endWorker();
    finish({ ended: "failed", code, packs });
  }

  /** Asks for the next page, or ends the run when every page has answered. */
  function searchNext(run: Current, channel: WorkerChannel): void {
    const page = run.input.pages[run.next];
    if (page === undefined) finish({ ended: "finished", packs: run.packs ?? [] });
    else channel.post({ type: "page", run: run.run, page: page.index, chars: page.chars });
  }

  /** A reply of the run in progress. Anything but the answer it waits for is the worker's fault. */
  function answer(run: Current, channel: WorkerChannel, reply: DetectReply): void {
    const page = run.input.pages[run.next];
    if (run.packs === undefined && reply.type === "failed") {
      endWorker();
      finish({ ended: "failed", code: reply.code, packs: [] });
    } else if (run.packs === undefined && reply.type === "ready" && sameIds(reply.packs, run.input.packs)) {
      run.packs = reply.packs;
      searchNext(run, channel);
    } else if (run.packs !== undefined && reply.type === "hits" && page !== undefined && reply.page === page.index && reply.hits.every((hit) => hit.page === page.index && hit.end <= page.chars.length)) {
      run.next++;
      run.input.onPage({ page: reply.page, hits: reply.hits, errors: reply.errors });
      searchNext(run, channel);
    } else {
      fail("detector-failed");
    }
  }

  function received(started: Started, data: unknown): void {
    const reply = parseDetectReply(data);
    if (reply === undefined) {
      fail("detector-failed");
      return;
    }
    started.answered = true;
    // A reply of an earlier run, which was stopped or ended, is ignored.
    if (current !== undefined && reply.run === current.run) answer(current, started.channel, reply);
  }

  /** The worker of this Session, started now if there is none. */
  function workerOf(): Started | undefined {
    if (worker !== undefined) return worker;
    let channel: WorkerChannel;
    try {
      channel = start();
    } catch {
      return undefined;
    }
    const started: Started = { channel, answered: false };
    // Events of a worker already ended are ignored.
    const ifCurrent = (then: () => void) => () => {
      if (worker === started) then();
    };
    channel.onMessage((data) => ifCurrent(() => received(started, data))());
    channel.onMessageError(ifCurrent(() => fail("detector-failed")));
    // A worker that fails before it ever answered could not start: its script did not load or run.
    channel.onError(ifCurrent(() => fail(started.answered ? "detector-failed" : "detector-not-started")));
    worker = started;
    return started;
  }

  return {
    run(input) {
      return new Promise((settle) => {
        const run = runs + 1;
        const started = workerOf();
        if (started === undefined || !isRunNumber(run)) {
          settle({ ended: "failed", code: "detector-not-started", packs: [] });
          return;
        }
        runs = run;
        current = { run, input, settle, next: 0 };
        started.channel.post({ type: "load", run, packs: input.packs });
      });
    },
    stop() {
      const packs = current?.packs ?? [];
      endWorker();
      finish({ ended: "stopped", packs });
    },
  };
}

/** A client that starts no worker, so every run ends as failed: for a Session test that needs no detection. */
export const notStarted: DetectionClient = {
  run: () => Promise.resolve({ ended: "failed", code: "detector-not-started", packs: [] }),
  stop: () => undefined,
};
