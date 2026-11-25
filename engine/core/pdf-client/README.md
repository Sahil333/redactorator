# PDF client

## Overview

The engine-side client for the PDF worker. It sends `PdfRequest`s over a
`WorkerChannel` (`engine/core/ports.ts`), and checks each reply with
`parsePdfReply` (`engine/pdf-protocol/parse.ts`) before using it. It matches
each reply to the request that is waiting for it, and reports the worker's
status (`starting`, `ready`, `applying` or `stopped`).

## Interface

- `client.ts`
  - `pdfClient(channel: WorkerChannel): PdfClient`
  - `PdfClient`:
    - `onStatus(listener)`: calls the listener now and on each change. It
      returns an unsubscribe function.
    - `prepare(bytes)`: the file's working copy, reading and removed kinds
      (`PreparedFiles`), or the worker's refusal.
    - `match(keys, documents)`
    - `open(bytes)`
    - `render(source, page, scale)`, `text(page)` and `apply(edits,
      appearance)`: these act on the document opened last.
  - `WorkerStatus`: `{ state, error? }`.
- `waiting.ts`
  - `Waiting<N, T>`: numbered requests that each wait for an answer, with
    `ask`, `answer` and `stop`.
  - `notRunning`: the `worker-not-running` error.
- `errors.ts`
  - `ClientError`: `{ code, message?, data? }`, where `message` is a sentence
    that the worker composed, and `data` a page and boxes a refusal applies to.
  - `ClientErrorCode`

## Invariants

- Requests made before the worker says `ready` are held, and sent in order once
  it does (`client.ts:post`, `client.ts:ready`). A `ready` whose reader tag is
  not `READER_TAG` stops the client with `unexpected-reply`: a worker of
  another build would read and prepare documents otherwise than the project
  stores them.
- Fail closed. A reply that does not parse, a message error or a worker error
  stops the client with `unexpected-reply`, `unreadable-reply` or
  `worker-stopped`: it terminates the channel, sets the status to `stopped`
  with that code, and settles every pending request with the error. After
  that, every request
  resolves to `worker-not-running` (`client.ts:stop`, `Waiting.stop`,
  `Waiting.ask`, `client.ts:aboutOpenFile`).
- An answer about a document other than the one opened last settles its request
  with `stale-handle` (`client.ts:isStale`, `answerAboutFile`,
  `failAboutFile`).
- `render`, `text` and `apply` resolve at once to `stale-handle` when no
  document has been opened (`client.ts:aboutOpenFile`).
- `apply` sets the status to `applying` as it posts (`client.ts:apply`).
- An error about a file settles the oldest request that is waiting on that
  file. Among replies, only an `apply` request's own answer or error ends the
  `applying` state; another request's error does not. This guards against two
  applies running at once (issue #23) (`client.ts:failAboutFile`). `open` also
  ends `applying`, since an apply still under way was for the document being
  left (`client.ts:open`, `client.ts:doneApplying`). `stop` sets the status to
  `stopped`.
- An error about the open file that matches no waiting request is still shown
  in the status (`client.ts:failAboutFile`).
- An error the worker cannot tie to a request (`unknown-request`) is shown in
  the status. It returns `applying` to `ready` (`client.ts:unknownRequest`).
- `prepare` and `open` transfer a copy of the caller's bytes, so the caller's
  array is never detached (`client.ts:prepare`, `client.ts:open`).

## Side Effects

- Posts messages to the in-browser PDF worker through `WorkerChannel.post`.
  These messages carry document bytes (transferred copies), page text, match
  keys and edits.
- Calls `WorkerChannel.terminate()` when the client stops.
- Calls status listeners synchronously on every status change.

## Verification

- Run: `pnpm test`
