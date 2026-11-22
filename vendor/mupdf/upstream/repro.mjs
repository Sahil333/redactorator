// Reproduces MuPDF's redaction moving the text after a removed word.
//
//   npm install mupdf@1.28.6
//   node repro.mjs
//
// Writes repro.pdf (one line, "Read the about it", drawn with one TJ string), redacts "the",
// and prints where each remaining letter was and is, and the content stream MuPDF wrote.
// Pass a path to another build's mupdf.js to try it: node repro.mjs ./dist/mupdf.js
import { writeFileSync } from "node:fs";

const mupdf = await import(process.argv[2] ?? "mupdf");

const doc = new mupdf.PDFDocument();
const fonts = doc.newDictionary();
fonts.put("F1", doc.addSimpleFont(new mupdf.Font("Helvetica")));
const resources = doc.newDictionary();
resources.put("Font", fonts);
doc.insertPage(-1, doc.addPage([0, 0, 612, 792], 0, resources, "BT /F1 12 Tf 72 700 Td [(Read the about it)] TJ ET"));
writeFileSync("repro.pdf", doc.saveToBuffer("").asUint8Array());

const letters = () => {
	const out = [];
	doc.loadPage(0).toStructuredText("preserve-whitespace").walk({ onChar(c, _origin, _font, _size, quad) { out.push({ c, quad }); } });
	return out;
};
const before = letters();
const t = before.findIndex((l, i) => l.c === "t" && before[i + 1].c === "h");
const [first, last] = [before[t].quad, before[t + 2].quad];

const page = doc.loadPage(0);
page.createAnnotation("Redact").setRect([first[0], first[1], last[6], last[7]]);
page.applyRedactions(false, mupdf.PDFPage.REDACT_IMAGE_NONE, mupdf.PDFPage.REDACT_LINE_ART_NONE, mupdf.PDFPage.REDACT_TEXT_REMOVE);

const after = letters().filter((l) => l.c !== " ");
const kept = before.filter((l, i) => (i < t || i > t + 2) && l.c !== " ");
console.log("letter  x before  x after  moved");
kept.forEach((l, i) => {
	const moved = after[i].quad[0] - l.quad[0];
	console.log(`${l.c.padEnd(6)}  ${l.quad[0].toFixed(3).padStart(8)}  ${after[i].quad[0].toFixed(3).padStart(7)}  ${moved.toFixed(3)}`);
});
const contents = page.getObject().get("Contents");
console.log("\ncontent after redaction:", (contents.isArray() ? contents.get(0) : contents).readStream().asString().trim());
