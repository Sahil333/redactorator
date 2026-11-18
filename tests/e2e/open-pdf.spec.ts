import { expect, test } from "@playwright/test";
import { inkedPixels, openApp, openPdf, twoPagePdf } from "./app";

test("opening a PDF renders page 1", async ({ page }) => {
  await openApp(page);
  await openPdf(page, twoPagePdf);

  await expect(page.getByRole("status")).toHaveText("Page 1 of 2");
  const firstPage = page.getByRole("img", { name: "Page 1" });
  await expect(firstPage).toBeVisible();
  // 612 x 792 pt (US Letter) shown at 96/72 CSS px per point.
  expect(await firstPage.boundingBox()).toMatchObject({ width: 816, height: 1056 });
  await expect.poll(() => inkedPixels(page)).toBeGreaterThan(500);
});

test("a file that is not a PDF shows an error", async ({ page }) => {
  await openApp(page);
  await page.getByLabel("Open a PDF").setInputFiles({
    name: "notes.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("not a pdf"),
  });

  await expect(page.getByRole("alert")).toHaveText(/could not be opened as a PDF/);
  await expect(page.getByRole("img", { name: "Page 1" })).toHaveCount(0);
});
