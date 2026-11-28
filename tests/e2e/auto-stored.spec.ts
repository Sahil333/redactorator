// A findings review is stored in the reader folder: it survives a reload and a duplicate, a later
// run offers nothing already marked or rejected, a reader change or a text change drops it with a
// notice, and a file this build can't read is left alone (docs/designs/auto-mode.md, slice R2).
import { expect, type Locator, type Page } from "@playwright/test";
import {
  documentId,
  fixturePath,
  marks,
  openApp,
  openPdf,
  saved,
  show,
  storedJson,
  storedText,
  storeUnderOlderReader,
  writeStored,
} from "./app";
import { chooseProfile, findingRows, findingsPanel, runButton } from "./auto";
import { test } from "./coverage";
import { failWrites, holdWrites } from "./fakes";

const pagesPdf = fixturePath("fixtures/auto-pages.pdf");
const cardPdf = fixturePath("fixtures/auto-card.pdf");

// auto-pages.pdf's cards, on pages 1, 5 and 12 (tests/oracle/README.md).
const pageCards = ["4666 6666 6666 6669", "4777 7777 7777 7778", "4888 8888 8888 8887"] as const;
const [, middleCard] = pageCards;

const readerChanged =
  "The found values of this document were dropped, because an update changed how the app reads PDFs. Your unticks and edits were not kept. Run Auto mode to find them again.";
const textChanged = "The found values of this document were dropped, because its text changed. Run Auto mode to find them again.";

type FindingsFile = "hits" | "state" | "run";

/** A document's findings file in its project's reader folder. */
const findingsFile = (folder: string, document: string, file: FindingsFile) => `${folder}/.redactorator/pdf-3/findings/${document}.${file}.json`;

const droppedNotice = (page: Page): Locator => page.getByRole("region", { name: "Found values dropped" });

const marksPanel = (page: Page): Locator => page.getByRole("complementary", { name: "Marks" });

const rowOf = (page: Page, text: string): Locator => findingRows(page).filter({ has: page.getByText(text, { exact: true }) });

const field = (json: unknown, name: string): unknown => (typeof json === "object" && json !== null ? Reflect.get(json, name) : undefined);

/** The id of the run that a document's stored run record holds. */
async function storedRun(page: Page, folder: string, document: string): Promise<unknown> {
  return field(await storedJson(page, findingsFile(folder, document, "run")), "run");
}

/** Runs Auto mode on the open document and waits for `rows` found values. */
async function runAuto(page: Page, rows: number): Promise<void> {
  await runButton(page).click();
  await expect(findingRows(page)).toHaveCount(rows);
}

/** Leaves the open project for the list of projects, which closes it. */
async function goHome(page: Page): Promise<void> {
  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Projects" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
}

const openProject = (page: Page, name: string) => page.getByRole("button", { name, exact: true }).click();

async function rowAction(page: Page, project: string, action: string): Promise<void> {
  await page.getByRole("button", { name: `Actions for ${project}` }).click();
  await page.getByRole("menuitem", { name: action }).click();
}

/** A run on auto-pages.pdf with nothing chosen, with the middle card unticked, all stored. */
async function reviewWithOneUntick(page: Page): Promise<void> {
  await openApp(page);
  await openPdf(page, pagesPdf);
  await chooseProfile(page, []);
  await runAuto(page, 3);
  await rowOf(page, middleCard).getByRole("checkbox").uncheck();
  await saved(page);
}

async function sameReviewWithOneUntick(page: Page): Promise<void> {
  await expect(findingRows(page)).toHaveCount(3);
  for (const card of pageCards) await expect(rowOf(page, card).getByRole("checkbox")).toBeChecked({ checked: card !== middleCard });
}

test("a reload brings back the same findings and unticks, and runs nothing; the saving indicator waits for each change to be stored", async ({ page }) => {
  await openApp(page);
  await openPdf(page, pagesPdf);
  await chooseProfile(page, []);
  await runAuto(page, 3);
  await saved(page);
  const document = await documentId(page, "auto-pages", "auto-pages.pdf");
  const run = await storedRun(page, "auto-pages", document);

  const release = await holdWrites(page, `${document}.state.json`);
  await rowOf(page, middleCard).getByRole("checkbox").uncheck();
  await expect(page.getByRole("banner").getByText("Saving…")).toBeVisible();
  await release();
  await saved(page);

  await page.reload();
  await sameReviewWithOneUntick(page);
  await expect(marks(page)).toHaveCount(0);
  expect(await storedRun(page, "auto-pages", document)).toEqual(run);
});

test("after a confirm and a reload, a later run offers none of the marked or rejected values; the run record stays and holds no value", async ({ page }) => {
  await reviewWithOneUntick(page);
  const document = await documentId(page, "auto-pages", "auto-pages.pdf");
  await findingsPanel(page).getByRole("button", { name: "Mark 2 values for removal" }).click();
  await page.getByRole("dialog", { name: "Mark 2 values for removal?" }).getByRole("button", { name: "Confirm" }).click();
  await expect(marks(page)).toHaveCount(2);
  await saved(page);
  expect(await storedText(page, findingsFile("auto-pages", document, "hits"))).toBeUndefined();
  expect(await storedText(page, findingsFile("auto-pages", document, "state"))).toBeUndefined();

  const record = await storedText(page, findingsFile("auto-pages", document, "run"));
  expect(JSON.parse(record ?? "null")).toMatchObject({ format: "redactorator-run", version: 1, ended: "finished", pages: 12, notSearched: [], errors: 0 });
  for (const card of pageCards) {
    expect(record).not.toContain(card);
    expect(record).not.toContain(card.replaceAll(" ", ""));
  }
  expect(record).not.toContain("Statement");

  await page.reload();
  await expect(marks(page)).toHaveCount(2);
  await runButton(page).click();
  await expect(page.getByRole("banner")).toContainText("Auto mode found nothing new in this document.");
  await expect(findingsPanel(page)).toHaveCount(0);
});

test("a reader change drops each findings review with a notice: its Run starts a run, Dismiss removes it, and neither comes back after a reload", async ({ page }) => {
  await openApp(page);
  await openPdf(page, pagesPdf, cardPdf);
  await chooseProfile(page, []);
  await show(page, "auto-pages.pdf");
  await runAuto(page, 3);
  await show(page, "auto-card.pdf");
  await runAuto(page, 1);
  await saved(page);
  // Named after the first of its files by name.
  const pages = await documentId(page, "auto-card", "auto-pages.pdf");
  await goHome(page);
  await storeUnderOlderReader(page, "auto-card");

  await openProject(page, "auto-card");
  await show(page, "auto-pages.pdf");
  await expect(droppedNotice(page)).toHaveText(new RegExp(readerChanged.replaceAll(".", "\\.")));
  await expect(findingsPanel(page)).toHaveCount(0);
  await expect(marksPanel(page)).toBeVisible();
  expect(await storedText(page, findingsFile("auto-card", pages, "hits"))).toBeUndefined();
  await droppedNotice(page).getByRole("button", { name: "Dismiss" }).click();
  await expect(droppedNotice(page)).toHaveCount(0);

  await show(page, "auto-card.pdf");
  await expect(droppedNotice(page)).toContainText(readerChanged);
  await droppedNotice(page).getByRole("button", { name: "Run Auto mode" }).click();
  await expect(findingRows(page)).toHaveCount(1);
  await expect(droppedNotice(page)).toHaveCount(0);
  await saved(page);

  await page.reload();
  await show(page, "auto-pages.pdf");
  await expect(marksPanel(page)).toBeVisible();
  await expect(droppedNotice(page)).toHaveCount(0);
  await show(page, "auto-card.pdf");
  await expect(findingRows(page)).toHaveCount(1);
  await expect(droppedNotice(page)).toHaveCount(0);
});

test("a project renamed after a reader change still shows the notice when its document is opened, and no run has started", async ({ page }) => {
  await openApp(page);
  await openPdf(page, cardPdf);
  await chooseProfile(page, []);
  await runAuto(page, 1);
  await saved(page);
  const document = await documentId(page, "auto-card", "auto-card.pdf");
  await goHome(page);
  await storeUnderOlderReader(page, "auto-card");

  await rowAction(page, "auto-card", "Rename");
  await page.getByRole("textbox", { name: "Project name" }).fill("Statements");
  await page.getByRole("textbox", { name: "Project name" }).press("Enter");
  await openProject(page, "Statements");

  await expect(droppedNotice(page)).toContainText(readerChanged);
  await expect(findingsPanel(page)).toHaveCount(0);
  expect(await storedText(page, findingsFile("auto-card", document, "run"))).toBeUndefined();
  expect(field(await storedJson(page, findingsFile("auto-card", document, "state")), "kind")).toBe("dropped");

  await droppedNotice(page).getByRole("button", { name: "Dismiss" }).click();
  await expect(droppedNotice(page)).toHaveCount(0);
  await expect(marksPanel(page).getByRole("heading", { name: "Marks" })).toBeFocused();
  await saved(page);
  expect(await storedText(page, findingsFile("auto-card", document, "state"))).toBeUndefined();
});

test("a duplicate of a project with an open findings review shows the same findings and unticks", async ({ page }) => {
  await reviewWithOneUntick(page);
  await goHome(page);
  await rowAction(page, "auto-pages", "Duplicate");
  await openProject(page, "auto-pages (copy)");

  await sameReviewWithOneUntick(page);
});

test("a stored hit whose text no longer reads at its place drops the findings review with the text-changed notice", async ({ page }) => {
  await openApp(page);
  await openPdf(page, cardPdf);
  await chooseProfile(page, []);
  await runAuto(page, 1);
  await saved(page);
  const document = await documentId(page, "auto-card", "auto-card.pdf");
  await goHome(page);
  const hitsFile = findingsFile("auto-card", document, "hits");
  const stored = (await storedText(page, hitsFile)) ?? "";
  expect(stored).toContain('"text":"4111 1111 1111 1111"');
  await writeStored(page, hitsFile, stored.replace('"text":"4111 1111 1111 1111"', '"text":"4111 1111 1111 1119"'));

  await openProject(page, "auto-card");
  await expect(droppedNotice(page)).toContainText(textChanged);
  await expect(findingsPanel(page)).toHaveCount(0);
  await saved(page);
  expect(await storedText(page, hitsFile)).toBeUndefined();
  expect(await storedJson(page, findingsFile("auto-card", document, "state"))).toMatchObject({ kind: "dropped", reason: "text-changed" });

  await droppedNotice(page).getByRole("button", { name: "Run Auto mode" }).click();
  await expect(findingRows(page)).toHaveCount(1);
});

test("a stored hits file that is not JSON is left alone, and the document has no findings review", async ({ page }) => {
  await openApp(page);
  await openPdf(page, cardPdf);
  await chooseProfile(page, []);
  await runAuto(page, 1);
  await saved(page);
  const document = await documentId(page, "auto-card", "auto-card.pdf");
  await goHome(page);
  const hitsFile = findingsFile("auto-card", document, "hits");
  await writeStored(page, hitsFile, "not JSON");

  await openProject(page, "auto-card");
  await expect(marksPanel(page)).toBeVisible();
  await expect(findingsPanel(page)).toHaveCount(0);
  await expect(droppedNotice(page)).toHaveCount(0);
  await saved(page);
  expect(await storedText(page, hitsFile)).toBe("not JSON");
});

test("a confirm whose save fails deletes nothing: after a reload the findings review is back with its unticks", async ({ page }) => {
  await reviewWithOneUntick(page);
  const document = await documentId(page, "auto-pages", "auto-pages.pdf");
  await failWrites(page);
  await findingsPanel(page).getByRole("button", { name: "Mark 2 values for removal" }).click();
  await page.getByRole("dialog", { name: "Mark 2 values for removal?" }).getByRole("button", { name: "Confirm" }).click();

  await expect(page.getByRole("alert")).toContainText("Your latest changes could not be saved.");
  expect(await storedText(page, findingsFile("auto-pages", document, "hits"))).toBeDefined();

  await page.reload();
  await sameReviewWithOneUntick(page);
  await expect(marks(page)).toHaveCount(0);
});
