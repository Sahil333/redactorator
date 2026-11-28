// Goals G1 and G2: Auto mode, run on each pack's generated PDF with the one choice that adds the
// pack, finds every planted value and no planted near-miss (docs/designs/auto-mode.md, Technical
// Plan, section 9). The PDFs and truth files are written by tests/oracle/make_pack_fixtures.py.
import { readdirSync, readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";
import { packNames, packOrder, type PackId } from "../../engine/model/detection";
import { isName, isOffset, isRecord, isText, parseAll } from "../../engine/model/guards";
import { identifierPacks } from "../../engine/model/identifiers";
import { keyOf } from "../../engine/model/match";
import { fixturePath, openApp, openPdf, saved, storedJson } from "./app";
import { chooseForThisRun, chooseProfile, findingOf, findingRows, findingsPanel, runButton } from "./auto";
import { test } from "./coverage";

interface Truth {
  readonly pack: PackId;
  readonly values: readonly { readonly text: string; readonly identifier: string; readonly places: number }[];
  readonly nearMisses: readonly { readonly text: string }[];
}

const parseValue = (value: unknown): Truth["values"][number] | undefined =>
  isRecord(value) && isText(value.text) && isName(value.identifier) && isOffset(value.places) ? { text: value.text, identifier: value.identifier, places: value.places } : undefined;

const parseNearMiss = (value: unknown): Truth["nearMisses"][number] | undefined => (isRecord(value) && isText(value.text) ? { text: value.text } : undefined);

function readTruth(name: string): Truth {
  const value: unknown = JSON.parse(readFileSync(fixturePath(`fixtures/packs/${name}`), "utf8"));
  const pack = isRecord(value) ? packOrder.find((id) => id === value.pack) : undefined;
  const values = isRecord(value) ? parseAll(value.values, parseValue) : undefined;
  const nearMisses = isRecord(value) ? parseAll(value.nearMisses, parseNearMiss) : undefined;
  if (pack === undefined || values === undefined || nearMisses === undefined) throw new Error(`fixtures/packs/${name} is not a truth file`);
  return { pack, values, nearMisses };
}

const truths = readdirSync(fixturePath("fixtures/packs")).filter((name) => name.endsWith(".truth.json")).toSorted().map(readTruth);

/** The choice in the chooser that adds `pack`; none for the pack every run uses. */
const choiceOf = (pack: PackId): string[] => (pack === "universal" ? [] : [packNames[pack]]);

/** Waits for the run to end: its findings panel opens, or the line says it found nothing. */
async function runEnded(page: Page): Promise<void> {
  await expect(findingsPanel(page).or(page.getByText("Auto mode found nothing new in this document."))).toBeVisible();
}

async function rows(page: Page) {
  return Promise.all((await findingRows(page).all()).map(findingOf));
}

test("the packs have a generated PDF each, for every pack with rules", () => {
  expect(truths.map(({ pack }) => pack)).toEqual(expect.arrayContaining(["universal", "us", "in"]));
});

for (const truth of truths) {
  test(`a run with the ${truth.pack} pack finds every value planted in fixtures/packs/${truth.pack}.pdf and no near-miss`, async ({ page }) => {
    await openApp(page);
    await openPdf(page, fixturePath(`fixtures/packs/${truth.pack}.pdf`));
    await chooseProfile(page, choiceOf(truth.pack));
    await runButton(page).click();
    await runEnded(page);

    const found = await rows(page);
    const missed = truth.values.filter((value) => !found.some((row) => keyOf(row.text ?? "") === keyOf(value.text) && row.identifier === value.identifier && row.places === value.places));
    const nearMissesFound = truth.nearMisses.filter((nearMiss) => found.some((row) => identifierPacks[row.identifier ?? ""] === truth.pack && keyOf(row.text ?? "") === keyOf(nearMiss.text)));
    const planted = new Set([...truth.values, ...truth.nearMisses].map(({ text }) => keyOf(text)));
    const others = found.filter((row) => !planted.has(keyOf(row.text ?? "")));
    test.info().annotations.push({ type: "other findings", description: JSON.stringify(others) });
    expect({ missed, nearMissesFound }, `Other findings: ${JSON.stringify(others)}. All findings: ${JSON.stringify(found)}`).toEqual({ missed: [], nearMissesFound: [] });
  });
}

async function storedProfile(page: Page): Promise<unknown> {
  await saved(page);
  const project = await storedJson(page, "in/.redactorator/pdf-3/project.json");
  return isRecord(project) ? project.profile : undefined;
}

const ifsc = "HDFC0001234";

test("a project whose profile is the United States does not find the IFSC of the in pack's PDF", async ({ page }) => {
  await openApp(page);
  await openPdf(page, fixturePath("fixtures/packs/in.pdf"));
  await chooseProfile(page, ["United States"]);
  await runButton(page).click();
  await runEnded(page);

  expect((await rows(page)).filter(({ identifier }) => identifier === "in-ifsc")).toEqual([]);
});

test("a run for this run only with India finds the IFSC, and the project's profile stays the United States", async ({ page }) => {
  await openApp(page);
  await openPdf(page, fixturePath("fixtures/packs/in.pdf"));
  await chooseProfile(page, ["United States"]);

  const chooser = await chooseForThisRun(page);
  await chooser.getByRole("checkbox", { name: "United States" }).uncheck();
  await chooser.getByRole("checkbox", { name: "India" }).check();
  await chooser.getByRole("button", { name: "Run Auto mode" }).click();
  await runEnded(page);

  expect(await rows(page)).toContainEqual({ text: ifsc, identifier: "in-ifsc", places: 2 });
  // The reasons name the list, the label and the companion in the rule's own words.
  await expect(findingRows(page).filter({ hasText: ifsc })).toContainText("is a known Indian bank code");
  await expect(findingRows(page).filter({ hasText: "QWXZ0123456" })).toContainText(/next to the label IFS/);
  await expect(findingRows(page).filter({ hasText: "001234567890123" })).toContainText("near a IFSC");
  expect(await storedProfile(page)).toEqual({ countries: ["us"], industries: [] });
});
