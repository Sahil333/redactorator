# Redactorator Blueprint

## System Overview

Redactorator is a browser-only app that removes or pseudonymises personal data
in documents. Nothing a user loads leaves the browser. Today it handles PDFs.

The app (`./app`, React 19) talks to one `Engine` object. The engine core keeps
projects in a folder the user picks, or in the browser's private storage. It
does all PDF work in a Web Worker that runs MuPDF compiled to WebAssembly
(vendored in `vendor/mupdf`). A cleaned file is written with the marked text
deleted, then re-opened and checked before the user can save it. Line art is
the exception today; see Global Invariants.

The core never names a browser API. It asks for a worker channel, a project
lock and a store through ports, and `engine/host-browser` fills them.

```text
app (React UI)
  └─ engine/host-browser: createBrowserEngine
       ├─ workerChannel.ts: new Worker(engine/pdf/worker.ts) ──────────────┐
       ├─ locks.ts: Web Locks                                              │
       ├─ stores.ts: File System Access (picked folder or private storage) │
       └─ engine/core: createEngine (dispatcher, Library, Session)         │
            ├─ engine/core/stored ── Store port (engine/storage)           │
            └─ engine/core/pdf-client ── WorkerChannel port ───────────────┤
                 (messages typed and parsed by engine/pdf-protocol)        │
engine/pdf/worker.ts (Web Worker, MuPDF) ◄─────────────────────────────────┘
  └─ engine/pdf/apply.ts ── engine/pdf/write: writeAndCheck
```

## Local Interface & Invariants

- `tsconfig.json`: typechecks `app`, `engine/host-browser`, `tests` and the
  `*.config.ts` files with the DOM libraries. Each other engine folder has its
  own tsconfig over `engine/tsconfig.base.json` (no DOM); see
  [engine/README.md](./engine/README.md).
- `vite.config.ts`: builds `app/` into `dist/`, or into `dist-coverage/` with
  istanbul instrumentation of `app/` and `engine/` when `COVERAGE=1`.
  `pnpm preview` serves on `127.0.0.1:4173` with a Content-Security-Policy
  header that allows scripts, workers, fonts, images, styles and connections
  only from the app's own origin (`'self'`), plus `'wasm-unsafe-eval'`. It is
  sent as a header so the worker gets it too.
- `playwright.config.ts`: browser tests in `tests/e2e` run in Chrome against a
  build served by `pnpm build && pnpm preview`. Under `pnpm test` they run
  through `test:coverage` (`COVERAGE=1`), so the build is the instrumented
  `dist-coverage/` one. The CSP header is the same in both builds.
- `vitest.config.ts`: unit tests are the `{app,engine}/**/*.test.{ts,tsx}`
  files next to the code.

## Subdirectories & System Boundaries

- app: [./app/README.md](./app/README.md) - The browser UI. It starts the engine once a store is chosen, shows the project list or an open project, and draws engine-rendered pages on canvases. Outputs leave only as local saves.
- engine: [./engine/README.md](./engine/README.md) - Everything below the UI: the public API, the core (Library and Session), the data model, the storage port, the PDF worker and its protocol, and the browser host.
- tools: [./tools/README.md](./tools/README.md) - Python developer tools. `tools/dataset` validates ground-truth files.
- tests/e2e - The Playwright browser tests, one per behaviour a user sees. They call the outside checker through `tests/e2e/oracle.ts`.
- tests/oracle: [./tests/oracle/README.md](./tests/oracle/README.md) - The outside checker that judges written outputs. It shares no code with the app or MuPDF.
- fixtures - Synthetic test PDFs, written by `tests/oracle/make_fixtures.py`, and `fixtures/golden/`: storage an earlier build wrote, with the records expected after reading it, used by `tests/e2e/golden.spec.ts` to prove old projects still open.
- dataset: [./dataset/README.md](./dataset/README.md) - The ground-truth schema and dataset notes.
- docs - Copies of the live PRD, HLD and Implementation Plan (not edited here), and `docs/designs/`, design documents written in this repo.
- vendor/mupdf: [./vendor/mupdf/README.md](./vendor/mupdf/README.md) - The vendored MuPDF WebAssembly package (third-party).

## Global Invariants

- No outbound request with document data: no file in `app/` or `engine/`
  calls `fetch`, `XMLHttpRequest`, `sendBeacon`, `WebSocket` or `EventSource`.
  The only requests are for the app's own bundled files, such as the font
  `app/main.tsx` imports. The CSP above limits connections to `'self'`.
- Redaction deletes text and blanks image pixels before it covers.
  `engine/pdf/write/redact.ts:redact` removes the glyphs under each mark
  (judged on each text mark's ink band, or on a drawn box) and sets image
  pixels under each box to one value, and only then draws the boxes. `engine/pdf/write/index.ts:writeAndCheck` re-opens the result and
  `engine/pdf/write/check.ts:check` throws `CheckFailed` when text or image
  content is left under a box, when the trailer `Info` or catalog `Metadata`
  is still there, or when the file is not one unencrypted revision. A failed
  check produces no output (`engine/pdf/apply.ts:apply`). The exact limits of
  each check are in [engine/pdf/write/README.md](./engine/pdf/write/README.md).
- Known gap: line art. `redact` removes a vector path only when a box covers
  all of it (`REDACT_LINE_ART_REMOVE_IF_COVERED`). A path a box only partly
  covers stays in the file under the painted box, and `check` does not look at
  line art. This is a planned Phase 3 leak fixture (`docs/HLD.md`,
  `docs/Implementation-Plan.md`).
- Zone imports are limited by `.fallowrc.json` `boundaries.rules`, which
  `pnpm test` checks with `fallow architecture --boundaries`. `app` may import
  only `model`, `storage`, `api` and `host-browser`. One line is exempt:
  `engine/host-browser/workerChannel.ts` names `../pdf/worker.ts` under a
  `fallow-ignore-next-line boundary-violation` comment. The full table is in
  [engine/README.md](./engine/README.md).
- One tab at a time holds a project, through a Web Lock named
  `redactorator-project:<projectId>` (`engine/host-browser/locks.ts:webLocks`).

## Global Side Effects

- File System Access reads and writes in the user's picked folder or in
  `navigator.storage.getDirectory()`: original documents, `.redactorator/`
  records and settings.
- IndexedDB `redactorator` (the picked folder's handle only) and
  `sessionStorage` (open tab ids only), both from `app/`.
- One module Web Worker for PDF work, and Web Locks for projects.
- Saved outputs go to a file the user chooses (`showSaveFilePicker`), or to a
  browser download.

## System Verification

- Run: `pnpm test`, which runs the typecheck, fallow boundaries, vitest, the
  Python tools tests, the Playwright browser tests with coverage, and
  `fallow audit`.
