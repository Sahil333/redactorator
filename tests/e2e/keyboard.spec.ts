import { expect } from "@playwright/test";
import { test } from "./coverage";
import { downloadButton, imagePdf, oneWordPdf, openApp, openPdf, saveFile, tablePdf, tabTo, toScreen } from "./app";
import { judge } from "./oracle";

test("a word is marked, applied and downloaded with the keyboard alone", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  const surface = page.getByRole("application", { name: "Page 1, select text" });
  const said = page.getByText(/^Selected:/);

  await tabTo(page, surface);
  // An arrow does nothing until the page's text has reached the page, so press until it has.
  await expect(async () => {
    await page.keyboard.press("ArrowRight");
    await expect(said).toHaveText("Selected: Claim", { timeout: 500 });
  }).toPass();
  await page.keyboard.press("ArrowDown");
  await expect(said).toHaveText("Selected: Dear");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Alt+Shift+ArrowRight");
  await expect(said).toHaveText("Selected: Jane Roe,");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("combobox", { name: "Type for this mark" })).toBeFocused();
  await page.keyboard.type("Person");
  await page.keyboard.press("Enter");
  await expect(surface).toBeFocused();
  await expect(page.getByRole("complementary", { name: "Marks" })).toContainText("Jane Roe,");

  await tabTo(page, page.getByRole("button", { name: "Apply and check" }));
  await page.keyboard.press("Enter");
  await expect(page.getByText("Checked:")).toBeVisible();
  await expect(downloadButton(page)).toBeFocused();
  const output = await saveFile(page, () => page.keyboard.press("Enter"));

  await judge(oneWordPdf, output, [
    { check: "absent", values: ["Jane Roe"] },
    { check: "covered", word: "Jane Roe" },
    { check: "positions", words: ["Jane Roe,"] },
    { check: "metadata" },
  ]);
});

test("a box is placed, moved and resized with the keyboard, and Delete removes its mark", async ({ page }) => {
  await openApp(page);
  await openPdf(page, imagePdf);
  await tabTo(page, page.getByRole("button", { name: "Draw box" }));
  await page.keyboard.press("Enter");
  const surface = page.getByRole("application", { name: "Page 1, draw a box" });
  const said = page.getByText(/^Box at/);

  await tabTo(page, surface);
  await page.keyboard.press("Enter");
  const placed = /^Box at (\d+), (\d+), 120 by 40 points$/.exec((await said.textContent()) ?? "");
  expect(placed).not.toBeNull();
  const [x, y] = [Number(placed?.[1]), Number(placed?.[2])];
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Shift+ArrowUp");
  await expect(said).toHaveText(`Box at ${x + 4}, ${y + 4}, 124 by 36 points`);
  await page.keyboard.press("Enter");
  await page.keyboard.type("Photo");
  await page.keyboard.press("Enter");
  const marks = page.getByRole("complementary", { name: "Marks" });
  await expect(marks.getByRole("listitem")).toHaveCount(1);

  await tabTo(page, marks.getByRole("link", { name: "Box" }));
  await page.keyboard.press("Delete");
  await expect(marks.getByRole("listitem")).toHaveCount(0);
  await expect(marks.getByRole("heading", { name: "Marks" })).toBeFocused();
});

test("keyboard marking shows no hint on screen, but screen readers still get it", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  const surface = page.getByRole("application", { name: "Page 1, select text" });
  const said = page.getByText(/^Selected:/);
  await tabTo(page, surface);
  await expect(async () => {
    await page.keyboard.press("ArrowRight");
    await expect(said).toHaveText("Selected: Claim", { timeout: 500 });
  }).toPass();

  await expect(surface).toHaveAccessibleDescription(/^Arrow keys move between words/);
  // Visually hidden: both sit in a 1 × 1 pixel box that clips them, as screen-reader-only text does.
  for (const text of [page.getByText(/^Arrow keys move between words/), said]) {
    const box = await text.locator("..").boundingBox();
    expect(Math.max(box?.width ?? Infinity, box?.height ?? Infinity)).toBeLessThanOrEqual(1);
  }
});

test("↑ and ↓ move between the rows of a table, both ways", async ({ page }) => {
  await openApp(page);
  await openPdf(page, tablePdf);
  const said = page.getByText(/^Selected:/);
  await tabTo(page, page.getByRole("application", { name: "Page 1, select text" }));
  await expect(async () => {
    await page.keyboard.press("ArrowRight");
    await expect(said).toHaveText("Selected: Terms", { timeout: 500 });
  }).toPass();

  // Into the table from the line above, which starts left of its cells.
  await page.keyboard.press("ArrowDown");
  await expect(said).toHaveText("Selected: Engagement");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(said).toHaveText("Selected: Monthly");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(said).toHaveText("Selected: Fifty");

  // Up the right-hand column, not back along the row, and through a cell's short last line.
  await page.keyboard.press("ArrowUp");
  await expect(said).toHaveText("Selected: in");
  await page.keyboard.press("ArrowUp");
  await expect(said).toHaveText("Selected: Three");
  await page.keyboard.press("ArrowUp");
  await expect(said).toHaveText("Selected: Design");
});

test("↓ from the end of a long line in a cell goes to the cell's next line, not the next row", async ({ page }) => {
  await openApp(page);
  await openPdf(page, tablePdf);
  const said = page.getByText(/^Selected:/);
  await tabTo(page, page.getByRole("application", { name: "Page 1, select text" }));
  await expect(async () => {
    await page.keyboard.press("ArrowRight");
    await expect(said).toHaveText("Selected: Terms", { timeout: 500 });
  }).toPass();
  for (const key of ["ArrowDown", "ArrowDown", "ArrowRight", "ArrowRight", "ArrowRight", "ArrowRight", "ArrowRight"]) {
    await page.keyboard.press(key);
  }
  await expect(said).toHaveText("Selected: start,");

  await page.keyboard.press("ArrowDown");

  await expect(said).toHaveText("Selected: parts");
});

test("after a click on the page, the arrow keys start from where you clicked", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await expect(page.getByRole("img", { name: "Page 1" })).toBeVisible();
  const said = page.getByText(/^Selected:/);

  // A click in "Roe", on the middle line.
  await expect(async () => {
    await page.mouse.click(...(await toScreen(page, 1, 142, 107)));
    await page.keyboard.press("ArrowRight");
    await expect(said).toHaveText("Selected: Roe,", { timeout: 500 });
  }).toPass();
  await page.keyboard.press("ArrowDown");
  await expect(said).not.toHaveText("Selected: Roe,");
  await expect(said).toHaveText(/^Selected: (within|reply)$/);
});
