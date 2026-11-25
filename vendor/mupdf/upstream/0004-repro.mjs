// Checks patch 0004: the content filter must send text state that is still pending when a form
// XObject is drawn, as a reset of Tc in an empty text object, both when saving with sanitize and
// when applying a redaction inside the form, which runs the same filter.
//
//   node 0004-repro.mjs [path to mupdf.js]
//
// Uses this folder's patched build by default. Prints PASS or FAIL for each, and exits non-zero if
// either fails.
const mupdf = await import(process.argv[2] ?? new URL("../package/dist/mupdf.js", import.meta.url).href);

// One page: "Spaced" drawn with 3.9 Tc, then an empty text object that resets Tc to 0, then a
// form that draws "Secret text", itself setting 0 Tc.
const doc = new mupdf.PDFDocument();
const font = doc.addSimpleFont(new mupdf.Font("Helvetica"));
const fonts = doc.newDictionary();
fonts.put("F1", font);
const formResources = doc.newDictionary();
formResources.put("Font", fonts);
const form = doc.addStream("BT /F1 12 Tf 0 Tc 72 650 Td (Secret text) Tj ET", {
	Type: doc.newName("XObject"),
	Subtype: doc.newName("Form"),
	BBox: [0, 0, 612, 792],
	Resources: formResources,
});
const xobjects = doc.newDictionary();
xobjects.put("Fm", form);
const resources = doc.newDictionary();
resources.put("Font", fonts);
resources.put("XObject", xobjects);
doc.insertPage(-1, doc.addPage([0, 0, 612, 792], 0, resources, "BT /F1 12 Tf 3.9 Tc 72 700 Td (Spaced) Tj ET BT 0 Tc ET /Fm Do"));
const original = doc.saveToBuffer("").asUint8Array().slice();

const open = (bytes) => mupdf.Document.openDocument(bytes, "application/pdf");
const formLetters = (bytes) => {
	const page = open(bytes).loadPage(0);
	const found = [];
	page.toStructuredText().walk({
		onChar(c, origin) {
			if (origin[1] > 100 && origin[1] < 200) found.push(`${c}@${origin[0].toFixed(1)}`);
		},
	});
	return found.join(" ");
};

let failed = 0;
const check = (name, before, after) => {
	const ok = before === after;
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
	if (!ok) {
		failed++;
		console.log(`  before: ${before}\n  after:  ${after}`);
	}
};

check("a form's text keeps its place after sanitize", formLetters(original), formLetters(open(original).saveToBuffer("clean,sanitize").asUint8Array().slice()));

// Redact "Secret" inside the form: the rest of the form's line must not move.
const redacted = open(original);
const page = redacted.loadPage(0);
page.createAnnotation("Redact").setRect([72, 129.1, 106.7, 145.6]);
page.applyRedactions(false, mupdf.PDFPage.REDACT_IMAGE_NONE, mupdf.PDFPage.REDACT_LINE_ART_NONE, mupdf.PDFPage.REDACT_TEXT_REMOVE);
// The letters right of the redaction, " text".
const rest = (letters) => letters.split(" ").filter((each) => Number(each.split("@")[1]) > 107).join(" ");
check("a form's text keeps its place when a redaction inside the form is applied", rest(formLetters(original)), rest(formLetters(redacted.saveToBuffer("").asUint8Array().slice())));
process.exit(failed === 0 ? 0 : 1);
