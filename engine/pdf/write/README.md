# engine/pdf/write

## Overview

The PDF write path. It turns the user's edits into MuPDF redactions on a fresh
copy of the original file's bytes, deletes the text, image pixels and wholly
covered vector paths under each mark, draws the boxes (and optional labels),
strips metadata, saves the file as a single revision without encryption, then
re-opens the result and checks it. If a check fails it throws `CheckFailed`.
Other errors propagate as plain errors. Either way no output is returned.
A vector path a box covers only in part is not removed (see Invariants).

The only caller is `engine/pdf/apply.ts` (see [../README.md](../README.md)).

## Interface

Public entry (`index.ts`):

- `writeAndCheck(original: mupdf.PDFDocument, bytes: Uint8Array, edits: readonly Edit[], appearance: Appearance): { bytes: Uint8Array<ArrayBuffer>; output: mupdf.PDFDocument }`
  writes the cleaned file and checks it. On success the caller owns `output`
  and must `destroy()` it.
- `CheckFailed` (class, extends `Error`, re-exported from `common.ts`): its
  `message` is a reason the user sees.

Used inside the folder:

- `common.ts`: `Redaction { box, textArea, printed }`, `openPdf(bytes)`.
  `openPdf` throws `CheckFailed` ("The cleaned file could not be read back.")
  when the bytes do not open as a `PDFDocument`. It opens both the written
  output (`index.ts:writeAndCheck`) and the input bytes (`redact.ts:redact`).
- `redact.ts`: `redactionsByPage(original, edits): Map<PageIndex, Redaction[]>`,
  `redact(bytes, byPage, appearance): Uint8Array<ArrayBuffer>`.
- `check.ts`: `check(original, output, byPage, appearance): void` (RED-3).

`Edit` and `Appearance` come from `engine/model/document.ts`. `Box` and
`PageIndex` come from `engine/model/geometry.ts`.

## Invariants

- **Delete, then cover.** For each page, `redact.ts:redact` first applies
  Redact annotations over each `textArea` with `REDACT_TEXT_REMOVE`. It then
  applies them over each `box` with `REDACT_IMAGE_PIXELS` and
  `REDACT_LINE_ART_REMOVE_IF_COVERED`. Only after both passes does
  `drawBoxes` paint the filled boxes.
- **Line art is removed only when wholly covered.** With
  `REDACT_LINE_ART_REMOVE_IF_COVERED` (`redact.ts:redact`), MuPDF removes a
  vector path only when a box covers all of it. A path a box only partly
  covers stays in the file under the painted box, and `check` never inspects
  line art or shadings. This is a known leak, tracked as a Phase 3 leak
  fixture in `docs/HLD.md` and `docs/Implementation-Plan.md`.
- **Text area is the ink, not the font box.** A text edit's `textArea` is the
  letters' ink band from `readText(...).ink`, so that removal does not reach
  into closely set neighbouring lines (`common.ts:Redaction.textArea`,
  `redact.ts:textAreas`).
- **Marks must match the text.** If a text edit runs past the page's
  characters, covers no line boxes, or its line boxes and ink bands differ in
  count, `textAreas` throws `CheckFailed`. If an edit names a page past `countPages()`,
  `redactionsByPage` throws a plain `Error`. In both cases the write stops.
- **Every write starts from the bytes given.** `openPdf` opens
  `bytes.slice(0)`, and `redact` works on its own document, which it destroys
  in `finally`. The `original` document is only read
  (`redactionsByPage`, `check`).
- **Labels are sanitised.** `printed` is `[` + the label in upper case + `]`,
  with each character outside WinAnsi (Latin-1 printable) replaced by `?`
  (`redact.ts:inWinAnsi`). The label is written as a PDF hex string
  (`pdfString`) in Helvetica/WinAnsiEncoding under the resource name
  `/RedactLabel`. The font is added only when `appearance.label` is on.
- **How boxes and labels are drawn.** `drawBoxes` fills each box with
  `appearance.colour`. The label ink is black when the fill's luminance is
  above 140, white otherwise. The label's font size is the smaller of
  0.7 × box height and the size at which its Helvetica AFM widths
  (`redact.ts:HELVETICA_WIDTHS`, 600 for other characters) fill 0.9 × box
  width; it is centred in the box.
- **Existing page content is isolated.** `drawBoxes` wraps the page's existing
  `Contents` in `q`/`Q`, so a graphics state it leaves set cannot move the
  boxes. The boxes are drawn through the inverse of the page transform.
- **Metadata removed.** `redact` deletes the trailer `Info`, `Root/Metadata`,
  and every page's `Metadata`. It saves with
  `"garbage=4,compress,encrypt=none"`: a full rewrite, one revision, objects
  nothing refers to are dropped, and there is no encryption.
- **Checks before return (fail closed).** `check.ts:check` throws
  `CheckFailed` in any of these cases:
  - the output does not have exactly one version;
  - the trailer has `Encrypt`;
  - the trailer has `Info` or `Root/Metadata`;
  - on any redacted page, a non-whitespace letter of the original that no
    `textArea` touches is missing or has moved by more than 0.05 pt
    (`glyphs.ts:textMoved`). A letter counts as touched when a `textArea`
    overlaps its `body` or contains its centre. For a text edit the
    `textArea` is the ink band, which is smaller than the box;
  - a non-whitespace glyph overlaps a box with its `body`, and its centre is
    not inside any box (`textUnderBoxes`). The `body` runs only from the
    baseline up to 0.7 × font size (`geometry.ts:bodyOf`), so descenders and
    anything above that height can sit under a box without failing. A glyph
    whose centre is inside any box is exempt here;
  - the glyphs centred in a box, with all whitespace removed, differ from its
    label with all whitespace removed (or from nothing when labels are off)
    (`textUnderBoxes`);
  - any image or image mask under a box is not one uniform value across the
    pixels the box overlaps (`imagesUnderBoxes`, `blankUnder`).

  An error raised while judging an image counts as a failure
  (`imagesUnderBoxes`: `failed`).
- **Which errors are `CheckFailed`.** Inside `check`, only errors raised while
  judging an image are caught and turned into a failed check. Any other throw
  propagates as a plain `Error`: from `withPage`, `glyphsOf` or `page.run`,
  or "A box is not a finite size" from `geometry.ts:around`. A plain
  `Error` from `redactionsByPage` (page past `countPages()`) or from MuPDF
  during `redact` propagates the same way. `apply.ts` reports these as
  `apply-failed`, not `check-failed`. Both stop the write.
- **Scope of the check.** `check` inspects only pages present in `byPage`. It
  does not re-check page-level `Metadata`, which only `redact` removes. It
  never inspects line art or shadings: its device collects only
  `fillImage`, `fillImageMask` and `clipImageMask`
  (`check.ts:imagesUnderBoxes`).
- **The output is destroyed on failure.** `writeAndCheck` destroys `output` if
  `check` throws, then re-throws.
- **Boundary.** `.fallowrc.json` zone `pdf-write` may import only `model` and
  `pdf`. Within `engine/pdf`, only `apply.ts` (zone `pdf-apply`) may import this
  folder.
- Any change to how this code writes output needs a leak fixture judged by the
  outside checker in `tests/oracle/` (AGENTS.md).

## Side Effects

- Allocates MuPDF (WebAssembly) documents, pages, pixmaps, structured text
  and devices, and frees each one in `finally`. The exception is the `output`
  returned on success. The `PDFAnnotation`s from
  `page.createAnnotation("Redact")` and the `PDFObject`s created or fetched in
  `drawBoxes`, `redact` and `check` are never destroyed explicitly.
- Mutates only the private copy opened in `redact`. It adds Redact
  annotations, the content streams, the `/RedactLabel` font and, if missing,
  `Resources`/`Font` dictionaries.
- No network, storage or DOM access.

## Verification

- Run: `pnpm test` (this includes `tsc -p engine/pdf`, the
  `fallow architecture --boundaries` check, and the Python oracle in
  `tests/oracle/`).
