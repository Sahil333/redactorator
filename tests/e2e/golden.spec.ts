// fixtures/golden/ holds what builds stored: `project/` is the storage this build's session left,
// and `expected/` its stored files with ids and dates as placeholders; `pre-phase-3/` is the
// storage the build of commit fc0649f left, before reader tags, and `expected-old/` what this build
// stores once it has opened that storage, migrated it and changed a mark. A change must store the
// same bytes. GOLDEN_UPDATE=1 records them again.
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect } from "@playwright/test";
import { test } from "./coverage";
import { filesIn, loadStorage, markText, openApp, reference, saved, show, storedFiles } from "./app";
import { goldenSession } from "./goldenSession";

const golden = new URL("../../fixtures/golden/", import.meta.url).pathname;
const recording = process.env.GOLDEN_UPDATE === "1";

const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const isoDate = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g;
const TAG_FOLDER = ".redactorator/pdf-3";

/** Replaces `value` by the placeholder `kind` numbered in order of first appearance. */
function numbered(seen: Map<string, string>, value: string, kind: string): string {
  const known = seen.get(value);
  if (known !== undefined) return known;
  const placeholder = `<${kind}-${seen.size + 1}>`;
  seen.set(value, placeholder);
  return placeholder;
}

/**
 * The stored files of the one project in `stored` that this build writes, its tag folder's, with
 * ids and dates as placeholders, by name: project.json, then settings.json, then each document's
 * reading named by its id's placeholder. Working copies are checked to be there, not compared:
 * every save gives a PDF a new file ID.
 */
function goldenForm(stored: ReadonlyMap<string, Uint8Array>): Map<string, string> {
  const ids = new Map<string, string>();
  const dates = new Map<string, string>();
  const mask = (text: string) => text.replace(uuid, (id) => numbered(ids, id, "id")).replace(isoDate, (date) => numbered(dates, date, "date"));
  const text = (bytes: Uint8Array) => mask(new TextDecoder().decode(bytes));
  const records = [...stored].filter(([path]) => new RegExp(`^[^/]+/${TAG_FOLDER}/project\\.json$`).test(path));
  expect(records, "one project is stored").toHaveLength(1);
  const [folder, project] = records[0] ?? ["", new Uint8Array()];
  const settings = stored.get(".redactorator/settings.json");
  if (settings === undefined) throw new Error("No settings are stored");
  const form = new Map([
    ["project.json", text(project)],
    ["settings.json", text(settings)],
  ]);
  const record = folder.slice(0, -"project.json".length);
  const readings = [...stored].flatMap(([path, bytes]) => {
    const reading = /^(text|images)\/(.+)\.json$/.exec(path.startsWith(record) ? path.slice(record.length) : "");
    // Named without the placeholder's angle brackets, which some file systems refuse.
    return reading === null ? [] : [[`${reading[1]}/${mask(reading[2] ?? "").slice(1, -1)}.json`, text(bytes)] satisfies [string, string]];
  });
  for (const [name, content] of readings.sort(([a], [b]) => a.localeCompare(b))) form.set(name, content);
  const documents: unknown = Reflect.get(JSON.parse(new TextDecoder().decode(project)), "documents");
  const working = Array.isArray(documents) ? documents.map((document: unknown) => `${record}working/${String(Reflect.get(Object(document), "id"))}.not-redacted.pdf`) : [];
  expect(working.filter((path) => !stored.has(path)), "every document's working copy is stored").toEqual([]);
  return form;
}

async function writeFolder(folder: string, files: ReadonlyMap<string, string | Uint8Array>): Promise<void> {
  await rm(folder, { recursive: true, force: true });
  for (const [path, content] of files) {
    await mkdir(dirname(join(folder, path)), { recursive: true });
    await writeFile(join(folder, path), content);
  }
}

/** Records `form` as the expected files in `folder` when recording; otherwise compares it with them. */
async function matchesGolden(form: ReadonlyMap<string, string>, folder: string): Promise<void> {
  if (recording) {
    await writeFolder(join(golden, folder), form);
    return;
  }
  const expected = new Map([...(await filesIn(join(golden, folder)))].map(([path, bytes]) => [path, bytes.toString("utf8")]));
  expect(Object.fromEntries(form)).toEqual(Object.fromEntries(expected));
}

test("a session stores the same bytes as today's build", async ({ page }) => {
  await goldenSession(page);

  const stored = await storedFiles(page);
  if (recording) await writeFolder(join(golden, "project"), stored);
  await matchesGolden(goldenForm(stored), "expected");
});

test("a project stored before reader tags opens through migration, and is stored again in the same bytes", async ({ page }) => {
  await openApp(page);
  await loadStorage(page, join(golden, "pre-phase-3"));

  await page.getByRole("button", { name: "cross-page", exact: true }).click();
  // Its documents are prepared again for this build first; until then none can be switched to.
  await expect(page.getByRole("img", { name: "Page 1" })).toBeVisible();
  await show(page, "logo-a.pdf");
  await markText(page, 1, reference, "Other");
  await saved(page);

  await matchesGolden(goldenForm(await storedFiles(page)), "expected-old");
});
