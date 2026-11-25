# Engine

## Overview

Everything below the UI. The engine reads PDFs, keeps projects, tracks marks
and approval, and writes cleaned files, all in the browser. The app talks to it
through one `Engine` object (`./api`). `./core` implements that object. The PDF
work runs in a Web Worker (`./pdf`). `./host-browser` supplies the browser
pieces the core asks for: the worker, Web Locks and File System Access stores.

Each subfolder is a fallow zone, and `.fallowrc.json` limits which zones each
one may import (see Invariants).

## Interface

- `globals.ts`: declares the three platform globals the engine uses without the
  DOM library: `crypto.randomUUID`, `crypto.subtle.digest("SHA-256", …)` and
  `TextDecoder.decode`. It is listed as a fallow `supportEntry` and in
  `tsconfig.base.json` `files`.
- `tsconfig.base.json`: ES2024 with no DOM types. `model`, `storage`,
  `pdf-protocol`, `api`, `core` and `pdf` each extend it with their own
  tsconfig. Two exceptions: `pdf/worker.ts` is built by
  `pdf/tsconfig.worker.json` (adds the `WebWorker` lib), and `host-browser`
  has no tsconfig; the root `tsconfig.json` typechecks it with the DOM
  libraries. `tsconfig.test.json` typechecks the engine's `*.test.ts` files
  with vitest types.
- Subdirectories:
  - [api](./api/README.md): the public contract. `Engine`, `Library`, `Session`, `EngineState` and the error model. Types only.
  - [core](./core/README.md): `createEngine`, which holds the dispatcher, the Library, the open Session, intake and the PDF-worker client.
  - [model](./model/README.md): the shared data model and functions over it (geometry, text, marks, matching, images, projects, spreading, ground truth). All are pure except `newDocumentId`, which calls `crypto.randomUUID()`.
  - [storage](./storage/README.md): the `Store` port, the only route to project storage.
  - [pdf-protocol](./pdf-protocol/README.md): the request and reply messages between the core and the PDF worker, and their parsers.
  - [pdf](./pdf/README.md): the PDF worker (MuPDF). Inspect, match, open, render, text and apply.
  - [host-browser](./host-browser/README.md): `createBrowserEngine`, which fills the core's ports with browser APIs.

## Invariants

- Zone imports allowed by `.fallowrc.json` `boundaries.rules`:
  - `model` and `storage` import no other zone.
  - `pdf-protocol` imports `model`.
  - `api` imports `model` and `storage`.
  - `core` imports `model`, `storage`, `api` and `pdf-protocol`.
  - `pdf` imports `model`, `pdf-protocol` and `pdf-apply`.
  - `pdf-apply` (`pdf/apply.ts`) imports `model`, `pdf-protocol`, `pdf` and
    `pdf-write`. It is the only zone that may import `pdf-write`
    (`pdf/write/**`), which imports only `model` and `pdf`.
  - `host-browser` imports `model`, `storage`, `pdf-protocol`, `api` and `core`.
    One line is exempt: `host-browser/workerChannel.ts` names
    `../pdf/worker.ts` to start the worker, under a
    `fallow-ignore-next-line boundary-violation` comment.
  - `app` imports `model`, `storage`, `api` and `host-browser`, and `tests`
    may import every zone.
- Only `host-browser` and the worker entry `pdf/worker.ts` use DOM or worker
  APIs. The rest of the engine compiles against `tsconfig.base.json` (ES2024,
  no DOM) and uses only the three globals in `globals.ts`: `crypto.randomUUID`
  (`model/project.ts`, `core/stored/projects.ts`), `crypto.subtle.digest`
  (`core/intake.ts`) and `TextDecoder` (`core/stored/projects.ts`).

## Side Effects

- `globals.ts` declares types only and has no runtime effect.
- The subfolders' effects are listed in their READMEs. In short: Web Worker
  messages (`pdf`, `core/pdf-client`), File System Access reads and writes
  (`host-browser`, through `core/stored`), and Web Locks (`host-browser`). None
  of the engine READMEs lists a network request.

## Verification

- Run: `pnpm test`
