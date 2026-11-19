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
| `metadata` | — | No Info dictionary, no XMP, exactly one revision |
| `covered` | `word` | A filled shape in the output covers the word's box as pdfminer reads it in the input |
| `positions` | `words` | Every glyph of the input outside the given words is in the output at the same place (0.5 pt) |
| `pixels` | `region` | Image pixels wholly inside the region are one colour; pixels wholly outside are unchanged |

`region` is PDF user space as pdfminer lays out the page: points, origin
bottom-left. Input and output are always read the same way, so no check depends
on the app's own box convention.

## Fixtures

`make_fixtures.py` writes them into `fixtures/` byte by byte; each builder can also
write the "cleaned" file a correct redaction should produce, which the checker's
own tests (`tests/`) use. All values are synthetic.

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
| `cross-page.pdf` | 612 × 792, three pages | "… signed by Jane" ends page 1 (x 236.1–262.1, y 99.1–115.6) and "Roe, on behalf …" starts page 2 (x 72.0–97.3, y 79.1–95.6). Each page draws its header "Agreement 2026" after the body, then a footer "Page N of 3". Page 2 has two side-by-side columns whose lines are 15 pt apart, so their character boxes overlap; page 3 starts "Closing words of the claim." |
| `table.pdf` | 612 × 792 | A two-column table drawn row by row ("Engagement" / "Design and build", "Duration" / "Three months from the start," and "in four parts", "Monthly fee" / "Fifty thousand rupees each month"), left cells at x 72 and right at x 320, between a line above and a line below that start at x 64 |
| `masked-image.pdf` | 612 × 792 | `image.pdf`'s image and place, with a soft mask (SMask) holding a filled circle that crosses the image's left half |
