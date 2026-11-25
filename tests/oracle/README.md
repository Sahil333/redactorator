# The outside checker

Judges every file the app exports, with tools that share no code with the app or
MuPDF: pdfminer.six for text and geometry, Pillow for image pixels, PDFium
(pypdfium2) to draw pages, and our own raw scan (`oracle/raw.py`) that inflates
every stream and decodes every string.

```
uv run --project tests/oracle python -m oracle spec.json
```

Exit 0 when every check passes; otherwise exit 1 and print one reason per line.
Browser tests call it through `tests/e2e/oracle.ts`.

## Spec

```json
{ "input": "fixtures/one-word.pdf", "output": "/tmp/out.pdf", "checks": [ { "check": "metadata" } ] }
```

| Check | Fields | Passes when |
| --- | --- | --- |
| `absent` | `values` | No value is in the output's text layer, any stream (inflated), any string object, or metadata. Whitespace is ignored, and strings in one stream are also joined, so text split across a `TJ` array is found |
| `present` | `text` | The text is in the output's text layer (for example a `[PERSON]` label) |
| `metadata` | — | No Info dictionary, no XMP, exactly one revision, and no encryption (which would hide streams from `absent`) |
| `covered` | `word` | A filled shape in the output covers the word's box as pdfminer reads it in the input |
| `positions` | `words` | Every glyph of the input outside the given words is in the output at the same place (0.5 pt) |
| `pixels` | `region`, `mask`?, `at`? | Image pixels wholly inside the region are one colour; pixels wholly outside are unchanged. With `mask`, the image's soft mask is judged. With `at`, the image drawn over that box is judged; without it, the file must draw one image |
| `unchanged` | `at` | Every pixel of the image drawn over `at` is as it was (within 8 levels) |
| `structure` | — | Every key reachable from the trailer is one its type keeps: the type read from the vendored Arlington PDF Model (`vendor/arlington`), with a walker of its own (`oracle/structure.py`), and the keeps written there from the design's rules; it shares no code with the app's allowlist |
| `image-metadata` | — | No JPEG holds an APPn segment other than Adobe's APP14, a comment segment, or bytes after its end-of-image marker, and no JPEG 2000 image holds a box other than those that draw it or a comment in its codestream; a JPEG under lossless filters such as a Flate layer is judged with that layer undone. It reads the images' own bytes with its own parser |
| `rendered` | `exceptions`? | Every page, drawn by PDFium as for printing with annotations and form fields at 72 dpi, looks as it did (within 8 levels a channel), outside the exceptions: `{ "page": n, "box": [x0, y0, x1, y1] }`, a 1-based page and points from the drawn page's bottom-left corner |

A pixel's place on the page follows the matrix the image is drawn with, so a
turned or resized image is judged where its pixels actually land. Images are read
in DeviceGray, DeviceRGB, DeviceCMYK, ICCBased, Indexed and Separation (with a
type 2 tint transform) colour spaces at 8 bits, as one-bit grey or stencil masks,
or as JPEGs, inline or not, and compared as RGB.

`region` and `at` are PDF user space as pdfminer lays out the page: points, origin
bottom-left. Input and output are always read the same way, so no check depends
on the app's own box convention.

## Fixtures

`make_fixtures.py` writes them into `fixtures/` byte by byte; each builder can also
write the "cleaned" file a correct redaction should produce, which the checker's
own tests (`tests/`) use. All values are synthetic. `encrypted.pdf` and `edit-locked.pdf`
come out different on every run, because encryption draws a fresh random salt each time;
keep the committed copies unless their builders changed.

```
uv run --project tests/oracle python tests/oracle/make_fixtures.py
uv run --project tests/oracle python -m pytest tests/oracle
```

Geometry in the app's box convention (MuPDF page space: points, origin top-left,
rotation and crop applied):

| Fixture | Page | Contents |
| --- | --- | --- |
| `one-word.pdf` | 612 × 792 | "Dear Jane Roe, thank you for writing to us." with "Jane Roe" at x 101.3–152.7, y 99.1–115.6. "Jane Roe" is also in Info, XMP and an incremental update |
| `image.pdf` | 612 × 792 | A 64 × 48 RGB image at x 100–356, y 200–392. Its left half, x 100–228, is user space `[100, 400, 228, 592]` |
| `rotated-cropped.pdf` | 720 × 540 shown (`/Rotate 90`, CropBox inset 36 pt) | "Account holder: Amara Okonkwo", running down the page; "Okonkwo" at x 459.8–479.0, y 210.3–268.6 |
| `encrypted.pdf` | — | AES-256 with a user password; must be refused |
| `edit-locked.pdf` | 612 × 792 | `one-word.pdf`'s page and geometry, AES-128 with an empty password to open it and an owner password that locks editing and copying; must be cleaned, with no encryption left |
| `cross-page.pdf` | 612 × 792, three pages | "… signed by Jane" ends page 1 (x 236.1–262.1, y 99.1–115.6) and "Roe, on behalf …" starts page 2 (x 72.0–97.3, y 79.1–95.6). Each page draws its header "Agreement 2026" after the body, then a footer "Page N of 3". Page 2 has two side-by-side columns whose lines are 15 pt apart, so their character boxes overlap; page 3 starts "Closing words of the claim." |
| `table.pdf` | 612 × 792 | A two-column table drawn row by row ("Engagement" / "Design and build", "Duration" / "Three months from the start," and "in four parts", "Monthly fee" / "Fifty thousand rupees each month"), left cells at x 72 and right at x 320, between a line above and a line below that start at x 64 |
| `masked-image.pdf` | 612 × 792 | `image.pdf`'s image and place, with a soft mask (SMask) holding a filled circle that crosses the image's left half |
| `letter-a.pdf` | 612 × 792 | Four lines at x 72, 12 pt, starting "Jane Roe" (x 72–123.4, y 79.1–95.6), "1234 5678" (x 72–128.7, y 99.1–115.6), "Roe" (x 72–94.0, y 119.1–135.6) and "We" |
| `letter-b.pdf` | 612 × 792 | The same values written otherwise: "Statement by JANE  ROE" ("Statement" at x 72–126.7, y 79.1–95.6), "1234-5678" and "1234.5678", "Monroe Street", "Jane" ending one line and "Roe" starting the next, and "91234 5678", which holds no match |
| `tj-strings.pdf` | 612 × 792 | `one-word.pdf`'s three lines and places, with no metadata. The line "Dear Jane Roe, thank you for writing to us." is one `TJ` array: "Dear Jane Roe, thank you for wri", a kerning of 20, then "ting to us.", so "Jane Roe" (x 101.3–152.7, y 99.1–115.6) starts in the middle of a string |
| `logo-a.pdf` | 612 × 792 | "Acme Ltd", a 96 × 64 RGB logo (red rings and a bar on cream) at x 100–388, y 100–292, and "Reference 4471" at x 100, baseline y 342 |
| `logo-b.pdf` | 612 × 792 | The logo's pixels drawn at half size over user space `[100 550 244 646]` and a quarter turned over `[304 550 400 694]` (one shared image); a JPEG re-save of it over `[100 250 388 442]`; a different 96 × 64 image over `[420 300 564 396]`; and the logo again off the page, over `[700 900 844 996]`. The logo's left 90% is `[100 550 229.6 646]` at half size and `[304 550 400 679.6]` turned |
| `unmatchable-images.pdf` | 612 × 792, two pages | Each page draws the same three images: a 102 × 132 one over the whole page, as a scan does; a patterned 24 × 24 one at x 100–196, y 96–192; and a plain grey 64 × 64 one at x 300–428, y 64–192 |
| `signatures.pdf` | 612 × 792, two pages | A signature-like shape drawn as a 96 × 64 stencil mask (ImageMask), and a black 96 × 64 logo whose shape lives in its soft mask. Page 1 draws them over user space `[100 500 292 628]` and `[100 200 292 328]`; page 2 at half size over `[300 600 396 664]` and `[300 300 396 364]` |
| `image-spaces.pdf` | 612 × 792 | Four 32 × 24 images drawn 4 pt a pixel: CMYK over user space `[100 600 228 696]`, Indexed (RGB base) over `[300 600 428 696]`, Separation (CMYK alternate) over `[100 400 228 496]`, a 1 × 1 RGB image whose shape lives in a 32 × 24 soft mask over `[300 400 428 496]`, and an RGB inline image over `[300 200 428 296]`. Each one's left half is its first 64 pt; in the app's box convention, `[100 96 164 192]`, `[300 96 364 192]`, `[100 296 164 392]`, `[300 296 364 392]` and `[300 496 364 592]` |
| `marked-text.pdf` | 612 × 792 | Six 12 pt lines at x 72, each "Label 4400 nnnn here": inside marked content with a property list (`4400 1111`, x 116.0–172.7, y 79.1–95.6), inside BMC (`4400 2222`, x 114.7–171.4, y 99.1–115.6), after a DP and an MP (`4400 3333`, x 102.7–159.4, y 119.1–135.6), inside a clip (`4400 4444`, x 116.0–172.7, y 139.1–155.6), on a layer that is on (`4400 5555`, x 105.3–162.1, y 159.1–175.6), and drawn by a form XObject (`4400 6666`, x 103.3–160.0, y 179.1–195.6) |
| `layer-rules.pdf` | 612 × 792, two pages | Two layers, one on and one off. Page 1: "Statement 4400 7777 here" on a `/P /AnyOff` rule over both, which is met, so it shows (`4400 7777` at x 130.0–186.7, y 79.1–95.6). Page 2: "Page two" (x 72–122.0, y 39.1–55.6) on no layer, then "Hidden 4400 8888 here" (x 72–197.4, y 79.1–95.6) on a `/P /AllOn` rule over both, which is not met, so it is hidden |
| `content-strings.pdf` | 612 × 792 | Two shown lines, a shown abbreviation and a blue square, with values no reader draws hidden in the content stream: `4400 9001` in a BDC's ActualText, `4400 9002` in an Alt, `4400 9003` in an E, `4400 9004` in a DP's properties, `4400 9005` under an extra key of an inline image's dictionary, `4400 9006` in a comment, and `4400 9007` as the operand of an unknown operator inside BX/EX |
| `line-feed-glyph.pdf` | 612 × 792 | Two lines at x 72, 12 pt. Its font names byte 10's glyph `uni000A`, so the first line, "Dear Jane Roe", then a line-feed glyph, then " thank you for writing to us.", draws a line break as a glyph with a box: "Jane Roe" at x 101.3–152.7 and the glyph at x 152.7–156.0, y 79.1–95.6 |
| `annotations.pdf` | 612 × 792 | "Notes page", and annotations holding `4400 91nn`: a shown free-text note "Note 4400 9101" over user space `[72 600 300 630]` (app box x 104.7–161.4, y 169.1–185.6), with contents and author; hidden, not-viewed and off-layer notes; a sticky note with a pop-up; a pending redaction; a link; and a file attachment. PDFium draws the off-layer note, over `[72 450 300 480]`, which a reader that follows optional content does not |
| `form.pdf` | 612 × 792 | "Client name:" and a filled text field "Jane Roe" over `[160 734 360 754]` (app box x 162–213.4, y 39.1–55.6) whose name, tooltip and default hold `4400 9203`, `4400 9201` and `4400 9202`; a hidden field `4400 9204`; and a signed signature whose stamp "Signed 4400 9207" is over `[72 600 300 640]`, with signer and certificate `4400 9206` and `4400 9208` |
| `carriers.pdf` | 612 × 792 | "Carriers page" and an image, with `4400 93nn` in what the allowlist deletes: bookmarks, embedded files, scripts, named destinations, the open action, page labels, structure, Info, XMP, page-piece data, a thumbnail, viewer preferences, document and page actions, page and image XMP; and "Old 4400 9312", removed from the content by an incremental update |
| `hidden-content.pdf` | media box 1000 × 792, crop box 612 × 792 | Text on a layer that is off (`4400 9401`), a form XObject on it (`4400 9402`), text beyond the media box (`4400 9403`) and between the crop box and the media box (`4400 9404`); a 32 × 24 image over `[500 600 628 696]`, past the page's edge, and another, unlike it, over `[100 400 228 496]` clipped to its left half |
| `image-data.pdf` | 612 × 792 | Four 32 × 24 images with metadata in their own data: a JPEG with EXIF, JFXX, IPTC, Adobe and comment segments and bytes after its end (`4400 9501` to `9505`), over `[100 600 228 696]`; a JPEG with EXIF under a Flate layer (`4400 9506`); a JP2 file with XML and UUID boxes and a codestream comment (`4400 9507` to `9509`); and a raw J2K codestream with a comment (`4400 9510`) |
| `structure-keys.pdf` | 612 × 792 | "Structure keys page", drawn through a graphics state whose type-5 halftone has its own `/HalftoneName` (`4400 9603`) beside a colorant's halftone; the catalog has `/constructor /Client4400_9601` and the page `/toString /Client4400_9602`, keys that name JavaScript built-ins |
| `wrong-array.pdf` | 612 × 792 | "Wrong array", on a page whose media box `[0 0 (4400 9604) 792]` holds a string |
| `stray-parent.pdf` | 612 × 792 | "Stray parent", on a page whose `/Parent` is a page-tree node outside the page tree, with `4400 9605`; preparation refuses it |
| `image-filter-names.pdf` | 612 × 792 | Two 32 × 24 JPEGs with EXIF, under the abbreviated filter name `/DCT` with `/ColorTransform 1` (`4400 9511`, over `[100 600 228 696]`) and under `[/Fl /DCT]` with `[null << /ColorTransform 1 >>]` (`4400 9512`, over `[300 600 428 696]`); and a third under `[/FlateDecode /DCTDecode]` whose one `/DecodeParms` dictionary, a PNG predictor, belongs to the Flate layer (`4400 9518`, over `[100 450 228 546]`) |
| `jpeg-extension.pdf` | 612 × 792 | A 32 × 24 JPEG over `[100 600 228 696]` with a JPG0 extension segment holding `Extension 4400 9519` |
| `jpeg-long-adobe.pdf` | 612 × 792 | A 32 × 24 JPEG over `[100 600 228 696]` whose Adobe APP14 holds `4400 9520` after its 12 bytes; preparation refuses it |
| `grey-soft-masks.pdf` | 612 × 792 | Two 32 × 24 RGB images, over `[100 600 228 696]` and `[300 600 428 696]`, whose soft masks are a left-to-right ramp in `CalGray` and in a one-channel ICC profile (a stand-in, drawn by its `/Alternate /DeviceGray`) |
| `shading-graphics-state.pdf` | 612 × 792 | "Shading page" and a square filled with a shading pattern whose `/ExtGState` holds a soft mask group with `/ActualText (4400 9913)` and the text "Mask 4400 9914", which is never drawn |
| `abbreviated-stream-keys.pdf` | 612 × 792 | A JPEG XObject with EXIF (`4400 9915`) whose filter is named `/F /DCTDecode`; preparation refuses it |
| `inherited-text-state.pdf` | 612 × 792 | "Spaced" at y 700 with `3.9 Tc`, then an empty `BT 0 Tc ET`, then a form XObject that draws "Secret text" at x 72, y 650 with `0 Tc` (app box of "Secret" x 72–106.7, y 129.1–145.6) |
| `tight-lines.pdf` | 612 × 792 | "Done to Jane" in 6 pt at x 72, y 700, and "Roe" in 12 pt at y 689.5 ending where "Jane" starts (x 94.68), under the kept "to": the 12 pt line's font height reaches 0.7 pt into the 6 pt line's letters, though their ink does not touch (a drag down x 95.1 from y 88 to 101 selects "Jane Roe") |
| `data-after-end.pdf` | 612 × 792 | A 32 × 24 RGB image over `[100 600 228 696]` whose Flate data is followed by `Tail 4400 9901`, which no reader decodes |
| `image-prefilters.pdf` | 612 × 792 | A JPEG with EXIF (`4400 9902`) under `[/ASCII85Decode /DCTDecode]` over `[100 600 228 696]`, and a JP2 file with an XML box (`4400 9903`) under `[/AHx /JPXDecode]` over `[300 600 428 696]` |
| `jpx-data.pdf` | 612 × 792 | Two 32 × 24 JPEG 2000 images: a raw codestream with `4400 9514` after its end, over `[100 600 228 696]`, and a JP2 file with a second `jp2c` box holding `4400 9515`, over `[300 600 428 696]` |
| `icc-under-dct.pdf` | 612 × 792 | A 32 × 24 image over `[100 600 228 696]` whose ICC profile stream is JPEG data with EXIF (`4400 9516`) under `DCTDecode`; preparation refuses it |
| `inline-jpeg.pdf` | 612 × 792 | "Inline JPEG" and a fully shown inline JPEG over `[100 600 228 696]` with EXIF (`4400 9517`) in its data |
| `image-filter-not-last.pdf` | 612 × 792 | A JPEG with EXIF (`4400 9513`) under `[/DCTDecode /FlateDecode]`, whose image data can't be cut; preparation refuses it |
| `two-roles.pdf` | 612 × 792 | A grey 32 × 24 image with `/Matte` drawn on its own as `/A` over `[100 600 228 696]`, and used as the soft mask of `/B`, an RGB image over `[300 600 428 696]`: as a plain image it keeps no `/Matte`, as a soft mask it does, so preparation refuses it |
| `marked-pattern.pdf` | 612 × 792 | "Marked elsewhere": a tiling pattern's cell content holds `/ActualText (4400 9701)`, used to fill a square |
| `marked-type3.pdf` | 612 × 792 | "Marked elsewhere": a Type 3 glyph's procedure holds `/Alt (4400 9702)`; the page shows that glyph |
| `marked-soft-mask.pdf` | 612 × 792 | "Marked elsewhere": a soft mask's group holds `/E (4400 9703)`; the page draws a blue square through it |
| `marked-escaped-name.pdf` | 612 × 792 | "Marked elsewhere": page content holds `/Actual#54ext (4400 9704)`, the name written with a `#xx` escape |
| `marked-nul-delimiter.pdf` | 612 × 792 | "Marked elsewhere": page content holds `/ActualText` ended by a NUL, then `(4400 9705)` |
| `postscript-xobject.pdf` | 612 × 792 | "PostScript page", which draws a PostScript XObject whose code shows `Client 4400 9801`; PDF 2.0 readers draw nothing for it |
| `null-elements.pdf` | 612 × 792 | "Null elements" and a 32 × 24 grey image over `[72 500 200 596]` whose `/DecodeParms` array holds an explicit `null` for its first filter; explicit `null` values too in each kind of the page's resources, its `/Annots`, the catalog's layer lists and the image's own `/Note` |
| `hybrid-xfa.pdf` | 612 × 792 | "Client name:" and a filled text field "Jane Roe" over `[160 734 360 754]`, with an XFA stream beside the form whose datasets hold `4400 9904`, which the page never shows |
| `xfa-form.pdf` | 612 × 792 | "Please wait...", the page an XFA form shows to a reader without XFA; its catalog's form names an XFA stream, so adding it is refused |
| `visibility-expression.pdf` | 612 × 792 | "Rule page" and a free-text note "On a rule" over `[72 600 300 630]` on a layer rule written as a `/VE` expression, which preparation refuses |

## Leak vectors

`leak-vectors.json` lists ways a PDF can leak, each with a fixture, the mark a test makes
and the checks that judge the output (fields as in `docs/designs/pdf-leak-suite.md`, Detailed
item 28). `tests/e2e/leak-suite.spec.ts` runs one browser test per entry that makes a mark:
the fixture is added, marked, written and judged. Entries that make none are what preparation
alone must clean: one browser test per fixture adds it and judges the working copy the app
stored, which is what a document with no marks downloads as. The list so far covers:

- what MuPDF patch 0003 changed on the write path: image redaction in CMYK, Indexed and
  Separation colour spaces, through a one-pixel image's soft mask and in an inline image, text
  redaction inside marked content, a clip, a layer and a form XObject, and the corrected
  `/P /AnyOff` layer rule;
- the text step 5's content filter must drop from a content stream;
- each preparation rule path: annotations deleted before flattening (hidden, not viewed, on a
  layer that is off, pending redactions, pop-ups), flattened (comments, links, attachments),
  and their flattened text marked; form fields, a hidden one and a signed signature, and a
  flattened value marked; the carriers the allowlist deletes from the catalog, the page and an
  image, and an earlier revision; keys that must be read as the model's alone, a rectangle that
  is not four numbers, and a PostScript XObject; content on a layer that is off, beyond the crop box and the
  media box; image pixels past the page's edge and outside a clip; and metadata inside JPEG
  and JPEG 2000 data.
