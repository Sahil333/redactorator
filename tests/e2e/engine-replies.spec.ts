import { expect } from "@playwright/test";
import { test } from "./coverage";
import { fakeEngine, oneWordPdf, openApp, openPdf, twoPagePdf } from "./app";

test("an engine that fails to start says so and disables the picker", async ({ page }) => {
  await fakeEngine(page, "throw new Error('engine broken');");
  await page.goto("/");

  await expect(page.getByRole("alert")).toHaveText("The PDF engine stopped. Reload the page to try again.");
  await expect(page.getByRole("status")).toHaveText("The PDF engine is not running.");
  await expect(page.getByLabel("Choose PDFs")).toBeDisabled();
});

test("an engine reply the app cannot read stops the engine", async ({ page }) => {
  await fakeEngine(page, `postMessage({ type: "ready" }); postMessage({ type: "nonsense" });`);
  await page.goto("/");

  await expect(page.getByRole("alert")).toHaveText(
    "The PDF engine sent something unexpected. Reload the page to try again.",
  );
  await expect(page.getByRole("status")).toHaveText("The PDF engine is not running.");
  await expect(page.getByLabel("Choose PDFs")).toBeDisabled();
});

test("a reply about a document the user has since left is ignored", async ({ page }) => {
  // Says every file is a one-page PDF, holds back its answer to the first document opened,
  // then answers it after the second document is opened.
  await fakeEngine(
    page,
    `postMessage({ type: "ready" });
    let first;
    addEventListener("message", ({ data }) => {
      if (data.type === "inspect") { postMessage({ type: "inspected", inspection: data.inspection, texts: [{ chars: [] }] }); return; }
      if (data.type !== "open") return;
      if (first === undefined) { first = data.file; return; }
      postMessage({ type: "opened", file: first, document: { pages: [{ index: 0, width: 612, height: 792 }] } });
      postMessage({ type: "error", file: data.file, error: { code: "open-failed", message: "Second file failed." } });
    });`,
  );
  await openApp(page);
  // Added in name order, so one-word.pdf opens first and two-pages.pdf second.
  await openPdf(page, twoPagePdf, oneWordPdf);
  await page.getByRole("navigation", { name: "Documents" }).getByRole("button", { name: /^two-pages\.pdf/ }).click();

  await expect(page.getByRole("alert")).toHaveText("Second file failed.");
  await expect(page.getByRole("img", { name: "Page 1" })).toHaveCount(0);
});
