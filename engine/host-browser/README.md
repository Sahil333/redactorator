# engine/host-browser

## Overview

The browser host. It puts the engine together for a web page by filling the
ports of `engine/core` (`WorkerChannel`, `LockPort`) and the storage port
`Store` with browser APIs:

- a module Web Worker that runs MuPDF;
- Web Locks;
- the File System Access API, which covers both the site's private storage and a
  folder the user picked.

The app imports it from `app/App.tsx`, `app/useProjectsFolder.ts` and
`app/download.ts`.

The fallow boundary rules in `.fallowrc.json` limit this folder to importing
`model`, `storage`, `pdf-protocol`, `api` and `core`. The one exception is
`workerChannel.ts`, which names the worker entry `../pdf/worker.ts` under a
`fallow-ignore-next-line boundary-violation` comment. The folder has no
`tsconfig.json` of its own. The root `tsconfig.json` includes it and compiles it
with the DOM libraries.

## Interface

- `createBrowserEngine(first: FirstStore): Engine` (`createBrowserEngine.ts`)
  calls `createEngine` from `engine/core` with one object: the fields of the
  first store the app worked out, plus `worker: startPdfWorker()` and
  `lock: webLocks` (`createBrowserEngine.ts:createBrowserEngine`). It returns the
  `Engine` from [engine/api](../api/README.md).
- `webLocks: LockPort` (`locks.ts`) holds a lock per open project.
- `folderStore(root)` (`stores.ts`) is a [`Store`](../storage/README.md) over a
  `FileSystemDirectoryHandle`.
- `privateStore()` (`stores.ts`) is asynchronous. It resolves to a `Store`:
  `folderStore` over `navigator.storage.getDirectory()`, the site's private
  storage.
- `writeWhole(file, data)` (`stores.ts`) writes a whole file through
  `createWritable`.
- `startPdfWorker(): WorkerChannel` (`workerChannel.ts`) starts the PDF worker
  and wraps `postMessage`, `message`, `messageerror`, `error` and `terminate`.

## Invariants

- A store path must stay inside the store. `segments` throws
  `"A store path must stay inside the store"` for a leading `/` or a `..`
  segment, because a document's file name can come from an imported project
  file (`stores.ts:segments`). A path that names no file throws
  `"A path names no file"` (`stores.ts:folderStore.parent`).
- A file changes only once the whole write lands. `writeWhole` writes to a
  writable copy and closes it. If the write fails, it aborts the writable and
  rethrows the error (`stores.ts:writeWhole`).
- `read` returns `undefined` on `NotFoundError` and rethrows any other error.
  `remove` ignores `NotFoundError` (`stores.ts:folderStore`).
- One tab at a time holds a project. `webLocks.acquire` requests the lock with
  `ifAvailable: true` and resolves `undefined` when another holder has it. The
  lock is held until `release()`, or until the tab closes (`locks.ts:webLocks`).

## Side Effects

- Starts a module Web Worker from `../pdf/worker.ts`, and terminates it on
  request (`workerChannel.ts:startPdfWorker`).
- Holds Web Locks named `redactorator-project:<projectId>`
  (`locks.ts:webLocks`).
- Reads, writes, lists and recursively removes files and folders through the
  File System Access API. That covers the user-picked folder and the
  origin-private storage from `navigator.storage.getDirectory()`
  (`stores.ts:folderStore`, `stores.ts:privateStore`).
- Makes no network requests. No file here calls `fetch`, `XMLHttpRequest`,
  `sendBeacon` or `WebSocket`.

## Verification

- Run: `pnpm test`. It includes `tsc -p .`, which covers `engine/host-browser`,
  and `pnpm exec fallow architecture --boundaries`.
