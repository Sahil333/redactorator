// The entries in tests/oracle/leak-vectors.json that make no mark: what preparation alone must
// clean. Until slice 2 runs preparation in the app, each fixture goes through preparation's two
// MuPDF saves with the vendored MuPDF.js: step 5's, through the patched content filter, then
// step 8's, which drops every object nothing refers to, such as the content stream step 5
// replaced (docs/designs/pdf-leak-suite.md, part 1). The outside checker judges step 8's file.
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "@playwright/test";
import * as mupdf from "mupdf";
import vectors from "../oracle/leak-vectors.json" with { type: "json" };
import { fixturePath } from "./app";
import { judgeListed } from "./oracle";

const STEP_5 = "clean,sanitize,drop-hidden-oc,drop-mc-properties,blank-unshown-pixels";
const STEP_8 = "garbage=4,compress,encrypt=none";

function save(bytes: Uint8Array, options: string): Uint8Array {
  const document = new mupdf.PDFDocument(bytes);
  try {
    return document.saveToBuffer(options).asUint8Array().slice();
  } finally {
    document.destroy();
  }
}

for (const vector of vectors) {
  if (vector.mark !== null) continue;
  test(`${vector.id}: ${vector.howItLeaks}`, async () => {
    const fixture = fixturePath(vector.fixture);
    const output = join(await mkdtemp(join(tmpdir(), "prepared-")), "prepared.pdf");
    await writeFile(output, save(save(await readFile(fixture), STEP_5), STEP_8));
    await judgeListed(fixture, output, vector.checks);
  });
}
