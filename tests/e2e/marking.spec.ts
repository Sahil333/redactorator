import { expect, type Locator, type Page } from "@playwright/test";
import { test } from "./coverage";
import { dear, janeRoe, markText, oneWordPdf, openApp, openPdf, pickType, selectText, toScreen, type PointBox } from "./app";

const picker = (page: Page) => page.getByRole("combobox", { name: "Type for this mark" });
const marksPanel = (page: Page) => page.getByRole("complementary", { name: "Marks" });
const row = (page: Page, text: string) => marksPanel(page).getByRole("listitem").filter({ hasText: text });
const NOTHING = "rgba(0, 0, 0, 0)";

const background = (element: Locator) => element.evaluate((each) => getComputedStyle(each).backgroundColor);

async function open(page: Page): Promise<void> {
  await openApp(page);
  await openPdf(page, oneWordPdf);
}

async function hoverOn(page: Page, [x0, y0, x1, y1]: PointBox): Promise<void> {
  await page.mouse.move(...(await toScreen(page, 1, (x0 + x1) / 2, (y0 + y1) / 2)));
}

test("dragging a new selection while the type picker is open replaces the first one", async ({ page }) => {
  await open(page);
  await selectText(page, 1, janeRoe);
  await expect(picker(page)).toBeFocused();

  await selectText(page, 1, dear);
  await pickType(page, "Other");

  await expect(marksPanel(page).getByRole("listitem")).toHaveCount(1);
  await expect(marksPanel(page)).toContainText("Dear");
});

test("clicking outside the type picker, or tabbing out of it, makes no mark", async ({ page }) => {
  await open(page);
  await selectText(page, 1, janeRoe);
  await marksPanel(page).click({ position: { x: 20, y: 300 } });
  await expect(picker(page)).toHaveCount(0);

  await selectText(page, 1, janeRoe);
  await picker(page).press("Tab");
  await expect(picker(page)).toHaveCount(0);

  await expect(marksPanel(page)).toContainText("Select text or draw a box");
  await expect(page.getByRole("button", { name: "Apply and check" })).toBeDisabled();
});

test("a click inside the type picker keeps it open and its keys working", async ({ page }) => {
  await open(page);
  await selectText(page, 1, janeRoe);

  await picker(page).locator("..").click({ position: { x: 3, y: 3 } });

  await expect(picker(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(picker(page)).toHaveCount(0);
});

test("moving through the type list with the arrow keys keeps the chosen type in view", async ({ page }) => {
  await open(page);
  await selectText(page, 1, janeRoe);
  const list = page.getByRole("listbox", { name: "Types" });

  // From Person down to Other, the last of the built-in types, below the list's fold.
  for (let step = 0; step < 13; step++) await picker(page).press("ArrowDown");
  await expect(list.getByRole("option", { name: "Other", selected: true })).toBeInViewport();

  // And round to the top again.
  await picker(page).press("ArrowDown");
  await expect(list.getByRole("option", { name: "Person", selected: true })).toBeInViewport();
});

test("clicking away from a mark's type picker keeps its type", async ({ page }) => {
  await open(page);
  await markText(page, 1, janeRoe, "Person");
  await marksPanel(page).getByRole("button", { name: "Change type of Jane Roe on page 1" }).click();
  await expect(picker(page)).toBeFocused();

  await page.locator("#page-1").click({ position: { x: 400, y: 600 } });

  await expect(picker(page)).toHaveCount(0);
  await expect(marksPanel(page)).toContainText("Person · page 1");
});

test("double-clicking a word marks the whole word", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("img", { name: "Page 1" })).toBeVisible();

  await page.mouse.dblclick(...(await toScreen(page, 1, 140, (janeRoe[1] + janeRoe[3]) / 2)));
  await pickType(page, "Person");

  await expect(marksPanel(page).getByRole("link", { name: "Roe," })).toBeVisible();
});

test("each mark shows its type on the page, on the mark's top-left corner", async ({ page }) => {
  await open(page);
  await markText(page, 1, janeRoe, "Person");

  const tag = page.locator("#page-1").getByText("Person", { exact: true });
  await expect(tag).toBeVisible();
  const [left, top] = await toScreen(page, 1, janeRoe[0], janeRoe[1]);
  const at = await tag.boundingBox();
  expect(Math.abs((at?.x ?? 0) - left)).toBeLessThan(4);
  expect(Math.abs((at?.y ?? 0) + (at?.height ?? 0) - top)).toBeLessThan(4);
});

test("hovering a mark highlights its row, and hovering a row highlights the mark", async ({ page }) => {
  await open(page);
  await markText(page, 1, janeRoe, "Person");
  const markBox = page.locator("#page-1").getByText("Person", { exact: true }).locator("..");
  const plain = await background(markBox);

  await hoverOn(page, janeRoe);
  await expect.poll(() => background(row(page, "Jane Roe"))).not.toBe(NOTHING);
  await hoverOn(page, dear);
  await expect.poll(() => background(row(page, "Jane Roe"))).toBe(NOTHING);

  await row(page, "Jane Roe").hover();
  await expect.poll(() => background(markBox)).not.toBe(plain);
});
