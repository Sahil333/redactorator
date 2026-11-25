# engine/pdf

## Overview

The PDF engine runs inside a Web Worker. It answers requests from the UI (see
[../pdf-protocol/README.md](../pdf-protocol/README.md)) using the vendored
`mupdf` package (`vendor/mupdf`, third-party), and does the following:

- prepares a file before it is added, making its working copy (see
  [./prepare/README.md](./prepare/README.md));
- searches documents' text for keys;
- opens one working copy at a time;
- renders pages of the working copy or the cleaned output;
- reads a page's text;
- applies the user's edits through the write path in [./write/README.md](./write/README.md).

`engine/host-browser/workerChannel.ts` starts the worker from `worker.ts`.

## Interface

- `worker.ts`: the Web Worker entry. It wires `setSend` to `postMessage`,
  routes every `message` event to `handle`, and posts
  `{ type: "ready", readerTag: READER_TAG }`.
  It is built separately by `tsconfig.worker.json` (lib `WebWorker`). The main
  `tsconfig.json` excludes it and `*.test.ts`.
- `handler.ts`: `handle(data: unknown): void`. It parses the request with
  `parsePdfRequest` and dispatches to the handler for that request type.
- `messages.ts`: `setSend(fn)`, `post(message, transfer?)`,
  `fail(file, code, message?, data?)`. A code with no message has the app's
  own sentence; slice 3's refusals pass none.
- `state.ts`: `open(file, bytes)`, `current(file)`,
  `sourceDocument(file, source)`. The held document is the working copy;
  `Source` `"original"` names it.
- `apply.ts`: `apply(file, edits, appearance)`.
- `prepareFile.ts`: `prepareFile(preparation, bytes)`, which posts `prepared`
  (the working copy's bytes transferred) or `refused`.
- `readingOptions.ts`: `READING_OPTIONS`, how every reading of text runs:
  `"preserve-whitespace,ignore-actualtext"`. It imports nothing.
- `match.ts`: `match(number, keys, documents)`, which uses
  `engine/model/match.ts:findAll`.
- `render.ts`: `render(file, source, index, scale)`.
- `text.ts`: `readText(page)` (returns `{ text, ink }`, read with
  `READING_OPTIONS`), `pageText(page)`, `withPage(document, index, use)`, and
  `text(file, index)`.
- `read.ts`: `load(bytes)` (returns a document and its model, or an
  `encrypted` or `open-failed` refusal with its sentence), and
  `documentModel(document)`.
- `images.ts`: `placedImages(page, index): PlacedImage[]`.
- `geometry.ts`: `quadCorners`, `transform`, `around`, `bodyOf`.
- `glyphs.ts`: `PageGlyph` (with `origin`, where its baseline starts),
  `glyphsOf(page, options)`, `centre`, `inside`, `overlap`, `missingGlyphs`,
  `movedGlyphs` and `textMoved`.
- `allowlist.ts`: `stripToAllowlist(document)` (preparation's step 7) and
  `keyOutsideAllowlist(document)` (its check mode). Both walk every object
  reachable from the trailer and give each a role, one of the Arlington PDF
  Model's types, by the key and parent that lead to it and the values that
  tell its candidates apart (docs/designs/pdf-leak-suite.md, Appendix A.1).
- `allowlistRoles.generated.ts`: the role table, written by
  `tools/arlington/generate.py` from `vendor/arlington` and our decisions in
  `allowlist-decisions.json`. Edit the decisions, never the table.
- `imageData.ts`: `cutJpeg` and `cutJpx`, which cut metadata from an image's
  encoded bytes without decoding it (Appendix A.2).
- `structure.ts`: `checkStructure(document)`, the structural check that
  preparation and the writer's gate share: one unencrypted revision, no
  annotations or form, and no key outside the allowlist.
- `objects.ts`: `nameAt` and `objectAt`, lookups by path that stop at the
  first missing object, which MuPDF.js would otherwise throw on.
- Subdirectory: [prepare/](./prepare/README.md). Preparation,
  `prepareDocument`.
- Subdirectory: [write/](./write/README.md). The PDF write path,
  `writeAndCheck` and `CheckFailed`.

## Invariants

- **One worker entry.** `worker.ts` is the only file here that knows it runs in
  a worker. The other files reach the UI only through `messages.ts:post`.
- **Replies keep request order.** `handle` is synchronous, so replies leave in
  the order requests came. A request that fails to parse gets an `error` with
  code `bad-message` and `file: undefined`.
- **One open document.** `state.ts:open` destroys the previous working copy
  and output before loading a new file. `current(file)` returns nothing when `file`
  is not the open file, so stale requests fail. The opened `bytes` are a copy,
  and each `apply` starts again from them.
- **Password-protected files are refused.** If `needsPassword()` is true,
  `read.ts:load` returns `encrypted` and never processes the file in part
  (DOC-4). A file with no pages, or one that fails to open, is refused with
  `open-failed`. `documentModel` requires every page to have a positive, finite
  size.
- **Apply fails closed.** `apply.ts:apply` destroys the previous output first.
  It posts `applied` (with the bytes transferred) only after `writeAndCheck`
  passed and the output has pages. Any throw destroys the output and posts
  `check-failed` (for a `CheckFailed`) or `apply-failed` (for anything else).
  In both cases the message says "Nothing was exported".
- **Error text is fixed.** Every message posted through `fail` or `refused` is
  a fixed string. At most it adds a page number or a `CheckFailed` message,
  which is itself fixed text plus a page number. A refusal from preparation
  carries a code alone. Messages from other caught exceptions are dropped
  (`apply.ts`, `render.ts`, `text.ts`, `prepare/index.ts`, `read.ts`).
- **Preparation keeps nothing.** `prepareDocument` destroys every document it
  opened. `prepareFile` posts either `prepared` (the working copy, each page's
  text and its placed images, and the removed kinds) or `refused`.
- **The allowlist deletes, never keeps.** A key its role does not allow is
  deleted and its kind recorded. An object two roles disagree on, or one with
  no role, refuses the document. The trailer's `Encrypt` stays, unwalked,
  until step 8's save drops it, as MuPDF still encrypts what it writes before
  then. Appendix A.1 of the design holds the full rules.
- **Stream data is cut or written again.** JPEG and JPEG 2000 images lose
  their metadata, behind any lossless filters, which are undone; every other
  stream whose filters are all lossless is written again from its decoded
  bytes, so nothing after its end of data stays (Appendix A.2). A one-channel
  grey soft mask becomes `DeviceGray`.
- **What counts as a placed image.** `images.ts:placedImages` collects
  images drawn through `fillImage` and `fillImageMask` only, not
  `clipImageMask`. An image's fingerprint comes from its colour, or from its
  soft mask when the colour alone is plain (`images.ts:fingerprintOfImage`).
  It skips the following:
  - images smaller than `MIN_IMAGE_SIDE`;
  - images covering less than 1 pt² of the page or more than half of it;
  - images with no fingerprint;
  - images that throw while being read.
- **Line breaks read as spaces.** In `text.ts:readText`, a `"\n"` glyph reads
  as `" "` but keeps its box. Lines and blocks end with a `LINE_END` that has
  no box.
- **Boundaries** (`.fallowrc.json`):
  - zone `pdf` may import `model`, `pdf-protocol`, `pdf-apply` and
    `pdf-prepare-file`;
  - `pdf-prepare-file` (`prepareFile.ts`) may import `model`, `pdf-protocol`,
    `pdf` and `pdf-prepare`; `pdf-prepare` (`prepare/`) may import `model`
    and `pdf`, so preparation answers with model codes alone;
  - `pdf-apply` (`apply.ts`) may import `model`, `pdf-protocol`, `pdf` and
    `pdf-write`;
  - so `apply.ts` is the only way into `write/`.

## Side Effects

- Sends replies to the UI thread with `postMessage`. The `applied` and
  `prepared` bytes and the `rendered` pixel buffers are transferred, not copied
  (`apply.ts`, `prepareFile.ts`, `render.ts`).
- Module-level state: the `send` function (`messages.ts`) and the single
  `opened` document (`state.ts`).
- Allocates MuPDF (WebAssembly) memory. It is freed in `finally` blocks, apart
  from the held working copy and output. Both are destroyed on the next `open`,
  and the held output is also destroyed at the start of the next `apply`.
- No network, storage or DOM access (the code only calls `postMessage` and
  `addEventListener`).

## Verification

- Run: `pnpm test` (this includes `tsc -p engine/pdf`,
  `tsc -p engine/pdf/tsconfig.worker.json`, the
  `fallow architecture --boundaries` check, and the oracle in `tests/oracle/`).
