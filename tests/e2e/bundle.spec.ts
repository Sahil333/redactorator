// Goal G16: the packs ship in the detection worker's script only. The main bundle of the build
// under test holds no pack text, so no pack reaches the page through an import.
import { readdirSync, readFileSync } from "node:fs";
import { expect } from "@playwright/test";
import { isRecord } from "../../engine/model/guards";
import { fixturePath } from "./app";
import { test } from "./coverage";

// The browser tests run against the build vite.config.ts writes: dist-coverage with COVERAGE=1.
const assets = fixturePath(`${process.env.COVERAGE === "1" ? "dist-coverage" : "dist"}/assets`);
const generated = fixturePath("engine/detect/packs/generated");

/** Every pattern and source in the compiled packs and lists: text no other part of the app holds. */
function packTexts(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(packTexts);
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, field]) => (typeof field === "string" ? (key === "pattern" || key === "source" ? [field] : []) : packTexts(field)));
}

/** Whether a script holds `text`, as written or as a JavaScript string literal writes it. */
const holds = (script: string, text: string) => script.includes(text) || script.includes(JSON.stringify(text).slice(1, -1));

// Read in the test, not when the file is loaded: Playwright loads test files before its web server builds the app.
test("the main bundle holds no pack text, and the detection worker's script holds it", () => {
  const compiled = [...readdirSync(generated).filter((name) => name.endsWith(".json")).map((name) => `${generated}/${name}`), ...readdirSync(`${generated}/lists`).map((name) => `${generated}/lists/${name}`)];
  const texts = compiled.flatMap((path) => packTexts(JSON.parse(readFileSync(path, "utf8"))));
  const scripts = readdirSync(assets).filter((name) => name.endsWith(".js"));
  const detectionWorker = scripts.filter((name) => name.startsWith("detectWorker-"));
  expect(texts.length).toBeGreaterThan(0);
  expect(detectionWorker).toHaveLength(1);
  const worker = readFileSync(`${assets}/${detectionWorker[0]}`, "utf8");
  expect(texts.filter((text) => !holds(worker, text))).toEqual([]);

  const main = scripts.filter((name) => !detectionWorker.includes(name));
  const leaks = main.flatMap((name) => texts.filter((text) => holds(readFileSync(`${assets}/${name}`, "utf8"), text)).map((text) => `${name}: ${text}`));
  expect(leaks).toEqual([]);
});
