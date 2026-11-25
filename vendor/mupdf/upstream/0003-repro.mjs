// Checks the three content-filter save options of patch 0003 on synthetic PDFs built here:
// drop-hidden-oc, drop-mc-properties and blank-unshown-pixels.
//
//   node 0003-repro.mjs [path to mupdf.js]
//
// Uses this folder's patched build by default. Prints PASS or FAIL for each check, and exits
// non-zero if any fails. Each case is saved with its own option, and again with every option
// together, as Redactorator's preparation uses them.
const mupdf = await import(process.argv[2] ?? new URL("../package/dist/mupdf.js", import.meta.url).href);

const ALL = "clean,sanitize,drop-hidden-oc,drop-mc-properties,blank-unshown-pixels";
let failed = 0;
const check = (name, ok) => {
	if (!ok) failed++;
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
};

// --- building synthetic PDFs ---

const newDoc = () => {
	const doc = new mupdf.PDFDocument();
	return { doc, font: doc.addSimpleFont(new mupdf.Font("Helvetica")) };
};
const dict = (doc, entries) => {
	const d = doc.newDictionary();
	for (const [k, v] of Object.entries(entries)) d.put(k, v);
	return d;
};
const array = (doc, items) => {
	const a = doc.newArray();
	for (const item of items) a.push(item);
	return a;
};
const addPage = (doc, resources, contents, size = [0, 0, 612, 792]) =>
	doc.insertPage(-1, doc.addPage(size, 0, resources, contents));
const reopen = (doc, options) =>
	mupdf.Document.openDocument(doc.saveToBuffer(options).asUint8Array().slice(), "application/pdf");
const latin1 = (doc, options) => Buffer.from(doc.saveToBuffer(`${options},decompress`).asUint8Array().slice()).toString("latin1");
const pageContent = (doc, i) => {
	const contents = doc.loadPage(i).getObject().get("Contents");
	return (contents.isArray() ? contents.get(0) : contents).readStream().asString();
};
const render = (doc, i) => [...doc.loadPage(i).toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB, false).getPixels()];
const sameRender = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const letters = (doc, i) => {
	const out = [];
	doc.loadPage(i).toStructuredText("preserve-whitespace,ignore-actualtext").walk({ onChar(c, origin) { out.push({ c, x: origin[0], y: origin[1] }); } });
	return out;
};
const textAt = (list, s) => {
	const text = list.map((l) => l.c).join("");
	const at = text.indexOf(s);
	return at < 0 ? null : list.slice(at, at + s.length);
};
const samePlace = (a, b) => a && b && a.every((l, i) => Math.abs(l.x - b[i].x) < 0.01 && Math.abs(l.y - b[i].y) < 0.01);

// --- drop-hidden-oc ---

function hiddenLayers() {
	const { doc, font } = newDoc();
	const ocg = (n) => doc.addObject(dict(doc, { Type: doc.newName("OCG"), Name: doc.newString(n) }));
	const off = ocg("Off layer");
	const on = ocg("On layer");
	const rule = (p, ocgs) => doc.addObject(dict(doc, { Type: doc.newName("OCMD"), OCGs: array(doc, ocgs), P: doc.newName(p) }));
	doc.getTrailer().get("Root").put("OCProperties", dict(doc, {
		OCGs: array(doc, [off, on]),
		D: dict(doc, { OFF: array(doc, [off]), ON: array(doc, [on]) }),
	}));
	const fonts = dict(doc, { F1: font });
	const form = (oc, text) => doc.addStream(`BT /F1 12 Tf 72 560 Td (${text}) Tj ET`, dict(doc, {
		Type: doc.newName("XObject"), Subtype: doc.newName("Form"), BBox: array(doc, [0, 0, 612, 792].map((n) => doc.newInteger(n))),
		Resources: dict(doc, { Font: fonts }), OC: oc,
	}));
	const resources = dict(doc, {
		Font: fonts,
		Properties: dict(doc, {
			Off: off, On: on,
			AllOn: rule("AllOn", [on, off]), AnyOffNone: rule("AnyOff", [on, on]), AnyOffSome: rule("AnyOff", [on, off]),
		}),
		XObject: dict(doc, { Fh: form(off, "HiddenForm"), Fv: form(on, "ShownForm") }),
	});
	addPage(doc, resources, [
		"BT /F1 12 Tf 72 700 Td (Visible text) Tj ET",
		"/OC /Off BDC BT /F1 12 Tf 72 680 Td (HiddenPhone 555-0100) Tj ET 0 0 1 rg 300 300 50 50 re f EMC",
		"/OC /On BDC BT /F1 12 Tf 72 660 Td (Shown layer) Tj ET EMC",
		"/OC /AllOn BDC BT /F1 12 Tf 72 640 Td (HiddenByAllOn) Tj ET EMC",
		"/OC /AnyOffNone BDC BT /F1 12 Tf 72 600 Td (HiddenByAnyOff) Tj ET EMC",
		"/OC /AnyOffSome BDC BT /F1 12 Tf 72 580 Td (ShownByAnyOff) Tj ET EMC",
		"BT /F1 12 Tf 72 620 Td (Kept [) Tj /OC /Off BDC (HiddenMid) Tj EMC (] after) Tj ET",
		"q /Fh Do Q q /Fv Do Q",
	].join("\n"));
	return doc;
}

// Each save gets a fresh document: a save rewrites the content of the document in memory.
function checkHiddenLayers(options) {
	const doc = hiddenLayers();
	const before = letters(doc, 0);
	const picture = render(doc, 0);
	const bytes = latin1(hiddenLayers(), `${options},garbage`);
	const out = reopen(doc, options);
	const after = letters(out, 0);
	const content = pageContent(out, 0);
	const label = `drop-hidden-oc [${options}]:`;
	for (const s of ["HiddenPhone", "HiddenByAllOn", "HiddenByAnyOff", "HiddenMid", "HiddenForm"])
		check(`${label} "${s}" is gone from the file`, !bytes.includes(s));
	check(`${label} the hidden rectangle is gone`, !content.includes("300 300 50 50 re"));
	for (const s of ["Visible text", "Shown layer", "ShownByAnyOff", "Kept [", "] after", "ShownForm"])
		check(`${label} "${s}" stays in place`, samePlace(textAt(before, s), textAt(after, s)));
	check(`${label} no optional content markers in the page content`, !/\bBDC\b/.test(content) && !content.includes("/OC"));
	const forms = out.loadPage(0).getObject().get("Resources").get("XObject");
	let formOC = false;
	forms.forEach((v) => { if (v.get("OC").isIndirect() || !v.get("OC").isNull()) formOC = true; });
	check(`${label} no /OC on the shown form`, !formOC);
	check(`${label} the page renders the same`, sameRender(picture, render(out, 0)));
}

// A Type 3 glyph procedure that leaves a hidden layer open must not hide the next glyph's.
function checkType3(options) {
	const { doc } = newDoc();
	const off = doc.addObject(dict(doc, { Type: doc.newName("OCG"), Name: doc.newString("Off layer") }));
	doc.getTrailer().get("Root").put("OCProperties", dict(doc, {
		OCGs: array(doc, [off]), D: dict(doc, { OFF: array(doc, [off]) }),
	}));
	const num = (n) => doc.newReal(n);
	const glyph = (content) => doc.addStream(content, doc.newDictionary());
	const font = doc.addObject(dict(doc, {
		Type: doc.newName("Font"), Subtype: doc.newName("Type3"),
		FontBBox: array(doc, [0, 0, 1000, 1000].map(num)), FontMatrix: array(doc, [0.001, 0, 0, 0.001, 0, 0].map(num)),
		CharProcs: dict(doc, { a: glyph("1000 0 d0 /OC /Off BDC 0 0 500 500 re f"), b: glyph("1000 0 d0 0 0 700 700 re f") }),
		Encoding: dict(doc, { Type: doc.newName("Encoding"), Differences: array(doc, [doc.newInteger(97), doc.newName("a"), doc.newName("b")]) }),
		FirstChar: doc.newInteger(97), LastChar: doc.newInteger(98), Widths: array(doc, [1000, 1000].map(num)),
		Resources: dict(doc, { Properties: dict(doc, { Off: off }) }),
	}));
	addPage(doc, dict(doc, { Font: dict(doc, { T3: font }) }), "BT /T3 20 Tf 72 700 Td (ab) Tj ET");
	const out = reopen(doc, options);
	const procs = out.newIndirect(font.asIndirect()).get("CharProcs");
	check(`drop-hidden-oc [${options}]: a Type 3 glyph after one that leaves a hidden layer open is kept`,
		procs.get("b").readStream().asString().includes("700 700 re"));
	check(`drop-hidden-oc [${options}]: the hidden part of the first glyph is gone`,
		!procs.get("a").readStream().asString().includes("500 500 re"));
}

// --- drop-mc-properties ---

function markedContent() {
	const { doc, font } = newDoc();
	const on = doc.addObject(dict(doc, { Type: doc.newName("OCG"), Name: doc.newString("On layer") }));
	doc.getTrailer().get("Root").put("OCProperties", dict(doc, {
		OCGs: array(doc, [on]), D: dict(doc, { ON: array(doc, [on]) }),
	}));
	const resources = dict(doc, {
		Font: dict(doc, { F1: font }),
		Properties: dict(doc, { Pr1: doc.addObject(dict(doc, { E: doc.newString("SecretExpansion") })), On: on }),
	});
	addPage(doc, resources, [
		"/Span <</ActualText (SecretActual)>> BDC BT /F1 12 Tf 72 700 Td (Shown) Tj ET EMC",
		"/P <</MCID 0 /Alt (SecretAlt)>> BDC BT /F1 12 Tf 72 680 Td (Para) Tj ET EMC",
		"/Figure /Pr1 BDC 0 g 72 600 50 50 re f EMC",
		"/OC /On BDC BT /F1 12 Tf 72 660 Td (Layer) Tj ET EMC",
		"/Pt <</Data (SecretPoint)>> DP",
	].join("\n"));
	return doc;
}

function checkMarkedContent(options) {
	const doc = markedContent();
	const before = letters(doc, 0);
	const picture = render(doc, 0);
	const bytes = latin1(markedContent(), `${options},garbage`);
	const out = reopen(doc, options);
	const content = pageContent(out, 0);
	const label = `drop-mc-properties [${options}]:`;
	for (const s of ["SecretActual", "SecretAlt", "SecretExpansion", "SecretPoint"])
		check(`${label} "${s}" is gone from the file`, !bytes.includes(s));
	for (const tag of ["Span", "P", "Figure"])
		check(`${label} /${tag} stays as a BMC`, new RegExp(`/${tag}\\s+BMC`).test(content));
	check(`${label} the DP stays as an MP`, /\/Pt\s+MP/.test(content));
	if (!options.includes("drop-hidden-oc"))
		check(`${label} the layer marker stays`, /\/OC\s*\/\w+\s*BDC/.test(content));
	for (const s of ["Shown", "Para", "Layer"])
		check(`${label} "${s}" stays in place`, samePlace(textAt(before, s), textAt(letters(out, 0), s)));
	check(`${label} the page renders the same`, sameRender(picture, render(out, 0)));
}

// --- blank-unshown-pixels ---

// A 40 x 40 RGB image whose every pixel is a different colour, none of them white. The blue
// channel differs per image: images with the same data are treated as one.
const W = 40;
const colour = (x, y, seed) => [10 + x * 5, 10 + y * 5, 20 + seed * 10];
const imageBytes = (seed) => {
	const bytes = new Uint8Array(W * W * 3);
	for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) bytes.set(colour(x, y, seed), (y * W + x) * 3);
	return bytes;
};
const addImage = (doc, seed, extra = {}) => doc.addStream(imageBytes(seed), dict(doc, {
	Type: doc.newName("XObject"), Subtype: doc.newName("Image"), Width: doc.newInteger(W), Height: doc.newInteger(W),
	ColorSpace: doc.newName("DeviceRGB"), BitsPerComponent: doc.newInteger(8), ...extra,
}));
const addMask = (doc) => doc.addStream(new Uint8Array(W * W).fill(128), dict(doc, {
	Type: doc.newName("XObject"), Subtype: doc.newName("Image"), Width: doc.newInteger(W), Height: doc.newInteger(W),
	ColorSpace: doc.newName("DeviceGray"), BitsPerComponent: doc.newInteger(8),
}));
const SMALL = [0, 0, 200, 200];

function unshownPixels() {
	const { doc } = newDoc();
	const im = {};
	["A", "B", "T", "C", "D", "E", "G"].forEach((k, seed) => { im[k] = { seed, ref: addImage(doc, seed) }; });
	im.M = { ref: addMask(doc) };
	im.H = { seed: 7, ref: addImage(doc, 7, { SMask: im.M.ref }) };
	im.P = { seed: 8, ref: addImage(doc, 8) };
	const form = doc.addStream("80 0 0 80 0 0 cm /ImG Do", dict(doc, {
		Type: doc.newName("XObject"), Subtype: doc.newName("Form"), BBox: array(doc, [0, 0, 80, 80].map((n) => doc.newInteger(n))),
		Resources: dict(doc, { XObject: dict(doc, { ImG: im.G.ref }) }),
	}));
	const xobjects = (entries) => dict(doc, { XObject: dict(doc, entries) });
	// Inline: 8 x 1 pixels across x 160..240, so pixels 5..7 lie past the page's right edge.
	const inline = "BI /W 8 /H 1 /CS /RGB /BPC 8 /F /AHx ID 102030 405060 708090 a0b0c0 112233 445566 778899 aabbcc> EI";
	addPage(doc, xobjects({ ImA: im.A.ref, ImB: im.B.ref, ImT: im.T.ref, ImE: im.E.ref, ImH: im.H.ref, Fm: form }), [
		"q 80 0 0 80 160 20 cm /ImA Do Q", // A: right half past the page edge
		"q 110 110 40 40 re W n 80 0 0 80 90 90 cm /ImB Do Q", // B: only the middle shown, by a clip
		"q 10 110 m 90 110 l 10 190 l h W n 80 0 0 80 10 110 cm /ImT Do Q", // T: a triangle clip
		"q 40 0 0 40 20 20 cm /ImE Do Q", // E: fully shown
		"q 80 0 0 80 160 110 cm /ImH Do Q", // H: with a soft mask, right half past the edge
		"q 1 0 0 1 160 20 cm /Fm Do Q", // G: inside a form, right half past the edge
		`q 80 0 0 10 160 180 cm ${inline} Q`,
	].join("\n"), SMALL);
	// C: shared by two pages, left half shown on one and right half on the other: all shown.
	// D: shared by two placements on one page, left half and top half: bottom-right quarter not shown.
	addPage(doc, xobjects({ ImC: im.C.ref, ImD: im.D.ref }), [
		"q 0 0 40 80 re W n 80 0 0 80 0 0 cm /ImC Do Q",
		"q 100 0 40 80 re W n 80 0 0 80 100 0 cm /ImD Do Q",
		"q 100 140 80 40 re W n 80 0 0 80 100 100 cm /ImD Do Q",
	].join("\n"), SMALL);
	addPage(doc, xobjects({ ImC: im.C.ref }), "q 40 0 40 80 re W n 80 0 0 80 0 0 cm /ImC Do Q", SMALL);
	// P: left half shown on screen, all of it shown by a print-only annotation: all shown.
	addPage(doc, xobjects({ ImP: im.P.ref }), "q 0 0 40 80 re W n 80 0 0 80 0 0 cm /ImP Do Q", SMALL);
	const stamp = doc.addStream("80 0 0 80 0 0 cm /ImP Do", dict(doc, {
		Type: doc.newName("XObject"), Subtype: doc.newName("Form"), BBox: array(doc, [0, 0, 80, 80].map((n) => doc.newInteger(n))),
		Resources: xobjects({ ImP: im.P.ref }),
	}));
	const printOnly = doc.addObject(dict(doc, {
		Type: doc.newName("Annot"), Subtype: doc.newName("Stamp"), F: doc.newInteger(4 | 32),
		Rect: array(doc, [0, 0, 80, 80].map((n) => doc.newInteger(n))), AP: dict(doc, { N: stamp }),
	}));
	doc.findPage(3).put("Annots", array(doc, [printOnly]));
	return { doc, im };
}

const pixelsOf = (image) => {
	const pix = image.toPixmap();
	return { n: pix.getNumberOfComponents(), stride: pix.getStride(), data: pix.getPixels() };
};
const pixel = (p, x, y) => [...p.data.slice(y * p.stride + x * p.n, y * p.stride + x * p.n + 3)];
const isWhite = (rgb) => rgb.every((v) => v === 255);
const originalOf = ({ seed }) => (rgb, x, y) => rgb.every((v, i) => v === colour(x, y, seed)[i]);
// Every pixel in columns x0..x1 and rows y0..y1 (inclusive) passes test.
const all = (p, [x0, x1], [y0, y1], test) => {
	for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (!test(pixel(p, x, y), x, y)) return false;
	return true;
};

function checkUnshownPixels(options) {
	const { doc, im } = unshownPixels();
	const raw = (d, { ref }) => [...d.newIndirect(ref.asIndirect()).readRawStream().asUint8Array()];
	const rawC = raw(doc, im.C);
	const rawE = raw(doc, im.E);
	const rawP = raw(doc, im.P);
	const pictures = [0, 1, 2].map((i) => render(doc, i));
	const out = reopen(doc, options);
	const img = ({ ref }) => pixelsOf(out.loadImage(out.newIndirect(ref.asIndirect())));
	const label = `blank-unshown-pixels [${options}]:`;

	// Image columns are 2 pt wide: column i covers x = left + 2i .. left + 2i + 2.
	let original = originalOf(im.A);
	const a = img(im.A);
	check(`${label} past the page edge: shown half kept`, all(a, [0, 19], [0, 39], original));
	check(`${label} past the page edge: the rest blanked`, all(a, [22, 39], [0, 39], isWhite));
	original = originalOf(im.B);
	const b = img(im.B);
	check(`${label} clipped: shown middle kept`, all(b, [10, 29], [10, 29], original));
	check(`${label} clipped: outside the clip blanked`, all(b, [0, 7], [0, 39], isWhite) && all(b, [32, 39], [0, 39], isWhite) && all(b, [0, 39], [0, 7], isWhite));
	original = originalOf(im.T);
	const t = img(im.T);
	check(`${label} triangle clip: inside kept`, all(t, [2, 10], [28, 37], original));
	check(`${label} triangle clip: outside it, within its bounds, blanked`, all(t, [30, 37], [2, 10], isWhite));
	original = originalOf(im.G);
	const g = img(im.G);
	check(`${label} inside a form: shown half kept`, all(g, [0, 19], [0, 39], original));
	check(`${label} inside a form: the rest blanked`, all(g, [22, 39], [0, 39], isWhite));
	original = originalOf(im.H);
	const h = img(im.H);
	const m = img(im.M);
	check(`${label} soft-masked image: shown half kept`, all(h, [0, 19], [0, 39], original));
	check(`${label} soft-masked image: the rest blanked`, all(h, [22, 39], [0, 39], isWhite));
	check(`${label} its soft mask: shown half kept, the rest opaque`,
		all(m, [0, 19], [0, 39], (v) => v[0] === 128) && all(m, [22, 39], [0, 39], (v) => v[0] === 255));
	check(`${label} fully shown image left byte for byte`, raw(out, im.E).join() === rawE.join());
	check(`${label} shared image shown whole across two pages left byte for byte`, raw(out, im.C).join() === rawC.join());
	check(`${label} image shown whole only in print left byte for byte`, raw(out, im.P).join() === rawP.join());
	original = originalOf(im.D);
	const d = img(im.D);
	check(`${label} shared image: left and top halves kept`, all(d, [0, 19], [0, 39], original) && all(d, [0, 39], [0, 19], original));
	check(`${label} shared image: bottom-right quarter blanked`, all(d, [22, 39], [22, 39], isWhite));
	const uses = out.loadPage(1).getObject().get("Resources").get("XObject");
	const nums = new Set();
	uses.forEach((v) => nums.add(v.asIndirect()));
	check(`${label} shared image still one object`, nums.size === 2 && nums.has(im.C.ref.asIndirect()) && nums.has(im.D.ref.asIndirect()));

	let inline = null;
	out.loadPage(0).run(new mupdf.Device({
		fillImage(image) { if (image.getWidth() === 8) inline = pixelsOf(image); },
	}), mupdf.Matrix.identity);
	const inlineColours = [[0x10, 0x20, 0x30], [0x40, 0x50, 0x60], [0x70, 0x80, 0x90], [0xa0, 0xb0, 0xc0]];
	check(`${label} inline image: shown pixels kept`, inline !== null && inlineColours.every((c, x) => pixel(inline, x, 0).join() === c.join()));
	check(`${label} inline image: pixels past the edge blanked`, inline !== null && [5, 6, 7].every((x) => isWhite(pixel(inline, x, 0))));

	[0, 1, 2].forEach((i) => check(`${label} page ${i + 1} renders the same`, sameRender(pictures[i], render(out, i))));
}

checkHiddenLayers("drop-hidden-oc");
checkHiddenLayers(ALL);
checkType3("drop-hidden-oc");
checkType3(ALL);
checkMarkedContent("drop-mc-properties");
checkMarkedContent(ALL);
checkUnshownPixels("blank-unshown-pixels");
checkUnshownPixels(ALL);

// An image MuPDF cannot load cannot be blanked, so the save fails rather than keep it whole.
// One whose data does not decode is drawn blank, and its data is replaced.
for (const options of ["blank-unshown-pixels", ALL]) {
	const brokenImage = (doc, data, extra) => doc.addRawStream(data, dict(doc, {
		Type: doc.newName("XObject"), Subtype: doc.newName("Image"), Width: doc.newInteger(W), Height: doc.newInteger(W),
		ColorSpace: doc.newName("DeviceRGB"), BitsPerComponent: doc.newInteger(8), ...extra,
	}));
	const pastTheEdge = (doc, image) =>
		addPage(doc, dict(doc, { XObject: dict(doc, { Im: image }) }), "q 80 0 0 80 160 20 cm /Im Do Q", SMALL);

	const unloadable = newDoc().doc;
	pastTheEdge(unloadable, brokenImage(unloadable, "x", { ColorSpace: unloadable.newName("NoSuchSpace") }));
	let saved = true;
	try { unloadable.saveToBuffer(options); } catch { saved = false; }
	check(`blank-unshown-pixels [${options}]: an image that cannot be loaded fails the save`, !saved);

	const undecodable = newDoc().doc;
	const garbage = brokenImage(undecodable, "SecretBytes, not a JPEG", { Filter: undecodable.newName("DCTDecode") });
	pastTheEdge(undecodable, garbage);
	const out = reopen(undecodable, options);
	const after = Buffer.from(out.newIndirect(garbage.asIndirect()).readRawStream().asUint8Array().slice()).toString("latin1");
	check(`blank-unshown-pixels [${options}]: an image whose data does not decode has its data replaced`, !after.includes("SecretBytes"));
}

console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
