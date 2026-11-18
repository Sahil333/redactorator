import { expect, test } from "@playwright/test";
import { inkedPixels, openApp, openPdf, twoPagePdf } from "./app";

// The same server under another origin: reachable, so only the policy can stop a request to it.
const otherOrigin = "http://localhost:4173/";

test("every request in a session goes to the app's own origin", async ({ page, context, baseURL }) => {
  const requested: string[] = [];
  context.on("request", (request) => requested.push(request.url()));

  await openApp(page);
  await openPdf(page, twoPagePdf);
  await expect.poll(() => inkedPixels(page)).toBeGreaterThan(0);

  const appOrigin = new URL(baseURL ?? "").origin;
  expect(requested.length).toBeGreaterThan(0);
  expect(requested.filter((url) => new URL(url).origin !== appOrigin)).toEqual([]);
});

test("a PDF opens and renders with the network off", async ({ page, context }) => {
  await openApp(page);
  await context.setOffline(true);

  await openPdf(page, twoPagePdf);

  await expect(page.getByRole("status")).toHaveText("Page 1 of 2");
  await expect.poll(() => inkedPixels(page)).toBeGreaterThan(500);
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
  const [engine] = page.workers();
  expect(engine).toBeDefined();
  expect(await engine?.evaluate(fetchOtherOrigin, otherOrigin)).toBe("blocked");
});
