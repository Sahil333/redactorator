# Detection client

## Overview

The engine-side client for the detection worker, which runs Auto mode's
recognizers (docs/designs/auto-mode.md). The worker belongs to one Session: the
client starts it at the Session's first run, keeps it for later runs, and ends
it on Stop, on a failure, and when the Session closes. Until the worker exists
(slice W1), a stand-in client takes its place.

## Interface

- `client.ts`
  - `DetectionClient`:
    - `run({ packs, pages, onPage })`: loads the packs and searches the pages
      one at a time, calling `onPage` with each page's hits and the number of
      values that met an error in a check. It resolves when the run ends, with
      how it ended (`finished`, `stopped` or `failed`), a code when it failed,
      and each loaded pack's id and version.
    - `stop()`: ends the worker; a run in progress resolves as `stopped`.
  - `notStarted`: the stand-in. Every run ends as `failed` with
    `detector-not-started`, having searched no page.

## Invariants

- A run's failure is its result, never a thrown error: a run that ends as
  `failed` carries one of `detector-not-started`, `recognizer-failed` or
  `detector-failed`.

## Side Effects

- None yet. The stand-in starts no worker and sends no message.

## Verification

- Run: `pnpm test`
