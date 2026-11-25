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

test("an XFA form is refused when it is added, before any time goes into marking it, and says why", async ({ page }) => {
  await openApp(page);
  await openPdf(page, fixturePath("fixtures/xfa-form.pdf"));

  await expect(page.getByRole("region", { name: "1 file not added" }).getByRole("listitem")).toHaveText(
    "xfa-form.pdf: This PDF is an XFA form, which can't be cleaned here. Save it as an ordinary PDF in the app that made it, then add it again.",
  );
});

test("a PDF preparation can't clean, as one whose layer rule is a free-form expression, is not added, and says why", async ({ page }) => {
  await openApp(page);
  await openPdf(page, fixturePath("fixtures/visibility-expression.pdf"));

  await expect(page.getByRole("region", { name: "1 file not added" }).getByRole("listitem")).toHaveText(
    "visibility-expression.pdf: This PDF can't be prepared for cleaning here.",
  );
});

test("a PDF with an object the allowlist can't place, as a page whose parent is outside the page tree, is not added, and says why", async ({ page }) => {
  await openApp(page);
  await openPdf(page, fixturePath("fixtures/stray-parent.pdf"));

  await expect(page.getByRole("region", { name: "1 file not added" }).getByRole("listitem")).toHaveText(
    "stray-parent.pdf: This PDF can't be prepared for cleaning here.",
  );
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

test("a PDF whose image data sits under a filter after its JPEG filter, so it can't be cut, is not added, and says why", async ({ page }) => {
  await openApp(page);
  await openPdf(page, fixturePath("fixtures/image-filter-not-last.pdf"));

  await expect(page.getByRole("region", { name: "1 file not added" }).getByRole("listitem")).toHaveText(
    "image-filter-not-last.pdf: This PDF can't be prepared for cleaning here.",
  );
});

test("a PDF with an object two roles disagree on, as an image also used as a soft mask, is not added", async ({ page }) => {
  await openApp(page);
  await openPdf(page, fixturePath("fixtures/two-roles.pdf"));

  await expect(page.getByRole("region", { name: "1 file not added" }).getByRole("listitem")).toHaveText(
    "two-roles.pdf: This PDF can't be prepared for cleaning here.",
  );
});

test("a PDF holding JPEG data in a stream that is no image, as an ICC profile, is not added, and says why", async ({ page }) => {
  await openApp(page);
  await openPdf(page, fixturePath("fixtures/icc-under-dct.pdf"));

  await expect(page.getByRole("region", { name: "1 file not added" }).getByRole("listitem")).toHaveText(
    "icc-under-dct.pdf: This PDF can't be prepared for cleaning here.",
  );
});

test("a PDF with a JPEG whose Adobe segment holds more than its fields is not added, and says why", async ({ page }) => {
  await openApp(page);
  await openPdf(page, fixturePath("fixtures/jpeg-long-adobe.pdf"));

  await expect(page.getByRole("region", { name: "1 file not added" }).getByRole("listitem")).toHaveText(
    "jpeg-long-adobe.pdf: This PDF can't be prepared for cleaning here.",
  );
});

test("a PDF with a stream whose filter is named by an inline image's abbreviated key is not added, and says why", async ({ page }) => {
  await openApp(page);
  await openPdf(page, fixturePath("fixtures/abbreviated-stream-keys.pdf"));

  await expect(page.getByRole("region", { name: "1 file not added" }).getByRole("listitem")).toHaveText(
    "abbreviated-stream-keys.pdf: This PDF can't be prepared for cleaning here.",
  );
});
