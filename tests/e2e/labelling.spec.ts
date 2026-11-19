import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, type Page } from "@playwright/test";
import { test } from "./coverage";
import { crossPagePdf, dragAcrossPages, drawBox, janeRoe, markText, oneWordPdf, openApp, openPdf, pickType, saveDownload, type PointBox } from "./app";
import { validateTruth } from "./oracle";

const signature: PointBox = [300, 400, 420, 440];

// closeTo passes within 10^-digits / 2, so these digits mean "within one point":
// a drawn box can be half a point out where the browser rounds the mouse position.
const WITHIN_A_POINT = -Math.log10(2);

/** A box matcher within a point of `box`. */
const near = ([x0, y0, x1, y1]: PointBox) => ({
  x0: expect.closeTo(x0, WITHIN_A_POINT),
  y0: expect.closeTo(y0, WITHIN_A_POINT),
  x1: expect.closeTo(x1, WITHIN_A_POINT),
  y1: expect.closeTo(y1, WITHIN_A_POINT),
});

/** Fills the label dialog, downloads the file, and has the dataset validator accept it. */
async function exportTruth(page: Page): Promise<{ readonly path: string; readonly truth: unknown }> {
  await page.getByRole("button", { name: "Export labels" }).click();
  const dialog = page.getByRole("dialog", { name: "Export labels" });
  await dialog.getByLabel("Source").fill("Synthetic fixture");
  await dialog.getByLabel("Licence").fill("CC0-1.0");
  await dialog.getByLabel("Country").selectOption("UK");
  await dialog.getByLabel("Format").selectOption("Born-digital PDF");
  await dialog.getByLabel("Split").selectOption("Development");
  const path = await saveDownload(page, () => dialog.getByRole("button", { name: "Download labels" }).click());
  await expect(dialog).toHaveCount(0);
  await validateTruth(path);
  return { path, truth: JSON.parse(await readFile(path, "utf8")) };
}

test("labelling mode exports ground truth that the dataset validator accepts", async ({ page }) => {
  await page.goto("/?label");
  await expect(page.getByLabel("Open a PDF")).toBeEnabled();
  await openPdf(page, oneWordPdf);
  await markText(page, 1, janeRoe, "Person");
  await page.getByRole("textbox", { name: "Link id for Jane Roe on page 1" }).fill("p1");
  await drawBox(page, 1, signature, "Signature");

  const { path, truth } = await exportTruth(page);

  expect(path).toMatch(/one-word\.truth\.json$/);
  const sha256 = createHash("sha256").update(await readFile(oneWordPdf)).digest("hex");
  expect(truth).toMatchObject({
    document: { source: "Synthetic fixture", licence: "CC0-1.0", country: "UK", format: "born-digital-pdf", split: "development", sha256, box_unit: "pt" },
    entities: [
      { id: "e1", type: "person", value: "Jane Roe", link_id: "p1" },
      { id: "e2", type: "signature" },
    ],
    occurrences: [
      { entity_id: "e1", page: 0, start: 63, end: 71, boxes: [near(janeRoe)] },
      { entity_id: "e2", page: 0, boxes: [near(signature)] },
    ],
    hidden_occurrences: [],
  });
});

test("normal mode has no labelling controls", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await markText(page, 1, janeRoe, "Person");

  await expect(page.getByRole("button", { name: "Export labels" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: /Link id/ })).toHaveCount(0);
});

test("offsets follow reading order: a running header drawn last comes first, and columns stay whole", async ({ page }) => {
  await page.goto("/?label");
  await expect(page.getByLabel("Open a PDF")).toBeEnabled();
  await openPdf(page, crossPagePdf);
  await markText(page, 2, [72.0, 79.1, 97.3, 95.6], "Person");
  await markText(page, 2, [320.0, 139.1, 348.0, 155.6], "Other");

  const { truth } = await exportTruth(page);

  expect(truth).toMatchObject({
    occurrences: [
      // After "Agreement 2026" and its line and block ends.
      { page: 1, start: 16, end: 20 },
      // After the body line and the whole left column.
      { page: 1, start: 82, end: 87 },
    ],
  });
});

test("a mark across pages exports as one entity with an occurrence on each page", async ({ page }) => {
  await page.goto("/?label");
  await expect(page.getByLabel("Open a PDF")).toBeEnabled();
  await openPdf(page, crossPagePdf);
  await expect(page.getByRole("img", { name: "Page 1" })).toBeVisible();
  await dragAcrossPages(page, [1, 237, 107], [2, 96, 87]);
  await pickType(page, "Person");

  const { truth } = await exportTruth(page);

  expect(truth).toMatchObject({
    entities: [{ id: "e1", type: "person", value: "Jane Roe," }],
    occurrences: [
      { entity_id: "e1", page: 0, start: 84, end: 88 },
      { entity_id: "e1", page: 1, start: 16, end: 20 },
    ],
  });
});
