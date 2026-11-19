import { expect, type Page } from "@playwright/test";
import { test } from "./coverage";
import { inkedPixels, janeRoe, markText, oneWordPdf, openApp, openPdf, twoPagePdf } from "./app";

const thumbnail = (page: Page, pageNumber: number) =>
  page.getByRole("link", { name: `Page ${pageNumber}` }).locator("canvas");

async function width(page: Page, name: string): Promise<number | undefined> {
  return (await page.getByRole(name === "Pages" ? "navigation" : "complementary", { name }).boundingBox())?.width;
}

test("a thumbnail shows its page before the page is scrolled to", async ({ page }) => {
  // Short enough that page 2 is far below the fold of the main view.
  await page.setViewportSize({ width: 1280, height: 500 });
  await openApp(page);
  await openPdf(page, twoPagePdf);

  await expect.poll(() => inkedPixels(thumbnail(page, 2))).toBeGreaterThan(20);
  // Still below the fold: the thumbnail asked for page 2, not the main view.
  expect((await page.locator("#page-2").boundingBox())?.y).toBeGreaterThan(500);
});

test("the page list and marks panel resize by drag and keyboard, within limits", async ({ page }) => {
  await openApp(page);
  await openPdf(page, twoPagePdf);
  const list = page.getByRole("separator", { name: "Resize the page list" });
  const marks = page.getByRole("separator", { name: "Resize the marks panel" });
  await expect(list).toHaveAttribute("aria-valuenow", "184");
  expect(await width(page, "Pages")).toBe(184);
  expect(await width(page, "Marks")).toBe(288);

  const at = await list.boundingBox();
  if (at === null) throw new Error("the page list splitter is not on screen");
  await page.mouse.move(at.x, at.y + 200);
  await page.mouse.down();
  await page.mouse.move(at.x + 100, at.y + 200, { steps: 5 });
  expect(await width(page, "Pages")).toBe(284);
  await page.mouse.move(at.x + 600, at.y + 200, { steps: 5 });
  await page.mouse.up();
  expect(await width(page, "Pages")).toBe(360);
  await expect(list).toHaveAttribute("aria-valuenow", "360");

  await marks.focus();
  await marks.press("ArrowLeft");
  expect(await width(page, "Marks")).toBe(304);
  await marks.press("End");
  expect(await width(page, "Marks")).toBe(480);
  await marks.press("Home");
  expect(await width(page, "Marks")).toBe(240);
});

test("a thumbnail stays sharp at the widest page list", async ({ page }) => {
  await openApp(page);
  await openPdf(page, twoPagePdf);
  await page.getByRole("separator", { name: "Resize the page list" }).press("End");

  const first = thumbnail(page, 1);
  await expect.poll(() => inkedPixels(first)).toBeGreaterThan(20);
  const { drawn, shown } = await first.evaluate((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("not a canvas");
    return { drawn: canvas.width, shown: canvas.clientWidth * window.devicePixelRatio };
  });
  expect(drawn).toBeGreaterThanOrEqual(shown);
});

test("the status and page list follow the page in view", async ({ page }) => {
  await openApp(page);
  await openPdf(page, twoPagePdf);
  await expect(page.getByRole("status")).toHaveText("Page 1 of 2");

  await page.locator("#page-2").scrollIntoViewIfNeeded();

  await expect(page.getByRole("status")).toHaveText("Page 2 of 2");
  await expect(page.getByRole("link", { name: "Page 2" })).toHaveAttribute("aria-current", "page");
});

test("nothing spills out sideways with both panels at their narrowest", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 700 });
  await page.goto("/?label");
  await expect(page.getByLabel("Open a PDF")).toBeEnabled();
  await openPdf(page, oneWordPdf);
  await markText(page, 1, janeRoe, "Person");
  await page.getByRole("separator", { name: "Resize the page list" }).press("Home");
  await page.getByRole("separator", { name: "Resize the marks panel" }).press("Home");
  await page.getByRole("button", { name: "Appearance" }).click();
  const settings = page.getByRole("dialog", { name: "Appearance" });
  await expect(settings).toBeVisible();

  const spills = await page.evaluate(() => {
    const root = document.documentElement;
    const panel = document.querySelector("aside")?.getBoundingClientRect();
    const right = (element: Element) => element.getBoundingClientRect().right;
    return {
      page: root.scrollWidth - root.clientWidth,
      panel: [...document.querySelectorAll("aside *")].filter((each) => right(each) > (panel?.right ?? 0) + 0.5).length,
      window: [...document.querySelectorAll("header *, [popover] *")].filter((each) => right(each) > window.innerWidth).length,
    };
  });
  expect(spills).toEqual({ page: 0, panel: 0, window: 0 });

  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();
});
