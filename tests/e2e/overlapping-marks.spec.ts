// Marks may overlap. With "Print the type in each box" on, a box prints no type where another box
// lies over the place its type would go; everything under every box is deleted as ever
// (docs/designs/nested-marks-note.md).
import { expect, type Page } from "@playwright/test";
import { applyAndDownload, crossPagePdf, dear, drawBox, janeRoe, marks, markText, oneWordPdf, openApp, openPdf, printTypes, type PointBox } from "./app";
import { test } from "./coverage";
import { judge } from "./oracle";

// one-word.pdf's line "Dear Jane Roe, thank you for writing to us." starts at x 72, with "Jane Roe"
// at x 101.3–152.7, y 99.1–115.6 (tests/oracle/README.md), in 12 pt Helvetica. By its letter widths
// "Ja" ends and "ne" starts at x 114.0, "Jane" ends at 127.3 and "Roe" starts at 130.7.
// A box narrower than it is tall is given as a band, since `selectText` drags along the longer side.
const ja: PointBox = [101.3, 104, 114.0, 111];
const ne: PointBox = [114.0, 104, 127.3, 111];
const roe: PointBox = [130.7, 99.1, 152.7, 115.6];
const dearJane: PointBox = [72, 99.1, 127.3, 115.6];
// From "Dear" to inside "writing": wide enough that its type, printed in its middle, is clear of "Dear".
const dearToWriting: PointBox = [72, 104, 250, 111];
// A strip across "Jane Roe" that sticks out above and below it, between the lines next to it. It
// touches only letters the text mark already removes: the "e" of "Jane" to the "R" of "Roe".
const stripAcross: PointBox = [120, 97, 140, 118];

const neighboursKept = [{ check: "positions", words: ["Jane Roe"] }, { check: "structure" }] as const;

/** With labels off the marks are cleaned and the outside checker passes the file; back to editing after. */
async function cleanedWithoutLabels(page: Page): Promise<void> {
  const output = await applyAndDownload(page);
  await judge(oneWordPdf, output, [{ check: "absent", values: ["Jane Roe"] }, ...neighboursKept]);
  await page.getByRole("button", { name: "Back to editing" }).click();
}

test("a text mark inside a wider one of another type: both are removed, and with labels on neither box prints a type", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await markText(page, 1, janeRoe, "Person");
  await markText(page, 1, roe, "Other");
  await expect(marks(page)).toHaveCount(2);
  await cleanedWithoutLabels(page);
  await printTypes(page);

  const output = await applyAndDownload(page);

  await judge(oneWordPdf, output, [{ check: "absent", values: ["Jane Roe", "[PERSON]", "[OTHER]"] }, ...neighboursKept]);
});

test("a text mark inside a wider one of the same type: with labels on neither box prints a type", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await markText(page, 1, janeRoe, "Person");
  await markText(page, 1, roe, "Person");
  await expect(marks(page)).toHaveCount(2);
  await printTypes(page);

  const output = await applyAndDownload(page);

  await judge(oneWordPdf, output, [{ check: "absent", values: ["Jane Roe", "[PERSON]"] }, ...neighboursKept]);
});

test("two text marks that share some letters: both are removed, and with labels on neither box prints a type", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await markText(page, 1, dearJane, "Other");
  await markText(page, 1, janeRoe, "Person");
  await expect(marks(page)).toHaveCount(2);
  await printTypes(page);

  const output = await applyAndDownload(page);

  await judge(oneWordPdf, output, [{ check: "absent", values: ["Dear", "Jane Roe", "[PERSON]", "[OTHER]"] }, { check: "structure" }]);
});

test("a short mark at the end of a wide one: the wide box prints its type in its middle, the short one prints none", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await markText(page, 1, dearToWriting, "Person");
  await markText(page, 1, dear, "Other");
  await expect(marks(page)).toHaveCount(2);
  await printTypes(page);

  const output = await applyAndDownload(page);

  await judge(oneWordPdf, output, [
    { check: "absent", values: ["Dear", "Jane Roe", "thank", "[OTHER]"] },
    { check: "present", text: "[PERSON]" },
    { check: "structure" },
  ]);
});

test("two text marks that only touch are cleaned with labels on, each box printing its type", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await markText(page, 1, ja, "Person");
  await markText(page, 1, ne, "Other");
  await expect(marks(page)).toHaveCount(2);
  await printTypes(page);

  const output = await applyAndDownload(page);

  await judge(oneWordPdf, output, [
    { check: "absent", values: ["Jane"] },
    { check: "present", text: "[PERSON]" },
    { check: "present", text: "[OTHER]" },
    { check: "present", text: "Roe" },
  ]);
});

test("marks on two closely set lines, whose boxes overlap along an edge, each print their type", async ({ page }) => {
  await openApp(page);
  await openPdf(page, crossPagePdf);
  // "Left" on the first two lines of page 2's left column: the lines are 15 points apart and
  // their boxes 16.5 high (tests/oracle/README.md).
  await markText(page, 2, [72.0, 139.1, 92.0, 155.6], "Other");
  await markText(page, 2, [72.0, 154.1, 92.0, 170.6], "Person");
  await printTypes(page);

  const output = await applyAndDownload(page);

  await judge(crossPagePdf, output, [
    { check: "present", text: "[OTHER]" },
    { check: "present", text: "[PERSON]" },
    { check: "structure" },
  ]);
});

test("a drawn box across a text mark: both are cleaned, and with labels on neither box prints a type", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await markText(page, 1, janeRoe, "Person");
  await drawBox(page, 1, stripAcross, "Other");
  await expect(marks(page)).toHaveCount(2);
  await cleanedWithoutLabels(page);
  await printTypes(page);

  const output = await applyAndDownload(page);

  await judge(oneWordPdf, output, [{ check: "absent", values: ["Jane Roe", "[PERSON]", "[OTHER]"] }, ...neighboursKept]);
});
