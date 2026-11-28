# Detection client

## Overview

The engine-side client for the detection worker, which runs Auto mode's
recognizers (docs/designs/auto-mode.md). The client starts a worker through
the host's function at the first run, keeps it for later runs, and ends it on
Stop and on any failure; the next run then starts a new one. The worker
belongs to the open Session: one Session is open at a time, and closing it
stops the client.

## Interface

- `client.ts`
  - `DetectionClient`:
    - `run({ packs, pages, onPage })`: loads the packs and searches the pages
      one at a time, calling `onPage` with each page's hits and the number of
      values that met an error in a check. It resolves when the run ends, with
      how it ended (`finished`, `stopped` or `failed`), a code when it failed,
      and each loaded pack's id and version.
    - `stop()`: ends the worker; a run in progress resolves as `stopped`,
      keeping the packs it loaded.
  - `detectionClient(start: () => WorkerChannel): DetectionClient`: the
    client over the workers `start` makes.
  - `notStarted`: a client that starts no worker, so every run ends as
    `failed` with `detector-not-started`. Session tests use it.

## Invariants

- A run's failure is its result, never a thrown error:
  - the worker cannot start (`start` throws, or the channel reports an error
    before the worker ever answered): `detector-not-started`;
  - the worker answers `failed`: `recognizer-failed`;
  - the worker fails after it answered, sends a message that does not parse,
    or sends one the run does not wait for: `detector-failed`.
- Each failure ends the worker, so nothing it sends later lands.
- The core sends `load`, then one `page`, and waits for its `hits` before the
  next. There is no timer: a page that never answers keeps the run going
  until `stop`.
- A reply whose `run` is not the run in progress is ignored. Events of a
  worker already ended are ignored.
- `ready` must name the packs asked for, in order. `hits` must be for the
  page asked for, and each hit must lie on that page's characters.

## Side Effects

- Starts and ends Web Workers through the host's function, and posts the
  pages' characters to them. It makes no network request.

## Verification

- Run: `pnpm test`. No browser test reaches the client until slice V1.
