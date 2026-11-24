import { expect, type Page } from "@playwright/test";
import { test } from "./coverage";
import { addDocuments, dear, drawBox, janeRoe, markText, oneWordPdf, openApp, openPdf, saved, storedJson, twoPagePdf } from "./app";
import { countWrites, failWrites, holdWrites, stopWorkerAfter } from "./fakes";

/** The project made from one-word.pdf, as stored. */
const storedProject = (page: Page) => storedJson(page, "one-word/.redactorator/project.json");
const markCount = ["documents", "0", "marks", "length"];

async function openOneWord(page: Page): Promise<void> {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await saved(page);
}

test("changes made while a save is under way are saved together in one more write", async ({ page }) => {
  await openOneWord(page);
  const release = await holdWrites(page, "project.json");
  const writes = await countWrites(page, "project.json");

  await drawBox(page, 1, [72, 200, 200, 220], "Other");
  for (let i = 1; i < 10; i++) await drawBox(page, 1, [72, 200 + 40 * i, 200, 220 + 40 * i], "Other");
  await release();

  await saved(page);
  expect(await writes()).toBeLessThanOrEqual(2);
  expect(await storedProject(page)).toHaveProperty(markCount, 10);
});

test("after a save fails, the next change saves both", async ({ page }) => {
  await openOneWord(page);
  await failWrites(page, 1);

  await markText(page, 1, janeRoe, "Person");
  await expect(page.getByRole("banner").getByText("Not saved")).toBeVisible();
  await markText(page, 1, dear, "Other");

  await saved(page);
  expect(await storedProject(page)).toHaveProperty(markCount, 2);
});

test("after the PDF engine stops, a mark removed from the open document is still saved", async ({ page }) => {
  await stopWorkerAfter(page);
  await openOneWord(page);
  await markText(page, 1, janeRoe, "Person");
  await markText(page, 1, dear, "Other");
  await addDocuments(page, twoPagePdf);
  await expect(page.getByRole("region", { name: "1 file not added" })).toBeVisible();

  await page.getByRole("button", { name: "Remove mark Dear on page 1" }).click();

  await saved(page);
  expect(await storedProject(page)).toHaveProperty(markCount, 1);
});

test("settings changed while one is being saved are stored in the order they were made", async ({ page }) => {
  await openOneWord(page);
  const release = await holdWrites(page, "settings.json");
  await page.getByRole("button", { name: "Appearance" }).click();

  await page.getByText("White", { exact: true }).click();
  await page.getByLabel("Custom colour").fill("#336699");
  await release();

  await expect.poll(() => storedJson(page, ".redactorator/settings.json")).toHaveProperty(["appearance", "colour"], "#336699");
});
