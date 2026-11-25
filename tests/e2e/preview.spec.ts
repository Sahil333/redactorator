// Preview: the writer's gate refusing a cleaned file with a reason the user can act on, and a
// document with no marks downloading as its working copy (docs/designs/pdf-leak-suite.md, part 6).
import { readFile } from "node:fs/promises";
import { expect, type Page } from "@playwright/test";
import { applyAndDownload, downloadButton, drawBox, fixturePath, janeRoe, markText, oneWordPdf, openApp, openPdf, saved, show, workingCopy, type PointBox } from "./app";
import { test } from "./coverage";
import { refuseApply } from "./fakes";
import { judge } from "./oracle";

const hiddenContent = fixturePath("fixtures/hidden-content.pdf");
const tallLetterBoxes = fixturePath("fixtures/tall-letter-boxes.pdf");
const signatureStroke = fixturePath("fixtures/signature-stroke.pdf");
const preview = (page: Page) => page.getByRole("button", { name: "Preview", exact: true });
const refused = (page: Page, pageNumber: number) => page.locator(`#page-${pageNumber} [data-refused]`);

test("a document with no marks downloads as its working copy, with what preparation removed gone (CUJ 4)", async ({ page }) => {
  await openApp(page);
  await openPdf(page, hiddenContent);
  await saved(page);

  const output = await applyAndDownload(page);
  await expect(page.locator("#checked-message")).toHaveText(/^Checked: nothing is marked, and the file's metadata is gone\./);
  const working = await workingCopy(page, "hidden-content", "hidden-content.pdf");
  expect(await readFile(output)).toEqual(await readFile(working));
  await judge(hiddenContent, output, [{ check: "absent", values: ["4400 9401", "4400 9402", "4400 9403", "4400 9404"] }, { check: "structure" }, { check: "rendered" }]);
});

// tall-letter-boxes.pdf: "Jane" on the second line, in the app's box convention; its font's letter
// boxes reach the line above (tests/oracle/README.md).
const tallJane: PointBox = [101.3, 106, 127.4, 110];

test("a mark that would also remove unmarked letters next to it is refused, and they are highlighted until dismissed (CUJ 8)", async ({ page }) => {
  await openApp(page);
  await openPdf(page, tallLetterBoxes);
  await markText(page, 1, tallJane, "Person");

  await preview(page).click();

  await expect(page.getByRole("alert")).toHaveText("Cleaning would also remove unmarked text next to a mark on page 1. The extra letters are highlighted.");
  await expect(refused(page, 1)).not.toHaveCount(0);
  await expect(downloadButton(page)).toHaveCount(0);

  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(refused(page, 1)).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

// signature-stroke.pdf's signature on page 2, drawn as one stroke over x 100-300, y 102-232 in the
// app's box convention: one box over most of it, and one over all of it with room for its line.
const mostOfSignature: PointBox = [95, 125, 260, 240];
const allOfSignature: PointBox = [80, 80, 330, 260];

test("a box over part of a drawing is refused until it covers the whole drawing; other documents export meanwhile (CUJ 3)", async ({ page }) => {
  await openApp(page);
  await openPdf(page, signatureStroke, oneWordPdf);
  await show(page, "signature-stroke.pdf");
  await drawBox(page, 2, mostOfSignature, "Signature");

  await preview(page).click();

  await expect(page.getByRole("alert")).toHaveText("A box on page 2 covers part of a drawing. Cover the whole drawing with a margin around it, or remove the box.");
  await expect(refused(page, 2)).toHaveCount(1);
  await expect(downloadButton(page)).toHaveCount(0);

  await show(page, "one-word.pdf");
  await markText(page, 1, janeRoe, "Person");
  await judge(oneWordPdf, await applyAndDownload(page), [{ check: "absent", values: ["Jane Roe"] }]);
  await page.getByRole("button", { name: "Back to editing" }).click();

  await show(page, "signature-stroke.pdf");
  await page.getByRole("button", { name: "Remove mark Box on page 2" }).click();
  await drawBox(page, 2, allOfSignature, "Signature");
  const output = await applyAndDownload(page);
  await judge(signatureStroke, output, [
    { check: "absent", values: ["Signed"] },
    { check: "structure" },
    { check: "rendered", exceptions: [{ page: 2, box: [80, 532, 330, 712] }] },
  ]);
});

test("each refusal of the cleaned file says why in the app's own words, naming the page counted from 1", async ({ page }) => {
  const refusals = [
    { error: { code: "text-moved", data: { page: 0 } }, says: "Other text on page 1 would move in the cleaned file. This PDF can't be cleaned here yet." },
    { error: { code: "check-failed", data: { page: 0 } }, says: "The cleaned file failed a check on page 1. This PDF can't be cleaned here yet." },
    { error: { code: "check-failed" }, says: "The cleaned file failed a check. This PDF can't be cleaned here yet." },
    { error: { code: "apply-failed" }, says: "The marks could not be applied. Preview again." },
  ] as const;
  await refuseApply(page, refusals.map(({ error }) => error));
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await markText(page, 1, janeRoe, "Person");
  for (const { says } of refusals) {
    await preview(page).click();
    await expect(page.getByRole("alert")).toHaveText(says);
    await expect(downloadButton(page)).toHaveCount(0);
  }
});
