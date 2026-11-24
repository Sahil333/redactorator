import { expect } from "@playwright/test";
import {
  applyAndDownload,
  crossPagePdf,
  dragAcrossPages,
  markText,
  oneWordPdf,
  openApp,
  openPdf,
  pickType,
  selectText,
  tabTo,
} from "./app";
import { test } from "./coverage";
import { delayPageText } from "./fakes";
import { judge } from "./oracle";

test("a drag down to a page's footer leaves out the running header drawn after the body", async ({ page }) => {
  // Tall enough for the whole page, so the drag needs no scrolling.
  await page.setViewportSize({ width: 1280, height: 1300 });
  await openApp(page);
  await openPdf(page, crossPagePdf);

  // From the "T" of "The agreement…" down to the "P" of the footer "Page 1 of 3".
  await markText(page, 1, [72, 99.1, 74, 754.7], "Other");

  const marks = page.getByRole("complementary", { name: "Marks" });
  await expect(marks).toContainText("The agreement was signed by Jane");
  await expect(marks).not.toContainText("Agreement 2026");
});

test("a drag from one page onto the next marks text on both, and leaves the running text between", async ({ page }) => {
  await openApp(page);
  await openPdf(page, crossPagePdf);
  await expect(page.getByRole("img", { name: "Page 1" })).toBeVisible();

  // From the "J" of "Jane", the last word of page 1, to the comma of "Roe," on page 2.
  await dragAcrossPages(page, [1, 237, 107], [2, 96, 87]);
  await pickType(page, "Person");

  const marks = page.getByRole("complementary", { name: "Marks" });
  await expect(marks.getByRole("listitem")).toHaveCount(1);
  await expect(marks).toContainText("Jane Roe,");
  await expect(marks).toContainText("Person · pages 1–2");
  const output = await applyAndDownload(page);
  await judge(crossPagePdf, output, [
    { check: "absent", values: ["Jane", "Roe"] },
    { check: "covered", word: "Jane" },
    { check: "covered", word: "Roe," },
    // Page 1's footer and page 2's header stay where they were.
    { check: "positions", words: ["Jane", "Roe,"] },
  ]);
});

test("a drag that starts inside a page's footer keeps the footer, and still leaves the next page's header", async ({ page }) => {
  await openApp(page);
  await openPdf(page, crossPagePdf);
  await expect(page.getByRole("img", { name: "Page 1" })).toBeVisible();

  // From the "P" of "Page 1 of 3" to the comma of "Roe," on page 2.
  await dragAcrossPages(page, [1, 73, 748], [2, 96, 87]);
  await pickType(page, "Other");

  const marks = page.getByRole("complementary", { name: "Marks" });
  await expect(marks).toContainText("Page 1 of 3 Roe,");
  await expect(marks).not.toContainText("Agreement");
});

test("a drag released over a page whose text is still coming is marked once the text arrives", async ({ page }) => {
  // Page 2's text reaches the page 8 seconds late, so the drag crosses it before it is here.
  await delayPageText(page, 1, 8000);
  await openApp(page);
  await openPdf(page, crossPagePdf);
  await expect(page.getByRole("img", { name: "Page 1" })).toBeVisible();

  // From "Jane" on page 1 to "Closing" on page 3.
  await dragAcrossPages(page, [1, 237, 107], [3, 110, 87]);

  await expect(page.getByRole("combobox", { name: "Type for this mark" })).toBeVisible({ timeout: 15_000 });
  await pickType(page, "Other");
  await expect(page.getByRole("complementary", { name: "Marks" })).toContainText("Other · pages 1–3");
});

test("switching to Draw box drops a text selection", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  const surface = page.getByRole("application", { name: "Page 1, select text" });
  await tabTo(page, surface);
  await expect(async () => {
    await page.keyboard.press("ArrowRight");
    await expect(page.getByText(/^Selected:/)).toHaveText("Selected: Claim", { timeout: 500 });
  }).toPass();

  await page.getByRole("button", { name: "Draw box" }).click();
  await page.getByRole("button", { name: "Select text" }).click();

  await expect(page.getByText(/^Selected:/)).toHaveCount(0);
});

test("the keyboard carries a selection onto the next page", async ({ page }) => {
  await openApp(page);
  await openPdf(page, crossPagePdf);
  await expect(page.getByRole("img", { name: "Page 1" })).toBeVisible();
  const said = page.getByText(/^Selected:/);

  await tabTo(page, page.getByRole("application", { name: "Page 1, select text" }));
  await expect(async () => {
    await page.keyboard.press("ArrowRight");
    await expect(said).toHaveText("Selected: Agreement", { timeout: 500 });
  }).toPass();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(said).toHaveText("Selected: The");
  for (let word = 0; word < 5; word++) await page.keyboard.press("ArrowRight");
  await expect(said).toHaveText("Selected: Jane");
  // Down to page 1's footer, page 2's header, then page 2's first line.
  await page.keyboard.press("Shift+ArrowDown");
  await expect(said).toHaveText("Selected: Jane Page 1 of 3");
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowDown");
  // Past the running footer and header, which a selection across pages leaves out.
  await expect(said).toHaveText("Selected: Jane Roe, on");
  await expect(page.getByRole("application", { name: "Page 2, select text" })).toBeFocused();
  await page.keyboard.press("Alt+Shift+ArrowLeft");
  await expect(said).toHaveText("Selected: Jane Roe,");
  await page.keyboard.press("Enter");
  await pickType(page, "Person");

  const output = await applyAndDownload(page);
  await judge(crossPagePdf, output, [
    { check: "absent", values: ["Jane", "Roe"] },
    { check: "positions", words: ["Jane", "Roe,"] },
  ]);
});

test("Shift with an arrow in the type picker adjusts a mouse selection by a letter", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  // "Jane Ro", one letter short of "Roe" and the comma.
  await selectText(page, 1, [101.3, 99.1, 147, 115.6]);

  const picker = page.getByRole("combobox", { name: "Type for this mark" });
  await picker.press("Shift+ArrowRight");
  await picker.press("Shift+ArrowRight");
  await pickType(page, "Person");

  await expect(page.getByRole("complementary", { name: "Marks" }).getByRole("link", { name: "Jane Roe," })).toBeVisible();
});
