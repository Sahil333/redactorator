// The entries in tests/oracle/leak-vectors.json. One that makes a mark is one test: the fixture is
// added, marked, written and judged. Those that make none are what preparation alone must clean,
// so each fixture's are one test that judges the working copy preparation stored: what the app
// shows, marks and writes from, and what a document with no marks downloads as. Each also checks
// that preparing it recorded the entry's kind, which the app reports as removed.
import { basename } from "node:path";
import { expect, type Page } from "@playwright/test";
import vectors from "../oracle/leak-vectors.json" with { type: "json" };
import { applyAndDownload, drawBox, fixturePath, markText, openApp, openPdf, removedKinds, saved, workingCopy, type PointBox } from "./app";
import { test } from "./coverage";
import { judgeListed } from "./oracle";

function pointBox(values: readonly number[]): PointBox {
  const [x0, y0, x1, y1, ...rest] = values;
  if (x0 === undefined || y0 === undefined || x1 === undefined || y1 === undefined || rest.length > 0) {
    throw new Error(`a mark's box needs four numbers, not [${values.join(", ")}]`);
  }
  return [x0, y0, x1, y1];
}

for (const vector of vectors) {
  const { mark, markType } = vector;
  if (mark === null || markType === null) continue;
  test(`${vector.id}: ${vector.howItLeaks}`, async ({ page }) => {
    const fixture = fixturePath(vector.fixture);
    await openApp(page);
    await openPdf(page, fixture);
    if ("select" in mark) await markText(page, mark.page, pointBox(mark.select), markType);
    else await drawBox(page, mark.page, pointBox(mark.box), markType);

    const output = await applyAndDownload(page);
    await judgeListed(fixture, output, vector.checks);
  });
}

const unmarked = Map.groupBy(
  vectors.filter((vector) => vector.mark === null),
  (vector) => vector.fixture,
);

for (const [fixture, entries] of unmarked) {
  test(`preparing ${fixture} cleans it: ${entries.map((entry) => entry.id).join(", ")}`, async ({ page }) => {
    const path = fixturePath(fixture);
    await openApp(page);
    await openPdf(page, path);
    await saved(page);
    const file = basename(path);
    const folder = file.replace(/\.pdf$/, "");
    const working = await workingCopy(page, folder, file);
    const kinds = await removedKinds(page, folder, file);
    for (const entry of entries) {
      await test.step(entry.id, async () => {
        await judgeListed(path, working, entry.checks);
        if (entry.kind !== null) expect(kinds).toContain(entry.kind);
      });
    }
  });
}

/** Dark pixels drawn inside `box` (points, origin top-left) on page `pageNumber`'s canvas. */
async function inkedIn(page: Page, pageNumber: number, [x0, y0, x1, y1]: PointBox): Promise<number> {
  return page.getByRole("img", { name: `Page ${pageNumber}` }).evaluate((canvas, box) => {
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("not a canvas");
    // The page is drawn at its printed size (96/72 CSS pixels a point) at the screen's pixel ratio.
    const scale = devicePixelRatio * (96 / 72);
    const [left, top] = [Math.floor(box.x0 * scale), Math.floor(box.y0 * scale)];
    const { data } = canvas.getContext("2d")?.getImageData(left, top, Math.ceil((box.x1 - box.x0) * scale), Math.ceil((box.y1 - box.y0) * scale)) ?? { data: [] };
    let inked = 0;
    for (let i = 0; i < data.length; i += 4) if ((data[i] ?? 255) < 128 && (data[i + 3] ?? 0) > 128) inked++;
    return inked;
  }, { x0, y0, x1, y1 });
}

// layer-rules.pdf's page 2: "Page two" on no layer, and below it a line on a /P /AllOn rule
// whose layers are not all on (tests/oracle/README.md).
const pageTwo: PointBox = [72, 39.1, 120, 55.6];
const allOnLine: PointBox = [72, 79.1, 197.4, 95.6];

test("content on a layer rule that is not met (/AllOn with a layer off) is not drawn", async ({ page }) => {
  await openApp(page);
  await openPdf(page, fixturePath("fixtures/layer-rules.pdf"));
  await page.locator("#page-2").scrollIntoViewIfNeeded();
  await expect.poll(() => inkedIn(page, 2, pageTwo)).toBeGreaterThan(50);
  expect(await inkedIn(page, 2, allOnLine)).toBe(0);
});
