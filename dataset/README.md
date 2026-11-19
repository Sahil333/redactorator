# Ground truth

One JSON file per document records the personal data in it.
`ground-truth.schema.json` is the format; `tools/dataset/validate.py` checks a file
against it and against the rules below that JSON Schema can't state:

```
uv run --project tools/dataset python tools/dataset/validate.py truth/*.json
```

The app's labelling mode (`?label`) writes this format, and so will the synthetic
document generator. Real-world documents and their labels never enter this repository.

## Fields

- `schema_version`: 1. A file in an older version must be migrated, never guessed at.
- `document`: `source` (where the file came from), `licence`, `country` (US, UK, CA,
  AU, NZ, IE), `format` (born-digital-pdf, scanned-pdf, image, text), `split`
  (development or test), `sha256` of the file's bytes, and `box_unit`: `pt` for
  PDFs, `px` for images, `none` for text.
- `entities`: one per spelling. `type` is a DET-1 type, `signature`, `photo` or
  `other`, or `custom:<name>` for a type the labeller typed in. `value` is the text,
  and is left out for a box with no text behind it (a signature, a photo).
  Spellings of the same person or thing share a `link_id`.
- `occurrences`: each place an entity appears. `page` is zero-based. `boxes` are the
  authority. `start` and `end` (end exclusive) are offsets in the page text, given
  for text and left out for a box with no text behind it.
- `hidden_occurrences`: an entity in metadata, an annotation, a form field or a
  hidden layer, with where it sits (for example `Info/Author`). For the leak suite.

Validator rules beyond the schema: ids are unique and every `entity_id` names an
entity; `start < end`; every box has `x0 < x1` and `y0 < y1`; `box_unit` fits the
format; a PDF or image occurrence has at least one box; a text occurrence has
offsets and no boxes.

## Boxes

PDF boxes are in the engine's box convention: points in MuPDF's page space, origin
top-left, y down, with the page's rotation and crop box applied. Image boxes are
pixels from the top-left.

## Offsets

The page text is the text MuPDF.js extracts (structured text, whitespace kept),
with its blocks, and the lines in each block, put in reading order: top to bottom,
with side-by-side columns kept in MuPDF's order (`readingOrder` in
`engine/pageText.ts`). It is built as: the characters of each line in order, `\n`
after each line, and one more `\n` after each block. Lines and blocks with no
characters add nothing. Offsets count those characters, so they line up with the
app's findings. A tool using another extractor derives its offsets from the boxes.
