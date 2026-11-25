import { expect } from "@playwright/test";
import { test } from "./coverage";
import { fixturePath, inkedPixels, noPagesPdf, openApp, openPdf, removedKinds, saved, twoPagePdf, workingCopy } from "./app";
import { judge } from "./oracle";

test("opening a PDF renders page 1, at its printed size when there is room", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openApp(page);
  await openPdf(page, twoPagePdf);

  await expect(page.getByRole("status")).toHaveText("Page 1 of 2");
  const firstPage = page.getByRole("img", { name: "Page 1" });
  await expect(firstPage).toBeVisible();
  // 612 x 792 pt (US Letter) shown at 96/72 CSS px per point.
  expect(await firstPage.boundingBox()).toMatchObject({ width: 816, height: 1056 });
  await expect.poll(() => inkedPixels(page.getByRole("img", { name: "Page 1" }))).toBeGreaterThan(500);
});

test("a PDF with no pages is not added, and says why", async ({ page }) => {
  await openApp(page);
  await openPdf(page, noPagesPdf);

  await expect(page.getByRole("region", { name: "1 file not added" }).getByRole("listitem")).toHaveText(
    "no-pages.pdf: This PDF has no pages. Choose another file.",
  );
  await expect(page.getByLabel("Choose PDFs")).toBeEnabled();
});

test("a file named .pdf that is not a PDF is not added, and says why", async ({ page }) => {
  await openApp(page);
  await page.getByLabel("Choose PDFs").setInputFiles({
    name: "notes.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("not a pdf"),
  });

  await expect(page.getByRole("region", { name: "1 file not added" })).toContainText("could not be opened as a PDF");
  await expect(page.getByRole("img", { name: "Page 1" })).toHaveCount(0);
});

test("a PDF that holds explicit nulls where PDF allows them, as a filter with no parameters has, is added and cleaned", async ({ page }) => {
  const fixture = fixturePath("fixtures/null-elements.pdf");
  await openApp(page);
  await openPdf(page, fixture);
  await expect(page.getByRole("img", { name: "Page 1" })).toBeVisible();
  await saved(page);

  await judge(fixture, await workingCopy(page, "null-elements", "null-elements.pdf"), [{ check: "present", text: "Null elements" }, { check: "structure" }, { check: "rendered" }]);
  // A key holding only null held nothing, so deleting it reports nothing removed.
  expect(await removedKinds(page, "null-elements", "null-elements.pdf")).toEqual([]);
});
