import { expect } from "@playwright/test";
import { test } from "./coverage";
import {
  applyAndDownload,
  dear,
  drawBox,
  editLockedPdf,
  encryptedPdf,
  crossPagePdf,
  imagePdf,
  janeRoe,
  maskedImagePdf,
  markText,
  oneWordPdf,
  openApp,
  openPdf,
  pickType,
  printTypes,
  rotatedCroppedPdf,
  tjStringsPdf,
  type PointBox,
  downloadButton,
} from "./app";
import { delayApplied, failRenderUntilApply, tamperApply } from "./fakes";
import { judge } from "./oracle";

// Geometry from tests/oracle/README.md, in the app's box convention.
const okonkwo: PointBox = [459.8, 210.3, 479.0, 268.6];
const imageLeftHalf: PointBox = [100, 200, 228, 392];
// On page 1 of cross-page.pdf: "7731" in "Claim reference 7731…", and "Jane" ending "…signed by Jane".
const claimNumber: PointBox = [160, 79.1, 186.7, 95.6];
const jane: PointBox = [236.1, 99.1, 262.1, 115.6];

test("a marked word is removed from the file, boxed, and its neighbours stay put", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await markText(page, 1, janeRoe, "Person");
  await expect(page.getByRole("complementary", { name: "Marks" })).toContainText("Jane Roe");

  const output = await applyAndDownload(page);

  // Not yet approved, so the download is a preview.
  expect(output).toMatch(/one-word-preview\.pdf$/);
  await judge(oneWordPdf, output, [
    { check: "absent", values: ["Jane Roe"] },
    { check: "covered", word: "Jane Roe" },
    { check: "positions", words: ["Jane Roe"] },
    { check: "metadata" },
  ]);
});

test("a PDF locked only against editing, with no password to open it, is cleaned, and its cleaned file has no lock", async ({ page }) => {
  await openApp(page);
  await openPdf(page, editLockedPdf);
  await markText(page, 1, janeRoe, "Person");

  const output = await applyAndDownload(page);

  // The metadata check also fails an encrypted file, whose streams the raw scan can't read.
  await judge(editLockedPdf, output, [
    { check: "absent", values: ["Jane Roe"] },
    { check: "covered", word: "Jane Roe" },
    { check: "positions", words: ["Jane Roe"] },
    { check: "metadata" },
  ]);
});

test("a word in the middle of a TJ string is removed, and the rest of its line stays put", async ({ page }) => {
  await openApp(page);
  await openPdf(page, tjStringsPdf);
  await markText(page, 1, janeRoe, "Person");

  const output = await applyAndDownload(page);
  await judge(tjStringsPdf, output, [
    { check: "absent", values: ["Jane Roe"] },
    { check: "covered", word: "Jane Roe" },
    { check: "positions", words: ["Jane Roe"] },
  ]);
});

test("the preview shows the cleaned output before download", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await markText(page, 1, janeRoe, "Person");
  await page.getByRole("button", { name: "Apply and check" }).click();

  await expect(page.getByText("Checked:")).toBeVisible();
  // The page image is drawn at its printed size (96/72 CSS pixels a point) at the screen's pixel ratio.
  const centre = await page.getByRole("img", { name: "Page 1" }).evaluate((canvas, { x, y }) => {
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("Page 1 is not a canvas");
    const scale = devicePixelRatio * (96 / 72);
    return [...(canvas.getContext("2d")?.getImageData(x * scale, y * scale, 1, 1).data ?? [])];
  }, { x: (janeRoe[0] + janeRoe[2]) / 2, y: (janeRoe[1] + janeRoe[3]) / 2 });
  expect(centre.slice(0, 3)).toEqual([0, 0, 0]);

  await page.getByRole("button", { name: "Back to editing" }).click();
  await expect(page.getByRole("button", { name: "Apply and check" })).toBeFocused();
  await expect(page.getByRole("complementary", { name: "Marks" })).toContainText("Jane Roe");
});

test("a box over part of an image blanks the pixels under it in the file", async ({ page }) => {
  await openApp(page);
  await openPdf(page, imagePdf);
  await drawBox(page, 1, imageLeftHalf, "Photo");

  const output = await applyAndDownload(page);

  await judge(imagePdf, output, [{ check: "pixels", region: [100, 400, 228, 592] }, { check: "metadata" }]);
});

test("a box over part of a letter removes the whole letter, and the check passes", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  // The space before "Jane" and the left third of its "J".
  await drawBox(page, 1, [98.5, 101, 103.1, 113], "Other");

  const output = await applyAndDownload(page);

  await judge(oneWordPdf, output, [
    { check: "absent", values: ["J"] },
    { check: "present", text: "ane Roe" },
    { check: "positions", words: ["Jane Roe,"] },
  ]);
});

test("a box over a masked image blanks the image and its mask under the box", async ({ page }) => {
  await openApp(page);
  await openPdf(page, maskedImagePdf);
  await drawBox(page, 1, imageLeftHalf, "Signature");

  const output = await applyAndDownload(page);

  // A shape can live in the soft mask alone, so the mask is judged as well as the image.
  await judge(maskedImagePdf, output, [
    { check: "pixels", region: [100, 400, 228, 592] },
    { check: "pixels", region: [100, 400, 228, 592], mask: true },
  ]);
});

test("a mark on one line keeps the line below, though their character boxes overlap", async ({ page }) => {
  await openApp(page);
  await openPdf(page, crossPagePdf);
  // "Left" on the first line of page 2's left column; the lines are 15 points apart.
  await markText(page, 2, [72.0, 139.1, 92.0, 155.6], "Other");

  const output = await applyAndDownload(page);

  await judge(crossPagePdf, output, [
    { check: "present", text: "Left column two" },
    { check: "positions", words: ["Left"] },
  ]);
});

test("on a rotated, cropped page the box lands on the word and the word is gone", async ({ page }) => {
  await openApp(page);
  await openPdf(page, rotatedCroppedPdf);
  await markText(page, 1, okonkwo, "Person");

  const output = await applyAndDownload(page);

  await judge(rotatedCroppedPdf, output, [
    { check: "absent", values: ["Okonkwo"] },
    { check: "covered", word: "Okonkwo" },
    { check: "positions", words: ["Okonkwo"] },
  ]);
});

test("with the label on, each box prints its type", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await markText(page, 1, janeRoe, "Person");
  await printTypes(page);

  const output = await applyAndDownload(page);

  await judge(oneWordPdf, output, [
    { check: "absent", values: ["Jane Roe"] },
    { check: "present", text: "[PERSON]" },
  ]);
});

test("a label outside ASCII prints as typed", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await markText(page, 1, janeRoe, "Größe");
  await printTypes(page);

  const output = await applyAndDownload(page);

  await judge(oneWordPdf, output, [
    { check: "absent", values: ["Jane Roe"] },
    { check: "present", text: "[GRÖSSE]" },
  ]);
});

test("a removed mark is kept in the file, and a mark can change to a new custom type", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await markText(page, 1, dear, "Other");
  await markText(page, 1, janeRoe, "Person");
  const marks = page.getByRole("complementary", { name: "Marks" });

  await marks.getByRole("button", { name: "Remove mark Dear on page 1" }).click();
  await marks.getByRole("button", { name: "Change type of Jane Roe on page 1" }).click();
  await pickType(page, "Client");
  await printTypes(page);
  const output = await applyAndDownload(page);

  await expect(marks).not.toContainText("Dear");
  await judge(oneWordPdf, output, [
    { check: "absent", values: ["Jane Roe"] },
    { check: "present", text: "Dear" },
    { check: "present", text: "[CLIENT]" },
  ]);
});

test("a custom type joins the picker for the next mark", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await markText(page, 1, janeRoe, "Client");

  await markText(page, 1, dear, "Cli");

  await expect(page.getByRole("complementary", { name: "Marks" }).getByText("Client · page 1")).toHaveCount(2);
});

test("an encrypted PDF is refused with a reason", async ({ page }) => {
  await openApp(page);
  await openPdf(page, encryptedPdf);

  await expect(page.getByRole("region", { name: "1 file not added" }).getByRole("listitem")).toHaveText(
    "encrypted.pdf: This PDF is encrypted. Remove its password in the app that made it, then open it again.",
  );
  await expect(page.getByRole("img", { name: "Page 1" })).toHaveCount(0);
});

test("changing a mark after apply drops the checked output", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await markText(page, 1, dear, "Other");
  await markText(page, 1, janeRoe, "Person");
  await page.getByRole("button", { name: "Apply and check" }).click();
  await expect(page.getByText("Checked:")).toBeVisible();

  await page.getByRole("button", { name: "Remove mark Dear on page 1" }).click();

  await expect(page.getByText("Checked:")).toHaveCount(0);
  await expect(downloadButton(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Apply and check" })).toBeEnabled();
});

test("a text mark that runs past the page's text blocks the export", async ({ page }) => {
  await tamperApply(page);
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await markText(page, 1, janeRoe, "Person");

  await page.getByRole("button", { name: "Apply and check" }).click();

  await expect(page.getByRole("alert")).toHaveText(/^A mark on page 1 does not match the page's text\. Nothing was exported\./);
  await expect(downloadButton(page)).toHaveCount(0);
});

test("changing a mark while apply runs drops the output that arrives after", async ({ page }) => {
  await delayApplied(page, 1000);
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await markText(page, 1, dear, "Other");
  await markText(page, 1, janeRoe, "Person");
  await page.getByRole("button", { name: "Apply and check" }).click();
  await expect(page.getByRole("status")).toHaveText("Applying and checking…");

  await page.getByRole("button", { name: "Remove mark Dear on page 1" }).click();

  await expect(page.getByRole("status")).toHaveText("Page 1 of 1");
  await expect(page.getByText("Checked:")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Apply and check" })).toBeEnabled();
});

test("an error about another request while apply runs leaves the apply running, and the output shown has every mark", async ({ page }) => {
  await delayApplied(page, 2000);
  const asked = await failRenderUntilApply(page, 1, "Page 2 could not be drawn. Open the PDF again.");
  await openApp(page);
  await openPdf(page, crossPagePdf);
  await markText(page, 1, claimNumber, "Other");
  await page.locator("#page-2").scrollIntoViewIfNeeded();
  await asked();

  await page.getByRole("button", { name: "Apply and check" }).click();

  await expect(page.getByRole("alert")).toHaveText("Page 2 could not be drawn. Open the PDF again.");
  // Until the apply answers, no mark can be added and no second apply started, so its output
  // cannot land as a later one's.
  await expect(page.getByRole("status")).toHaveText("Applying and checking…");
  await expect(page.getByRole("button", { name: "Apply and check" })).toBeDisabled();
  await expect(page.getByText("Checked:")).toBeVisible();

  await page.getByRole("button", { name: "Back to editing" }).click();
  await markText(page, 1, jane, "Person");
  const output = await applyAndDownload(page);
  await judge(crossPagePdf, output, [{ check: "absent", values: ["7731", "Jane"] }]);
});
