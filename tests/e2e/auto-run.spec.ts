import { expect, type Page } from "@playwright/test";
import { test } from "./coverage";
import { approveButton, fixturePath, janeRoe, marks, markText, oneWordPdf, openApp, openPdf, saved, show, storedJson } from "./app";
import { chooseForThisRun, chooseProfile, findingOf, findingRows, findingsPanel, profileChooser, recordTopBar, runButton, stopButton } from "./auto";
import { fakeDetection, type DetectionWorkerScope } from "./fakes";

const cardPdf = fixturePath("fixtures/auto-card.pdf");
const card = "4111 1111 1111 1111";
const nearMiss = "4111 1111 1111 1112";

async function storedProfile(page: Page): Promise<unknown> {
  await saved(page);
  const project = await storedJson(page, "auto-card/.redactorator/pdf-3/project.json");
  return typeof project === "object" && project !== null ? Reflect.get(project, "profile") : undefined;
}

/** A detection worker that loads any packs and never answers a page. */
function neverAnswers(scope: DetectionWorkerScope, acted: () => void) {
  scope.addEventListener("message", ({ data }) => {
    if (data.type === "load") scope.postMessage({ type: "ready", run: data.run, packs: data.packs.map((id) => ({ id, version: "000000000000" })) });
    else acted();
  });
}

test("the first run on a new project asks what to look for, stores the answer, and runs", async ({ page }) => {
  await openApp(page);
  await openPdf(page, cardPdf);

  await runButton(page).click();
  const chooser = profileChooser(page);
  await expect(chooser).toBeVisible();
  for (const box of await chooser.getByRole("checkbox").all()) await expect(box).not.toBeChecked();
  await chooser.getByRole("checkbox", { name: "India" }).check();
  await chooser.getByRole("button", { name: "Run Auto mode" }).click();

  await expect(findingRows(page)).toHaveCount(1);
  expect(await storedProfile(page)).toEqual({ countries: ["in"], industries: [] });
});

test("a run counts its pages, then lists the card number in the marks panel's place, ticked, and not the near-miss", async ({ page }) => {
  await openApp(page);
  await openPdf(page, cardPdf);
  await chooseProfile(page, []);
  const topBar = await recordTopBar(page);

  await runButton(page).click();

  const panel = findingsPanel(page);
  await expect(findingRows(page)).toHaveCount(1);
  expect(await topBar()).toContainEqual(expect.stringContaining("Searching page 1 of 1"));
  await expect(page.getByRole("complementary", { name: "Marks" })).toHaveCount(0);
  await expect(panel).toContainText("Found values are removed only once you confirm.");
  const row = findingRows(page).first();
  expect(await findingOf(row)).toEqual({ text: card, identifier: "payment-card", places: 1 });
  await expect(row).toContainText("Payment card");
  await expect(row).toContainText(card);
  await expect(row).toContainText("1 place, page 1");
  await expect(row).toContainText("passed its check");
  await expect(row.getByRole("checkbox", { name: `Payment card ${card}` })).toBeChecked();
  await expect(panel).not.toContainText(nearMiss);
  // Confirming and closing come with slice R1.
  await expect(panel.getByRole("button", { name: "Mark 1 value for removal" })).toBeDisabled();
  await expect(panel.getByRole("button", { name: "Close" })).toBeDisabled();
  await expect(runButton(page)).toBeDisabled();
});

test("the finding is drawn on its page, hand marking is off while it is reviewed, and other documents stay markable", async ({ page }) => {
  await openApp(page);
  await openPdf(page, cardPdf, oneWordPdf);
  await show(page, "auto-card.pdf");
  await chooseProfile(page, []);

  await runButton(page).click();

  await expect(findingRows(page)).toHaveCount(1);
  await expect(page.locator("#page-1 [data-finding]")).toBeVisible();
  await expect(page.getByRole("application", { name: /^Page 1/ })).toHaveCount(0);
  for (const tool of await page.getByRole("group", { name: "Tool" }).getByRole("button").all()) await expect(tool).toBeDisabled();

  await show(page, "one-word.pdf");
  await expect(findingsPanel(page)).toHaveCount(0);
  await markText(page, 1, janeRoe, "Person");
  await expect(marks(page)).toHaveCount(1);

  await show(page, "auto-card.pdf");
  await expect(findingRows(page)).toHaveCount(1);
});

test("Stop ends a run whose page never answers, says which pages were not searched, and lets the document be approved", async ({ page }) => {
  await fakeDetection(page, neverAnswers);
  await openApp(page);
  await openPdf(page, cardPdf);
  await chooseProfile(page, []);
  await saved(page);

  await runButton(page).focus();
  await page.keyboard.press("Enter");

  const banner = page.getByRole("banner");
  await expect(banner).toContainText("Searching page 1 of 1");
  await expect(stopButton(page)).toBeFocused();
  await expect(approveButton(page)).toBeDisabled();
  await page.keyboard.press("Enter");

  await expect(banner).toContainText("Stopped. Pages 1 to 1 were not searched.");
  await expect(runButton(page)).toBeFocused();
  await expect(findingsPanel(page)).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: "Marks" })).toBeVisible();
  await expect(approveButton(page)).toBeEnabled();
});

test("a run for this run only uses its own choices and leaves the project's profile as it was", async ({ page }) => {
  await openApp(page);
  await openPdf(page, cardPdf);
  await chooseProfile(page, ["United States"]);

  const chooser = await chooseForThisRun(page);
  await expect(chooser.getByRole("checkbox", { name: "United States" })).toBeChecked();
  await chooser.getByRole("checkbox", { name: "United States" }).uncheck();
  await chooser.getByRole("checkbox", { name: "India" }).check();
  await chooser.getByRole("checkbox", { name: "Finance" }).check();
  await chooser.getByRole("button", { name: "Run Auto mode" }).click();

  await expect(findingRows(page)).toHaveCount(1);
  expect(await storedProfile(page)).toEqual({ countries: ["us"], industries: [] });
});

test("closing the project during a run stops it, and the project opens again with no run and no findings", async ({ page }) => {
  await fakeDetection(page, neverAnswers);
  await openApp(page);
  await openPdf(page, cardPdf);
  await chooseProfile(page, []);
  await runButton(page).click();
  await expect(page.getByRole("banner")).toContainText("Searching page 1 of 1");

  await page.getByRole("link", { name: "Projects" }).click();
  await page.getByRole("button", { name: "auto-card", exact: true }).click();

  await expect(page.getByRole("complementary", { name: "Marks" })).toBeVisible();
  await expect(runButton(page)).toBeEnabled();
  await expect(page.getByRole("banner")).not.toContainText("Searching page");
  await expect(findingsPanel(page)).toHaveCount(0);
});
