import { expect, test } from "@playwright/test";
import { fakeEngine, noPagesPdf, openApp, openPdf, twoPagePdf } from "./app";

test("an engine that fails to start says so and disables the picker", async ({ page }) => {
  await fakeEngine(page, "throw new Error('engine broken');");
  await page.goto("/");

  await expect(page.getByRole("alert")).toHaveText("The PDF engine stopped. Reload the page to try again.");
  await expect(page.getByRole("status")).toHaveText("The PDF engine is not running.");
  await expect(page.getByLabel("Open a PDF")).toBeDisabled();
});

test("an engine reply the app cannot read stops the engine", async ({ page }) => {
  await fakeEngine(page, `postMessage({ type: "ready" }); postMessage({ type: "nonsense" });`);
  await page.goto("/");

  await expect(page.getByRole("alert")).toHaveText(
    "The PDF engine sent something unexpected. Reload the page to try again.",
  );
  await expect(page.getByRole("status")).toHaveText("The PDF engine is not running.");
  await expect(page.getByLabel("Open a PDF")).toBeDisabled();
});

test("a reply about a file the user has since replaced is ignored", async ({ page }) => {
  // Holds back its answer to the first file, then answers it after the second file arrives.
  await fakeEngine(
    page,
    `postMessage({ type: "ready" });
    let first;
    addEventListener("message", ({ data }) => {
      if (first === undefined) { first = data.file; return; }
      postMessage({ type: "opened", file: first, document: { pages: [{ index: 0, width: 612, height: 792 }] } });
      postMessage({ type: "error", file: data.file, error: { code: "open-failed", message: "Second file failed." } });
    });`,
  );
  await openApp(page);
  await openPdf(page, twoPagePdf);
  await openPdf(page, noPagesPdf);

  await expect(page.getByRole("alert")).toHaveText("Second file failed.");
  await expect(page.getByRole("status")).toHaveText("Choose a PDF to open.");
  await expect(page.getByRole("img", { name: "Page 1" })).toHaveCount(0);
});
