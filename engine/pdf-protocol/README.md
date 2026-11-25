# engine/pdf-protocol

## Overview

The message contract between the UI side and the PDF Web Worker
(`engine/pdf`). It holds the request and reply types, plus the parsers that turn
an untrusted `postMessage` payload into a typed message or `undefined`. The
code is pure, with no state.

Importers: `engine/pdf` (see [../pdf/README.md](../pdf/README.md)),
`engine/core/pdf-client/`, and `tests/e2e/fakes.ts`.

## Interface

`messages.ts`:

- Branded numbers, and the guard for each: `FileNumber` / `isFileNumber`,
  `PreparationNumber` / `isPreparationNumber`, `MatchNumber` / `isMatchNumber`.
  Each guard accepts only a positive integer.
- `READER_TAG` (`"pdf-3"`): how this build prepares and reads PDFs, its MuPDF
  build included. It changes on any change to preparation, to reading, or to
  `vendor/mupdf`'s patches or `SHA256SUMS`. The core reads it from here, so
  the core and the worker share one constant.
- `PdfRequest`: one of `prepare` (`preparation`, `bytes`), `match` (`match`,
  `keys`, `documents` as each page's characters), `open` (`file`, `bytes`),
  `render` (`file`, `source`, `page`, `scale`), `text` (`file`, `page`), or
  `apply` (`file`, `edits`, `appearance`).
- `PdfReply`: one of `ready` (`readerTag`), `prepared` (`preparation`,
  `preparedBytes`, `reading`, `removed`), `matched`, `refused`, `opened`,
  `rendered`, `text`, `applied` (`bytes`, `output`), or `error`
  (`file: FileNumber | undefined`).
- `engineErrorCodes`: `open-failed`, `encrypted`, `render-failed`,
  `text-failed`, `apply-failed`, `check-failed`, `unsupported-form`,
  `prepare-failed`, `mark-lost`, `extra-text-removed`, `text-moved`,
  `partly-covered-drawing`, `bad-message`.
- `PdfError { code, message?, data? }`, where `PdfErrorData` is
  `{ page?, boxes? }`. `DocumentFound` extends `Found` with `document` and
  `page`.

`parse.ts`:

- `parsePdfRequest(data: unknown): PdfRequest | undefined`
- `parsePdfReply(data: unknown): PdfReply | undefined`

## Invariants

- **Parsers fail closed.** A payload with an unknown `type`, or any field that
  fails its guard, parses to `undefined`. Nested values are parsed with
  `parseAll`, which drops the whole message when one element fails
  (`parse.ts`).
- **What each message must carry.**
  - `prepare` and `match` carry no `file`. Every other request needs a valid
    `FileNumber` (`parsePdfRequest`).
  - The `bytes` of `prepare`, `open` and `applied`, and `prepared`'s
    `preparedBytes`, must be an `ArrayBuffer`.
  - `render.scale` must be a positive number. `source` must be `"original"`
    or `"output"` (`isSource`).
- **Reply shape.**
  - `rendered.image` needs positive integer `width`/`height` and a
    `Uint8ClampedArray` backed by an `ArrayBuffer` whose length is
    `width * height * 4` (`parsePixels`).
  - Each `matched.found` entry needs `start < end` (`parseFound`).
  - An error's `code` must be one of `engineErrorCodes`, its `message` absent
    or a string, and its `data` absent or holding only a `page` and `boxes`,
    so no document text can ride along (`parseEngineError`).
  - `ready` must carry a reader tag; the client stops a worker whose tag is
    not `READER_TAG`.
  - Each `prepared.removed` entry must be a `RemovalKind`.
  - `error.file` is either `undefined` (the worker could not read the request)
    or a valid `FileNumber`.
- The worker echoes `file` in every file reply, so the UI can drop a reply
  about a file the user has since replaced (comment in `messages.ts`).
- The worker sends `applied` only when the output passed every check. Otherwise
  it sends `error` with code `check-failed` (comment in
  `messages.ts:PdfReply`; enforced in `engine/pdf/apply.ts`).
- `engineErrorCodes` is every `ReaderErrorCode` and `WriterErrorCode`, from the
  model's `readerErrorCodes` and `writerErrorCodes`, and `bad-message`.
- **Boundary.** `.fallowrc.json` zone `pdf-protocol` may import only `model`.

## Side Effects

- None. These are types and pure parsers.

## Verification

- Run: `pnpm test` (this includes `tsc -p engine/pdf-protocol` and the
  `fallow architecture --boundaries` check).
