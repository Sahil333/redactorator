import { expect } from "@playwright/test";
import { test } from "./coverage";
import { oneWordPdf, openApp, openPdf, twoPagePdf } from "./app";
import { errorAfterOpen, errorAfterReady, failWorkerStart, replyWith, staleOpenReply } from "./fakes";

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

test("a request the engine could not read is reported with the engine's own sentence, and the engine keeps running", async ({ page }) => {
  const sentence = "The engine got a message it does not know. Reload the page to try again.";
  await replyWith(page, { type: "error", error: { code: "bad-message", message: sentence } });
  await page.goto("/");

  await expect(page.getByRole("alert")).toHaveText(sentence);
  await expect(page.getByLabel("Choose PDFs")).toBeEnabled();
});

test("an error whose data holds more than a page and boxes stops the engine, so no document text can reach the app", async ({ page }) => {
  await replyWith(page, { type: "error", error: { code: "bad-message", message: "Unread.", data: { page: 0, text: "Jane Roe" } } });
  await page.goto("/");

  await expect(page.getByRole("alert")).toHaveText("The PDF engine sent something unexpected. Reload the page to try again.");
  await expect(page.getByLabel("Choose PDFs")).toBeDisabled();
});

test("an error that says where it applies, with a page and boxes, is taken", async ({ page }) => {
  const sentence = "The engine got a message it does not know. Reload the page to try again.";
  const boxes = [{ x0: 72, y0: 79.1, x1: 123.4, y1: 95.6 }];
  await replyWith(page, { type: "error", error: { code: "bad-message", message: sentence, data: { page: 0, boxes } } });
  await page.goto("/");

  await expect(page.getByRole("alert")).toHaveText(sentence);
  await expect(page.getByLabel("Choose PDFs")).toBeEnabled();
});

test("an error the engine reports about no document goes once a document opens, and stays gone on the projects page", async ({ page }) => {
  const sentence = "The engine got a message it does not know. Reload the page to try again.";
  await errorAfterReady(page, sentence);
  await openApp(page);
  await expect(page.getByRole("alert")).toHaveText(sentence);

  await openPdf(page, oneWordPdf);
  await expect(page.getByRole("img", { name: "Page 1" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Projects" }).click();

  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
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

test("an error about the open document that answers no request is still shown", async ({ page }) => {
  await errorAfterOpen(page, "Something went wrong with this document.");
  await openApp(page);
  await openPdf(page, oneWordPdf);

  await expect(page.getByRole("img", { name: "Page 1" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveText("Something went wrong with this document.");
});
