import type { PackId, RunRecord } from "../../model/detection";
import type { Hit } from "../../model/findings";
import type { PageIndex } from "../../model/geometry";

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

/** Stands in until the detection worker exists: no worker starts, so every run ends as failed. */
export const notStarted: DetectionClient = {
  run: () => Promise.resolve({ ended: "failed", code: "detector-not-started", packs: [] }),
  stop: () => undefined,
};
