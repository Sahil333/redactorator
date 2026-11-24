import { expect } from "@playwright/test";
import { test } from "./coverage";
import { oneWordPdf, openApp, openPdf, twoPagePdf } from "./app";
import { failWorkerStart, replyWith, staleOpenReply } from "./fakes";

test("an engine that fails to start says so and disables the picker", async ({ page }) => {
  await failWorkerStart(page);
  await page.goto("/");

  await expect(page.getByRole("alert")).toHaveText("The PDF engine stopped. Reload the page to try again.");
  await expect(page.getByRole("status")).toHaveText("The PDF engine is not running.");
  await expect(page.getByLabel("Choose PDFs")).toBeDisabled();
});

test("an engine reply the app cannot read stops the engine", async ({ page }) => {
  await replyWith(page, { type: "nonsense" });
  await page.goto("/");

  await expect(page.getByRole("alert")).toHaveText(
    "The PDF engine sent something unexpected. Reload the page to try again.",
  );
  await expect(page.getByRole("status")).toHaveText("The PDF engine is not running.");
  await expect(page.getByLabel("Choose PDFs")).toBeDisabled();
});

test("a reply about a document the user has since left is ignored", async ({ page }) => {
  await staleOpenReply(page);
  await openApp(page);
  // Added in name order, so one-word.pdf opens first and two-pages.pdf second.
  await openPdf(page, twoPagePdf, oneWordPdf);
  await page.getByRole("navigation", { name: "Documents" }).getByRole("button", { name: /^two-pages\.pdf/ }).click();

  await expect(page.getByRole("alert")).toHaveText("Second file failed.");
  // The first document's late answer shows none of its pages, which the fake never draws.
  await expect(page.getByRole("status")).not.toHaveText(/^Page \d+ of \d+$/);
  await expect(page.getByRole("img", { name: "Page 1" })).toHaveCount(0);
});
