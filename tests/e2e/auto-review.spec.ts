// A findings review ends in marks: Confirm marks the ticked values and rejects the unticked ones,
// one undo takes the marks back, Close keeps nothing, and approving is a separate act
// (docs/designs/auto-mode.md, slice R1). Every download is judged by the outside checker.
import { copyFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";
import {
  applyAndDownload,
  approve,
  approveButton,
  fixturePath,
  inExplorer,
  marks,
  markText,
  openApp,
  openPdf,
  printTypes,
  saved,
  show,
  storedJson,
  type PointBox,
} from "./app";
import { chooseProfile, findingOf, findingRows, findingsPanel, runButton } from "./auto";
import { test } from "./coverage";
import { fakeDetection, type DetectionWorkerScope } from "./fakes";
import { judge } from "./oracle";

const cardPdf = fixturePath("fixtures/auto-card.pdf");
const offsetPdf = fixturePath("fixtures/auto-offset.pdf");
const shapesPdf = fixturePath("fixtures/auto-shapes.pdf");
const pagesPdf = fixturePath("fixtures/auto-pages.pdf");

const card = "4111 1111 1111 1111";
const nearMiss = "4111 1111 1111 1112";
// auto-pages.pdf's cards, on pages 1, 5 and 12 (tests/oracle/README.md).
const pageCards = ["4666 6666 6666 6669", "4777 7777 7777 7778", "4888 8888 8888 8887"] as const;
const [firstCard, middleCard, lastCard] = pageCards;
const middleKey = "4777777777777778";
// auto-shapes.pdf: two cards that touch on page 1, one across a line end there, and 300 on page 2.
const touching = ["4222222222222220", "4555555555555550"] as const;
const acrossLines = ["4333 3333", "3333 3339"] as const;
const hundreds = Array.from({ length: 300 }, (_, at) => {
  const body = `4${String(at + 1).padStart(14, "0")}`;
  return `${body}${luhnDigit(body)}`;
});

// auto-card.pdf's line "Card number 4111 1111 1111 1111" is at x 72, y 670, in 12 pt Helvetica, so
// the card number runs from x 145.4 to 262.1, and its first eight digits end at x 202.1.
const wholeCard: PointBox = [145.4, 109.1, 262.1, 125.6];
const cardStart: PointBox = [145.4, 109.1, 202.1, 125.6];

const projectFile = (folder: string) => `${folder}/.redactorator/pdf-3/project.json`;

/** The check digit that makes `body` pass the Luhn check, as the fixture generator makes it. */
function luhnDigit(body: string): number {
  const sum = [...body].reverse().reduce((total, digit, at) => {
    const doubled = Number(digit) * (at % 2 === 0 ? 2 : 1);
    return total + (doubled > 9 ? doubled - 9 : doubled);
  }, 0);
  return (10 - (sum % 10)) % 10;
}

const confirmButton = (page: Page): Locator => findingsPanel(page).getByRole("button", { name: /^(Mark|Keep all) / });

const rowOf = (page: Page, text: string): Locator => findingRows(page).filter({ has: page.getByText(text, { exact: true }) });

/** Runs Auto mode on the open document with no country or industry chosen, and waits for `rows` found values. */
async function runAuto(page: Page, rows: number): Promise<void> {
  await runButton(page).click();
  await expect(findingRows(page)).toHaveCount(rows);
}

/** Presses the confirm button and agrees to its dialog, which must be titled `title`. */
async function confirmFindings(page: Page, title: string): Promise<void> {
  await confirmButton(page).click();
  const dialog = page.getByRole("dialog", { name: title });
  await dialog.getByRole("button", { name: "Confirm" }).click();
  await expect(findingsPanel(page)).toHaveCount(0);
}

/** A stored document's field, from the project file the Session last saved. */
async function storedField(page: Page, folder: string, field: "rejected" | "shown"): Promise<unknown> {
  await saved(page);
  const project = await storedJson(page, projectFile(folder));
  const documents = typeof project === "object" && project !== null ? Reflect.get(project, "documents") : undefined;
  const [document] = Array.isArray(documents) ? documents : [];
  return typeof document === "object" && document !== null ? Reflect.get(document, field) : undefined;
}

/** Downloads the cleaned file twice, without and then with each mark's type printed in its box, and has the outside checker judge both. */
async function judgedWithAndWithoutTypes(page: Page, input: string, checks: Parameters<typeof judge>[2]): Promise<void> {
  await judge(input, await applyAndDownload(page), checks);
  await page.getByRole("button", { name: "Back to editing" }).click();
  await printTypes(page);
  await judge(input, await applyAndDownload(page), checks);
}

/**
 * A detection worker that answers each page with prepared hits: on auto-card.pdf, "Card number
 * 4111 1111" as a US bank account and the card number as a payment card, which overlap.
 */
function overlappingHits(scope: DetectionWorkerScope, acted: () => void) {
  scope.addEventListener("message", ({ data }) => {
    if (data.type === "load") {
      scope.postMessage({ type: "ready", run: data.run, packs: data.packs.map((id) => ({ id, version: "000000000000" })) });
      return;
    }
    acted();
    const text = data.chars.join("");
    const hit = (value: string, identifier: string) => {
      const start = text.indexOf(value);
      const evidence = [{ kind: "checksum" as const, level: "checked" as const }];
      return { page: data.page, start, end: start + value.length, text: value, identifier, evidence, rule: "prepared", recognizer: "prepared" };
    };
    const hits = [hit("Card number 4111 1111", "us-bank-account"), hit("4111 1111 1111 1111", "payment-card")];
    scope.postMessage({ type: "hits", run: data.run, page: data.page, hits, errors: 0 });
  });
}

/**
 * A detection worker that answers with hits no regular expression made: two from a model whose
 * edges fall inside words, weakest evidence first, and the card number checked.
 */
function modelHits(scope: DetectionWorkerScope, acted: () => void) {
  scope.addEventListener("message", ({ data }) => {
    if (data.type === "load") {
      scope.postMessage({ type: "ready", run: data.run, packs: data.packs.map((id) => ({ id, version: "000000000000" })) });
      return;
    }
    acted();
    const text = data.chars.join("");
    const hit = (value: string, identifier: string, kind: "model" | "checksum", level: "checked" | "labelled" | "format") => {
      const start = text.indexOf(value);
      return { page: data.page, start, end: start + value.length, text: value, identifier, evidence: [{ kind, level }], rule: "prepared", recognizer: "model" };
    };
    const hits = [hit("ement f", "person", "model", "format"), hit("ne 20", "date-of-birth", "model", "labelled"), hit("4111 1111 1111 1111", "payment-card", "checksum", "checked")];
    scope.postMessage({ type: "hits", run: data.run, page: data.page, hits, errors: 0 });
  });
}

/** A detection worker that answers page 1 of auto-shapes.pdf with the card number that runs across its line end, as one hit. */
function acrossLineHit(scope: DetectionWorkerScope, acted: () => void) {
  scope.addEventListener("message", ({ data }) => {
    if (data.type === "load") {
      scope.postMessage({ type: "ready", run: data.run, packs: data.packs.map((id) => ({ id, version: "000000000000" })) });
      return;
    }
    const text = data.chars.join("");
    const start = text.indexOf("4333 3333");
    const end = text.indexOf("3333 3339") + "3333 3339".length;
    const found = start === -1 ? [] : [{ page: data.page, start, end, text: "4333 3333 3333 3339", identifier: "payment-card", evidence: [{ kind: "checksum" as const, level: "checked" as const }], rule: "prepared", recognizer: "prepared" }];
    if (found.length > 0) acted();
    scope.postMessage({ type: "hits", run: data.run, page: data.page, hits: found, errors: 0 });
  });
}

test("confirm marks every place of each ticked value with its identifier, after a dialog that counts both; a later run offers neither again", async ({ page }) => {
  await openApp(page);
  await openPdf(page, pagesPdf);
  await chooseProfile(page, []);
  await runAuto(page, 3);

  await rowOf(page, middleCard).getByRole("checkbox").uncheck();
  await expect(confirmButton(page)).toHaveText("Mark 2 values for removal");
  await confirmButton(page).click();
  const dialog = page.getByRole("dialog", { name: "Mark 2 values for removal?" });
  await expect(dialog).toContainText("1 unticked value stays in the file and will not be offered again in this document.");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(findingRows(page)).toHaveCount(3);
  await expect(rowOf(page, middleCard).getByRole("checkbox")).not.toBeChecked();

  await confirmFindings(page, "Mark 2 values for removal?");

  await expect(marks(page)).toHaveText([new RegExp(`${firstCard}.*Payment card`), new RegExp(`${lastCard}.*Payment card`)]);
  for (const tool of await page.getByRole("group", { name: "Tool" }).getByRole("button").all()) await expect(tool).toBeEnabled();
  expect(await storedField(page, "auto-pages", "rejected")).toEqual([middleKey]);
  const output = await applyAndDownload(page);
  await judge(pagesPdf, output, [{ check: "absent", values: [firstCard, lastCard] }, { check: "kept", values: [middleCard] }, { check: "structure" }]);
  await page.getByRole("button", { name: "Back to editing" }).click();

  await runButton(page).click();
  await expect(page.getByRole("banner")).toContainText("Auto mode found nothing new in this document.");
  await expect(findingsPanel(page)).toHaveCount(0);
});

test("a value a hand mark covers in part is offered, and confirming adds its own mark beside the hand mark", async ({ page }) => {
  await openApp(page);
  await openPdf(page, cardPdf);
  await chooseProfile(page, []);
  await markText(page, 1, cardStart, "Other");
  await expect(marks(page)).toHaveText([/4111 1111.*Other/]);

  await runAuto(page, 1);
  expect(await findingOf(findingRows(page).first())).toEqual({ text: card, identifier: "payment-card", places: 1 });
  await confirmFindings(page, "Mark 1 value for removal?");

  await expect(marks(page)).toHaveCount(2);
  await judgedWithAndWithoutTypes(page, cardPdf, [{ check: "absent", values: [card] }, { check: "kept", values: [nearMiss] }, { check: "structure" }]);
});

test("two prepared hits that overlap are two rows, and confirming makes two overlapping marks that the writer removes, with and without types printed", async ({ page }) => {
  await fakeDetection(page, overlappingHits);
  await openApp(page);
  await openPdf(page, cardPdf);
  await chooseProfile(page, []);
  await runAuto(page, 2);
  for (const row of await findingRows(page).all()) await expect(row.getByRole("checkbox")).toBeChecked();

  await confirmFindings(page, "Mark 2 values for removal?");

  await expect(marks(page)).toHaveText([/Card number 4111 1111.*Bank account/, new RegExp(`${card}.*Payment card`)]);
  await judgedWithAndWithoutTypes(page, cardPdf, [
    { check: "absent", values: ["Card number", card] },
    { check: "kept", values: [nearMiss, "Statement for June 2026"] },
    { check: "structure" },
  ]);
});

test("hits no regular expression made, with edges inside words, are listed strongest evidence first, accepted and removed", async ({ page }) => {
  await fakeDetection(page, modelHits);
  await openApp(page);
  await openPdf(page, cardPdf);
  await chooseProfile(page, []);
  await runAuto(page, 3);

  expect(await Promise.all((await findingRows(page).all()).map(findingOf))).toEqual([
    { text: card, identifier: "payment-card", places: 1 },
    { text: "ne 20", identifier: "date-of-birth", places: 1 },
    { text: "ement f", identifier: "person", places: 1 },
  ]);
  await expect(rowOf(page, "ement f")).toContainText("found by a model");

  await confirmFindings(page, "Mark 3 values for removal?");

  await expect(marks(page)).toHaveCount(3);
  const output = await applyAndDownload(page);
  await judge(cardPdf, output, [
    { check: "absent", values: ["ement f", "ne 20", card] },
    { check: "kept", values: ["Stat", "or Ju", "26", nearMiss] },
    { check: "structure" },
  ]);
});

test("a value on the Don't hide here list is offered ticked, and confirming marks it and takes it off that list", async ({ page }) => {
  await openApp(page);
  await openPdf(page, cardPdf);
  await chooseProfile(page, []);
  await markText(page, 1, wholeCard, "Payment card");
  await approve(page, undefined);
  await page.getByRole("button", { name: `Don't hide ${card} on page 1 here` }).click();
  await expect(marks(page)).toHaveCount(0);
  expect(await storedField(page, "auto-card", "shown")).toEqual(["4111111111111111"]);

  await runAuto(page, 1);
  await expect(findingRows(page).first().getByRole("checkbox")).toBeChecked();
  await confirmFindings(page, "Mark 1 value for removal?");

  await expect(marks(page)).toHaveText([new RegExp(`${card}.*Payment card`)]);
  expect(await storedField(page, "auto-card", "shown")).toEqual([]);
});

test("one undo, after a dialog, removes every mark the confirm made; the rejected value stays rejected; redo and undo again ask again", async ({ page }) => {
  await openApp(page);
  await openPdf(page, pagesPdf);
  await chooseProfile(page, []);
  await runAuto(page, 3);
  await rowOf(page, middleCard).getByRole("checkbox").uncheck();
  await confirmFindings(page, "Mark 2 values for removal?");
  await expect(marks(page)).toHaveCount(2);

  const undo = page.getByRole("button", { name: "Undo" });
  const asking = page.getByRole("dialog", { name: "Remove the 2 marks Auto mode made for 2 values?" });
  await undo.click();
  await asking.getByRole("button", { name: "Cancel" }).click();
  await expect(asking).toHaveCount(0);
  await expect(marks(page)).toHaveCount(2);

  await page.keyboard.press("ControlOrMeta+z");
  await asking.getByRole("button", { name: "Remove marks" }).click();
  await expect(marks(page)).toHaveCount(0);
  expect(await storedField(page, "auto-pages", "rejected")).toEqual([middleKey]);

  await page.getByRole("button", { name: "Redo" }).click();
  await expect(marks(page)).toHaveCount(2);
  await undo.click();
  await expect(asking).toBeVisible();
  await asking.getByRole("button", { name: "Remove marks" }).click();
  await expect(marks(page)).toHaveCount(0);
});

test("while the undo dialog asks, the undo and redo keys do nothing behind it", async ({ page }) => {
  // auto-pages.pdf's "Statement page 1" is at x 72, y 700, in 12 pt Helvetica: "Statement" ends at x 126.7.
  const statement: PointBox = [72, 79.1, 126.7, 95.6];
  await openApp(page);
  await openPdf(page, pagesPdf);
  await chooseProfile(page, []);
  await runAuto(page, 3);
  await confirmFindings(page, "Mark 3 values for removal?");
  await markText(page, 1, statement, "Other");
  await expect(marks(page)).toHaveCount(4);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(marks(page)).toHaveCount(3);

  await page.keyboard.press("ControlOrMeta+z");
  const asking = page.getByRole("dialog", { name: "Remove the 3 marks Auto mode made for 3 values?" });
  await expect(asking).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await asking.getByRole("button", { name: "Remove marks" }).click();

  await expect(marks(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(marks(page)).toHaveCount(3);
});

test("approving with the findings panel open warns of the values not marked, leaves the panel open, and confirming later puts the document back in review", async ({ page }) => {
  await openApp(page);
  await openPdf(page, cardPdf);
  await chooseProfile(page, []);
  await runAuto(page, 1);

  await approveButton(page).click();
  const approval = page.getByRole("dialog", { name: /^Approve/ });
  await expect(approval).toContainText("1 found value is not marked and stays in the file.");
  await approval.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("banner").getByText("Approved", { exact: true })).toBeVisible();
  await expect(findingRows(page)).toHaveCount(1);
  await expect(inExplorer(page, "auto-card.pdf")).toContainText("Approved");

  await confirmFindings(page, "Mark 1 value for removal?");

  await expect(inExplorer(page, "auto-card.pdf")).toContainText("In review");
  await expect(marks(page)).toHaveCount(1);
});

test("approving another document that marks the only found value ends the findings review by itself", async ({ page }) => {
  const copy = join(await mkdtemp(join(tmpdir(), "auto-copy-")), "card-copy.pdf");
  await copyFile(cardPdf, copy);
  await openApp(page);
  await openPdf(page, cardPdf, copy);
  await chooseProfile(page, []);
  await show(page, "card-copy.pdf");
  await markText(page, 1, wholeCard, "Payment card");
  await show(page, "auto-card.pdf");
  await runAuto(page, 1);

  await show(page, "card-copy.pdf");
  await approveButton(page).click();
  const approval = page.getByRole("dialog", { name: /^Approve/ });
  await expect(approval).toContainText("hides 1 place in auto-card.pdf");
  await approval.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("banner").getByText("Approved", { exact: true })).toBeVisible();

  await show(page, "auto-card.pdf");
  await expect(findingsPanel(page)).toHaveCount(0);
  await expect(marks(page)).toHaveText([new RegExp(card)]);
});

test("Close, after a dialog, ends the findings review and keeps nothing: a later run offers the value again, ticked", async ({ page }) => {
  await openApp(page);
  await openPdf(page, cardPdf);
  await chooseProfile(page, []);
  await runAuto(page, 1);
  await findingRows(page).first().getByRole("checkbox").uncheck();
  await expect(confirmButton(page)).toHaveText("Keep all 1 value in the file");

  await findingsPanel(page).getByRole("button", { name: "Close" }).click();
  const dialog = page.getByRole("dialog", { name: "Close without marking?" });
  await expect(dialog).toContainText("1 found value stays in the file. Your unticks and edits will not be kept.");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(findingRows(page)).toHaveCount(1);
  await findingsPanel(page).getByRole("button", { name: "Close" }).click();
  await dialog.getByRole("button", { name: "Close" }).click();

  await expect(findingsPanel(page)).toHaveCount(0);
  await expect(marks(page)).toHaveCount(0);
  for (const tool of await page.getByRole("group", { name: "Tool" }).getByRole("button").all()) await expect(tool).toBeEnabled();
  expect(await storedField(page, "auto-card", "rejected")).toEqual([]);
  await runAuto(page, 1);
  await expect(findingRows(page).first().getByRole("checkbox")).toBeChecked();
});

test("a confirm with nothing ticked only rejects: no mark, no undo step, and the review state stays", async ({ page }) => {
  await openApp(page);
  await openPdf(page, cardPdf);
  await chooseProfile(page, []);
  await runAuto(page, 1);
  await findingRows(page).first().getByRole("checkbox").uncheck();

  await confirmButton(page).click();
  const dialog = page.getByRole("dialog", { name: "Keep all 1 value in the file?" });
  await expect(dialog).toContainText("1 unticked value stays in the file and will not be offered again in this document.");
  await dialog.getByRole("button", { name: "Confirm" }).click();

  await expect(findingsPanel(page)).toHaveCount(0);
  await expect(marks(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
  await expect(inExplorer(page, "auto-card.pdf")).toContainText("Not started");
  expect(await storedField(page, "auto-card", "rejected")).toEqual(["4111111111111111"]);
});

test("a card number after a character stored as two units and a ligature is removed", async ({ page }) => {
  await openApp(page);
  await openPdf(page, offsetPdf);
  await chooseProfile(page, []);
  await runAuto(page, 1);
  await confirmFindings(page, "Mark 1 value for removal?");

  const output = await applyAndDownload(page);
  await judge(offsetPdf, output, [{ check: "absent", values: ["4000 0000 0000 0002"] }, { check: "kept", values: ["in full"] }, { check: "structure" }]);
});

test("cards that touch and 300 cards on one page are all removed, with and without types printed", async ({ page }) => {
  await openApp(page);
  await openPdf(page, shapesPdf);
  await chooseProfile(page, []);
  await runAuto(page, 302);
  await confirmFindings(page, "Mark 302 values for removal?");

  await judgedWithAndWithoutTypes(page, shapesPdf, [
    { check: "absent", values: [...touching, ...hundreds] },
    { check: "kept", values: [...acrossLines, "Cards on file"] },
    { check: "structure" },
  ]);
});

test("a found value that runs across a line end is removed on both lines", async ({ page }) => {
  await fakeDetection(page, acrossLineHit);
  await openApp(page);
  await openPdf(page, shapesPdf);
  await chooseProfile(page, []);
  await runAuto(page, 1);
  await confirmFindings(page, "Mark 1 value for removal?");

  await expect(marks(page)).toHaveText([/4333 3333 3333 3339.*Payment card/]);
  await judgedWithAndWithoutTypes(page, shapesPdf, [{ check: "absent", values: [...acrossLines] }, { check: "kept", values: ["Paid with card", "on 3 May"] }, { check: "structure" }]);
});
