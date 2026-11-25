// Checks patch 0005: a save with garbage collection (garbage=2 or more) must keep the data of a
// stream read from the file whose dictionary holds an indirect reference, even while something
// else holds a reference to that dictionary, as a live MuPDF.js PDFObject does.
//
//   node 0005-repro.mjs [path to mupdf.js]
//
// Uses this folder's patched build by default. Prints PASS or FAIL for each case, and exits
// non-zero if any fails.
const mupdf = await import(process.argv[2] ?? new URL("../package/dist/mupdf.js", import.meta.url).href);

// One page that draws a 2 x 2 grey image, object 5, whose /SMask is object 6. Written by hand, so
// that both images are read from the file and nothing in the document is changed.
function build() {
	const stream = (dict, data) => `<< ${dict} /Length ${data.length} >>\nstream\n${data}\nendstream`;
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /XObject << /Im 5 0 R >> >> /Contents 4 0 R >>",
		stream("", "q 50 0 0 50 10 10 cm /Im Do Q"),
		stream("/Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8 /SMask 6 0 R", "\x10\x20\x30\x40"),
		stream("/Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8", "\xff\xff\xff\xff"),
	];
	let out = "%PDF-1.7\n";
	const offsets = objects.map((object, i) => {
		const at = out.length;
		out += `${i + 1} 0 obj\n${object}\nendobj\n`;
		return at;
	});
	const xref = out.length;
	out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((at) => `${String(at).padStart(10, "0")} 00000 n \n`).join("")}`;
	out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return Uint8Array.from(out, (c) => c.charCodeAt(0));
}

const open = (bytes) => mupdf.Document.openDocument(bytes, "application/pdf").asPDF();
const image = (doc) => doc.findPage(0).get("Resources").get("XObject").get("Im");
const kept = (bytes) => image(open(bytes)).isStream();

let failed = 0;
const check = (name, ok) => {
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
	if (!ok) failed++;
};

// The C bug: renumberobjs copies a dictionary someone else also holds, and pdf_update_object files
// the copy in a new, empty entry of the incremental xref section, which has no stream offset.
{
	const doc = open(build());
	const held = image(doc).resolve();
	check("a stream whose dictionary is held while saving with garbage=4 keeps its data", kept(doc.saveToBuffer("garbage=4").asUint8Array().slice()));
	held.destroy();
}
{
	const doc = open(build());
	const held = image(doc).resolve();
	check("the same with garbage=2", kept(doc.saveToBuffer("garbage=2").asUint8Array().slice()));
	held.destroy();
}
// In MuPDF.js 1.28.6 a PDFObject keeps its pdf_obj twice and destroy() drops it once, so a handle
// once resolved holds the dictionary for good (fixed on master by b8d579fee).
{
	const doc = open(build());
	image(doc).resolve().destroy();
	check("a stream whose dictionary was resolved, then destroyed, keeps its data", kept(doc.saveToBuffer("garbage=4").asUint8Array().slice()));
}
// Bug 709830's case: a stream made in this session, whose dictionary holds a reference, saved with
// garbage=3 where two pages' resources are duplicates. The first pass merges them and replaces the
// xref, so the second pass meets the stream in an older section; the form handle holds it.
{
	const doc = new mupdf.PDFDocument();
	const dict = doc.newDictionary();
	dict.put("Type", doc.newName("XObject"));
	dict.put("Subtype", doc.newName("Form"));
	dict.put("BBox", [0, 0, 100, 100]);
	dict.put("Resources", doc.addObject(doc.newDictionary()));
	const form = doc.addStream("0 0 1 rg 0 0 100 100 re f", dict);
	for (let i = 0; i < 2; i++) {
		const xobjects = doc.newDictionary();
		xobjects.put("Fm", form);
		const resources = doc.newDictionary();
		resources.put("XObject", xobjects);
		doc.insertPage(-1, doc.addPage([0, 0, 300, 300], 0, resources, "q /Fm Do Q"));
	}
	const saved = open(doc.saveToBuffer("garbage=3").asUint8Array().slice());
	check("a stream made in the session keeps its data through garbage=3's second pass (bug 709830)", saved.findPage(0).get("Resources", "XObject", "Fm").isStream());
}
// Controls: garbage=1 does not renumber, and a stream nobody holds is edited in place.
{
	const doc = open(build());
	const held = image(doc).resolve();
	check("control: garbage=1 keeps it", kept(doc.saveToBuffer("garbage=1").asUint8Array().slice()));
	held.destroy();
}
check("control: garbage=4 keeps a stream nobody holds", kept(open(build()).saveToBuffer("garbage=4").asUint8Array().slice()));

process.exit(failed === 0 ? 0 : 1);
