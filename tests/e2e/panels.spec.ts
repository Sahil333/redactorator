import { expect, type Page } from "@playwright/test";
import { test } from "./coverage";
import { crossPagePdf, inkedPixels, janeRoe, longPdf, markText, oneWordPdf, openApp, openPdf, showPageList, twoPagePdf } from "./app";

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
  await showPageList(page);

  await expect.poll(() => inkedPixels(thumbnail(page, 2))).toBeGreaterThan(20);
  // Still below the fold: the thumbnail asked for page 2, not the main view.
  expect((await page.locator("#page-2").boundingBox())?.y).toBeGreaterThan(500);
});

test("the page list and marks panel resize by drag and keyboard, within limits", async ({ page }) => {
  await openApp(page);
  await openPdf(page, twoPagePdf);
  await showPageList(page);
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
  await showPageList(page);
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
  await showPageList(page);
  await expect(page.getByRole("status")).toHaveText("Page 1 of 2");

  await page.locator("#page-2").scrollIntoViewIfNeeded();

  await expect(page.getByRole("status")).toHaveText("Page 2 of 2");
  await expect(page.getByRole("link", { name: "Page 2" })).toHaveAttribute("aria-current", "page");
});

test("the page list scrolls to keep the page in view on screen", async ({ page }) => {
  // Short enough that page 3's thumbnail starts below the page list's fold.
  await page.setViewportSize({ width: 1280, height: 400 });
  await openApp(page);
  await openPdf(page, crossPagePdf);
  await showPageList(page);
  const third = page.getByRole("link", { name: "Page 3" });
  await expect(third).not.toBeInViewport();

  await page.locator("#page-3").scrollIntoViewIfNeeded();

  await expect(third).toHaveAttribute("aria-current", "page");
  await expect(third).toBeInViewport();
});

test("nothing spills out sideways with both panels at their narrowest", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 700 });
  await openApp(page, "/?label");
  await openPdf(page, oneWordPdf);
  await showPageList(page);
  // At this width the documents list leaves the page too little room; a user would hide it.
  await page.getByRole("button", { name: "Documents", exact: true }).click();
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

test("a page too wide for the space between the panels shrinks to fit it, and can still be marked", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  await showPageList(page);
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 800 });
    const pageBox = page.locator("#page-1");
    await expect
      .poll(async () => {
        const [shown, pages, marks] = await Promise.all([
          pageBox.boundingBox(),
          page.getByRole("navigation", { name: "Pages" }).boundingBox(),
          page.getByRole("complementary", { name: "Marks" }).boundingBox(),
        ]);
        return shown !== null && pages !== null && marks !== null && shown.x >= pages.x + pages.width && shown.x + shown.width <= marks.x;
      })
      .toBe(true);
  }
  await markText(page, 1, janeRoe, "Person");

  await expect(page.getByRole("complementary", { name: "Marks" }).getByRole("listitem")).toHaveText([/Jane Roe/]);
});

const zoomShown = (page: Page) => page.getByRole("group", { name: "Zoom" }).getByText(/^\d+%$/);
const pageWidth = async (page: Page) => (await page.locator("#page-1").boundingBox())?.width;

test("the pages zoom in and out with the buttons and keys, and go back to fitting the width", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1000 });
  await openApp(page);
  await openPdf(page, oneWordPdf);
  const zoom = page.getByRole("group", { name: "Zoom" });
  // 612 pt wide at 96/72 CSS pixels a point is its printed size, 100%.
  await expect(zoomShown(page)).toHaveText("100%");
  await expect(zoom.getByRole("button", { name: "Fit to width" })).toHaveAttribute("aria-pressed", "true");

  await zoom.getByRole("button", { name: "Zoom in" }).click();
  await expect(zoomShown(page)).toHaveText("110%");
  expect(await pageWidth(page)).toBeCloseTo(816 * 1.1, 0);
  await zoom.getByRole("button", { name: "Zoom out" }).click();
  await zoom.getByRole("button", { name: "Zoom out" }).click();
  await expect(zoomShown(page)).toHaveText("90%");
  await expect(zoom.getByRole("button", { name: "Fit to width" })).toHaveAttribute("aria-pressed", "false");

  await page.keyboard.press("ControlOrMeta+=");
  await expect(zoomShown(page)).toHaveText("100%");
  await page.keyboard.press("ControlOrMeta+=");
  await expect(zoomShown(page)).toHaveText("110%");
  await page.keyboard.press("ControlOrMeta+0");
  await expect(zoomShown(page)).toHaveText("100%");
  await expect(zoom.getByRole("button", { name: "Fit to width" })).toHaveAttribute("aria-pressed", "true");
});

test("Ctrl with the wheel over the pages zooms them, and a zoomed page is drawn sharper and can be marked", async ({ page }) => {
  await openApp(page);
  await openPdf(page, oneWordPdf);
  const canvasWidth = () => page.getByRole("img", { name: "Page 1" }).evaluate((canvas) => (canvas instanceof HTMLCanvasElement ? canvas.width : 0));
  await expect.poll(canvasWidth).toBeGreaterThan(0);
  const printed = await canvasWidth();

  const pane = await page.getByRole("main").boundingBox();
  if (pane === null) throw new Error("The pages are not on screen");
  await page.mouse.move(pane.x + pane.width / 2, pane.y + pane.height / 2);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -150);
  await page.keyboard.up("Control");

  await expect.poll(async () => Number.parseInt((await zoomShown(page).textContent()) ?? "0", 10)).toBeGreaterThan(100);
  await expect.poll(canvasWidth).toBe(printed * 2);
  await markText(page, 1, janeRoe, "Person");
  await expect(page.getByRole("complementary", { name: "Marks" }).getByRole("listitem")).toHaveText([/Jane Roe/]);
});

test("in a text field the zoom keys are left to the browser", async ({ page }) => {
  await openApp(page, "/?label");
  await openPdf(page, oneWordPdf);
  await markText(page, 1, janeRoe, "Person");
  await expect(zoomShown(page)).toHaveText(/%$/);
  const before = await zoomShown(page).textContent();

  await page.getByRole("textbox", { name: "Link id for Jane Roe on page 1" }).press("ControlOrMeta+=");

  await expect(zoomShown(page)).toHaveText(before ?? "");
});

test("zoomed in, only the latest few pages are kept finely drawn, and a page dropped is drawn again when shown", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);
  await openPdf(page, longPdf);
  await expect(page.getByRole("img", { name: "Page 1" })).toBeVisible();
  for (let step = 0; step < 3; step++) await page.getByRole("group", { name: "Zoom" }).getByRole("button", { name: "Zoom in" }).click();
  await expect(zoomShown(page)).toHaveText("150%");
  // At the printed size an image is 612 pt × 96/72 × the pixel ratio wide; drawn finely, twice that.
  const fine = await page.evaluate(() => 612 * (96 / 72) * devicePixelRatio * 2);
  const fineCount = () =>
    page.evaluate((width) => [...document.querySelectorAll("canvas[aria-label^='Page ']")].filter((canvas) => canvas instanceof HTMLCanvasElement && canvas.width >= width).length, fine);

  for (let number = 1; number <= 9; number++) {
    await page.locator(`#page-${number}`).scrollIntoViewIfNeeded();
    await expect.poll(() => page.getByRole("img", { name: `Page ${number}` }).evaluate((canvas) => (canvas instanceof HTMLCanvasElement ? canvas.width : 0))).toBe(fine);
  }
  expect(await fineCount()).toBeLessThanOrEqual(6);

  await page.locator("#page-1").scrollIntoViewIfNeeded();
  await expect.poll(() => page.getByRole("img", { name: "Page 1" }).evaluate((canvas) => (canvas instanceof HTMLCanvasElement ? canvas.width : 0))).toBe(fine);
});
