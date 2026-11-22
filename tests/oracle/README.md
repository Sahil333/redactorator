# The outside checker

Judges every file the app exports, with tools that share no code with the app or
MuPDF: pdfminer.six for text and geometry, Pillow for image pixels, and our own
raw scan (`oracle/raw.py`) that inflates every stream and decodes every string.

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

A pixel's place on the page follows the matrix the image is drawn with, so a
turned or resized image is judged where its pixels actually land.

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
| `line-feed-glyph.pdf` | 612 × 792 | Two lines at x 72, 12 pt. Its font names byte 10's glyph `uni000A`, so the first line, "Dear Jane Roe", then a line-feed glyph, then " thank you for writing to us.", draws a line break as a glyph with a box: "Jane Roe" at x 101.3–152.7 and the glyph at x 152.7–156.0, y 79.1–95.6 |
