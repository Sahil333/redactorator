// With COVERAGE=1 the app is built instrumented (see vite.config.ts). Each test saves the
// counts from the page and the engine worker, and the run merges them into
// coverage/coverage-final.json for fallow's complexity scores.
import { glob, mkdir, readFile, writeFile } from "node:fs/promises";
import { test as base } from "@playwright/test";
import libCoverage, { type CoverageMapData } from "istanbul-lib-coverage";

const enabled = process.env.COVERAGE === "1";
const resultsDir = new URL("../../test-results/", import.meta.url);
const coverageDir = new URL("../../coverage/", import.meta.url);

const counts = () => JSON.stringify(Reflect.get(globalThis, "__coverage__") ?? {});

export const test = base.extend<{ coverage: void }>({
  coverage: [
    async ({ page }, use, testInfo) => {
      await use();
      if (!enabled) return;
      const scopes = [await page.evaluate(counts), ...(await Promise.all(page.workers().map((worker) => worker.evaluate(counts))))];
      await writeFile(testInfo.outputPath("coverage.json"), `[${scopes.join(",")}]`);
    },
    { auto: true },
  ],
});

// A record of files is all this checks; istanbul checks each file's own shape as it merges.
const isCoverageData = (value: unknown): value is CoverageMapData =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The run's global teardown: merges every test's counts. */
export default async function mergeCoverage(): Promise<void> {
  if (!enabled) return;
  const merged = libCoverage.createCoverageMap({});
  for await (const path of glob("**/coverage.json", { cwd: resultsDir })) {
    const scopes: unknown = JSON.parse(await readFile(new URL(path, resultsDir), "utf8"));
    if (!Array.isArray(scopes)) throw new Error(`${path} is not a list of coverage maps`);
    for (const scope of scopes) {
      if (!isCoverageData(scope)) throw new Error(`${path} holds something that is not a coverage map`);
      merged.merge(scope);
    }
  }
  await mkdir(coverageDir, { recursive: true });
  await writeFile(new URL("coverage-final.json", coverageDir), JSON.stringify(merged.toJSON()));
}
