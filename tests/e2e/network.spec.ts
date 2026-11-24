import { expect } from "@playwright/test";
import { test } from "./coverage";
import { inkedPixels, openApp, openPdf, twoPagePdf } from "./app";
import { connectionsMade } from "./fakes";
import { goldenSession } from "./goldenSession";

// The same server under another origin: reachable, so only the policy can stop a request to it.
const otherOrigin = "http://localhost:4173/";

test("every request in a session goes to the app's own origin", async ({ page, context, baseURL }) => {
  const requested: string[] = [];
  context.on("request", (request) => requested.push(request.url()));

  await openApp(page);
  await openPdf(page, twoPagePdf);
  await expect.poll(() => inkedPixels(page.getByRole("img", { name: "Page 1" }))).toBeGreaterThan(0);

  const appOrigin = new URL(baseURL ?? "").origin;
  // The engine worker fetches the WebAssembly file, so seeing it shows worker traffic is recorded too.
  expect(requested.some((url) => url.endsWith(".wasm"))).toBe(true);
  expect(requested.filter((url) => new URL(url).origin !== appOrigin)).toEqual([]);
});

test("a whole session opens no WebSocket or EventSource, in the page or the PDF worker", async ({ page }) => {
  const connections = await connectionsMade(page);

  await goldenSession(page);

  expect(connections()).toEqual([]);
});

test("a PDF opens and renders with the network off", async ({ page, context }) => {
  await openApp(page);
  await context.setOffline(true);

  await openPdf(page, twoPagePdf);

  await expect(page.getByRole("status")).toHaveText("Page 1 of 2");
  await expect.poll(() => inkedPixels(page.getByRole("img", { name: "Page 1" }))).toBeGreaterThan(500);
});

test("the content security policy blocks requests to other origins from the page and the worker", async ({
  page,
  context,
}) => {
  const fetchOtherOrigin = (url: string) =>
    fetch(url, { mode: "no-cors" }).then(
      () => "sent",
      () => "blocked",
    );

  const control = await context.newPage();
  expect(await control.evaluate(fetchOtherOrigin, otherOrigin)).toBe("sent");

  await openApp(page);
  expect(await page.evaluate(fetchOtherOrigin, otherOrigin)).toBe("blocked");
  const engine = page.workers().find((worker) => new URL(worker.url()).pathname.startsWith("/assets/worker-"));
  expect(engine).toBeDefined();
  expect(await engine?.evaluate(fetchOtherOrigin, otherOrigin)).toBe("blocked");
});

test("the app's typeface is bundled with it and loads from its own origin", async ({ page }) => {
  const fonts: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "font") fonts.push(request.url());
  });
  await openApp(page);

  await expect
    .poll(() =>
      page.evaluate(() => [...document.fonts].some((font) => font.family.includes("Atkinson Hyperlegible Next") && font.status === "loaded")),
    )
    .toBe(true);
  expect(fonts.length).toBeGreaterThan(0);
  expect(fonts.every((url) => new URL(url).origin === new URL(page.url()).origin)).toBe(true);
});
