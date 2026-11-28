import { expect, type Page } from "@playwright/test";
import { test } from "./coverage";
import { approveButton, fixturePath, marks, markText, openApp, openPdf, type PointBox } from "./app";
import { chooseProfile, findingOf, findingRows, findingsPanel, runButton, stopButton } from "./auto";
import { fakeDetection, type DetectionWorkerScope } from "./fakes";

const pagesPdf = fixturePath("fixtures/auto-pages.pdf");
/** The card numbers on pages 1, 5 and 12. */
const cards = ["4666 6666 6666 6669", "4777 7777 7777 7778", "4888 8888 8888 8887"];
/** The card number on page 1, after "Card ". */
const firstCard: PointBox = [101.3, 109.1, 218.1, 125.6];

/** Where a fake detection worker's first run goes wrong, and how: at loading the packs, or at a page (its index). */
type Fault = { readonly at: "load"; readonly by: "error" | "failed" } | { readonly at: number; readonly by: "error" | "silence" };

/**
 * A detection worker whose first run meets `fault`, and which otherwise finds every card number
 * written as four groups of four digits, as the real worker would. An error is thrown out of the
 * message handler, so the worker fails as one with a fault in its code does.
 */
function faulty(scope: DetectionWorkerScope, acted: () => void, fault: Fault) {
  scope.addEventListener("message", ({ data }) => {
    const first = data.run === 1;
    if (data.type === "load") {
      if (first && fault.at === "load") {
        acted();
        // A worker that fails before it has answered anything could not start, as one whose script does not run.
        if (fault.by === "error") throw new Error("The fake detection worker fails");
        scope.postMessage({ type: "failed", run: data.run, code: "recognizer-failed" });
        return;
      }
      scope.postMessage({ type: "ready", run: data.run, packs: data.packs.map((id) => ({ id, version: "000000000000" })) });
      return;
    }
    if (first && data.page === fault.at) {
      acted();
      if (fault.by === "error") throw new Error("The fake detection worker fails");
      return;
    }
    // Every entry of this fixture's `chars` is one character, so a position in the joined text is an index into `chars`.
    const found = [...data.chars.join("").matchAll(/\d{4} \d{4} \d{4} \d{4}/g)];
    scope.postMessage({
      type: "hits",
      run: data.run,
      page: data.page,
      hits: found.map((match) => ({
        page: data.page,
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
        identifier: "payment-card",
        evidence: [{ kind: "checksum", level: "checked" }],
        rule: "payment-card",
        recognizer: "pattern",
      })),
      errors: 0,
    });
  });
}

async function openPages(page: Page, fault: Fault): Promise<void> {
  await fakeDetection(page, faulty, fault);
  await openApp(page);
  await openPdf(page, pagesPdf);
  await chooseProfile(page, []);
}

const texts = async (page: Page) => Promise.all((await findingRows(page).all()).map(async (row) => (await findingOf(row)).text));

const noPage: readonly { readonly fault: Fault; readonly what: string; readonly sentence: string }[] = [
  { fault: { at: "load", by: "error" }, what: "a worker that cannot start", sentence: "Auto mode could not start. Try again." },
  { fault: { at: "load", by: "failed" }, what: "a worker that cannot load its packs", sentence: "Auto mode could not load its rules. Try again." },
  { fault: { at: 0, by: "error" }, what: "a worker that fails on the first page", sentence: "Auto mode stopped because of an error." },
];

for (const { fault, what, sentence } of noPage) {
  test(`${what} searches no page: its sentence shows beside Run, no panel opens, and the document can be approved and run again`, async ({ page }) => {
    await openPages(page, fault);

    await runButton(page).click();

    const banner = page.getByRole("banner");
    await expect(banner).toContainText(sentence);
    await expect(runButton(page)).toBeEnabled();
    await expect(findingsPanel(page)).toHaveCount(0);
    await expect(page.getByRole("complementary", { name: "Marks" })).toBeVisible();
    await expect(approveButton(page)).toBeEnabled();

    // The failed worker was ended; this run starts another, which searches every page.
    await runButton(page).click();
    await expect(findingRows(page)).toHaveCount(3);
    expect(await texts(page)).toEqual(cards);
    await expect(banner).not.toContainText(sentence);
  });
}

test("a worker that fails on page 3 ends the run early: the panel offers the finding of page 1 and names the pages not searched", async ({ page }) => {
  await openPages(page, { at: 2, by: "error" });

  await runButton(page).click();

  const panel = findingsPanel(page);
  await expect(findingRows(page)).toHaveCount(1);
  expect(await texts(page)).toEqual(cards.slice(0, 1));
  await expect(panel).toContainText("The run ended early because of an error. Pages 3 to 12 were not searched.");
  await expect(panel).not.toContainText("Stopped.");
  await expect(page.getByRole("banner")).not.toContainText("Auto mode stopped because of an error.");
  await expect(approveButton(page)).toBeEnabled();
});

test("a run that fails after its searched pages gave nothing new names the pages not searched beside Run", async ({ page }) => {
  await openPages(page, { at: 2, by: "error" });
  await markText(page, 1, firstCard, "Payment card");
  await expect(marks(page)).toHaveCount(1);

  await runButton(page).click();

  await expect(page.getByRole("banner")).toContainText("The run ended early because of an error. Pages 3 to 12 were not searched.");
  await expect(findingsPanel(page)).toHaveCount(0);
  await expect(marks(page)).toHaveCount(1);
  await expect(runButton(page)).toBeEnabled();
  await expect(approveButton(page)).toBeEnabled();
});

test("a worker that answers 11 pages and then nothing counts on page 12 until Stop, which offers the findings of pages 1 and 5", async ({ page }) => {
  await openPages(page, { at: 11, by: "silence" });

  await runButton(page).click();

  const banner = page.getByRole("banner");
  await expect(banner).toContainText("Searching page 12 of 12");
  await expect(findingsPanel(page)).toHaveCount(0);
  await stopButton(page).click();

  const panel = findingsPanel(page);
  await expect(findingRows(page)).toHaveCount(2);
  expect(await texts(page)).toEqual(cards.slice(0, 2));
  await expect(panel).toContainText("Stopped. Pages 12 to 12 were not searched.");
  await expect(panel).not.toContainText("ended early");
  await expect(banner).not.toContainText("Searching page");
  await expect(approveButton(page)).toBeEnabled();
});
