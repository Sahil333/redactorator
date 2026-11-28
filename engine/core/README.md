# Engine core

## Overview

The engine root. `createEngine` builds one engine over a PDF-worker channel, a
project lock and the first store. It holds all engine state in one dispatcher
and publishes it to the app as `EngineState`. The state holds a `revision`
counter and four parts: the worker's status, the problems still shown, the
Library (the project list, settings and the store), and at most one open
Session (a project held open for editing). The core never names a platform API. It asks its host for a lock and
a worker channel through `ports.ts`.

## Interface

- `createEngine.ts:createEngine(start: FirstStore & { worker: WorkerChannel; lock: LockPort }): Engine`
  returns `{ getState, subscribe, library, session }` (the `Engine` facade from
  `engine/api/facade.ts`).
- `dispatcher.ts:createDispatcher(initial, reduce): Dispatcher<S, R>` with
  `getState`, `dispatch(record, ...effects)` and `subscribe(listener)`.
- `intake.ts:intake(files, client): Promise<Intake>` returns
  `{ added: NewDocument[]; refused: Refusal[] }`.
- `ports.ts:LockPort` (`acquire(projectId)`), `LockHold` (`release()`) and
  `WorkerChannel` (`post`, `onMessage`, `onMessageError`, `onError`,
  `terminate`).
- `problems.ts:problems(current, change, revision)` and
  `approvalProblems(current, change, revision)`.
- Subdirectories:
  - [session](./session/README.md): the open Session, with its facade, gate, slices and effects.
  - [library](./library/README.md): the project list, settings and store, with its facade, gate, slices and effects.
  - [stored](./stored/README.md): projects and settings as kept in a Store.
  - [formats](./formats/README.md): versioned JSON encoders and parsers for the stored files.
  - [pdf-client](./pdf-client/README.md): the engine-side client for the PDF worker.
  - [detect-client](./detect-client/README.md): the engine-side client for Auto mode's detection worker; a stand-in until the worker exists.

## Invariants

- One dispatch pass commits a record's new state, starts its effects in order,
  then notifies listeners once. A record dispatched during a pass waits its turn,
  and a record that changes nothing notifies no one (`dispatcher.ts:createDispatcher`).
- A Session change lands only when it comes from the Session that is open now.
  Work started by a closed Session never reaches the next one
  (`createEngine.ts:reduceSession`, `open?.session !== from`).
- `revision` goes up only when the state actually changes (`createEngine.ts:reduce`).
  `getState` returns the same published object until it does
  (`createEngine.ts:createEngine`, `publishedFrom`).
- Problems (`problems.ts:problems`, `problems.ts:approvalProblems`):
  - `storeLoaded` replaces them with the load's own problems, and
    `storeLoadFailed` replaces them with one `projects-read-failed`.
  - `problemRaised` adds one.
  - `opened`, `changeStarted` and `imported` clear them.
  - `approval-failed` is added when an approval fails, and lasts until the next
    approval starts (`planning`) or its project closes (`closed`).
- Intake (`intake.ts:intake`) skips hidden files (names starting with `.`) and
  reads the rest sorted by path. A file counts as a PDF by its type
  `application/pdf` or a `.pdf` name (`intake.ts:isPdf`). A file that is not a
  PDF is refused with `not-pdf`, one that cannot be read with
  `unreadable-file`, and one the worker's preparation refuses with the
  worker's own error. Every added file gets a new `newDocumentId()`, its
  SHA-256 (`hash.ts:sha256`) and what preparation made of it; intake stores
  nothing.
- `.fallowrc.json`: the `core` zone may import only `model`, `storage`, `api`
  and `pdf-protocol`.

## Side Effects

- Starts the PDF-worker client over the host's `WorkerChannel`
  (`createEngine.ts`, `pdfClient(start.worker)`). Worker status changes are
  dispatched as `workerChanged`.
- Reads the bytes of chosen files, and hashes them with `crypto.subtle.digest`
  (`intake.ts:sha256`).
- Store I/O, project locks and worker requests happen in the subdirectories'
  effects. No file in this folder makes a network request.

## Verification

- Run: `pnpm test`
