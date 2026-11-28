# engine/detect-protocol

## Overview

The message contract between the engine core and the detection worker
(`engine/detect`), which runs Auto mode's recognizers
(docs/designs/auto-mode.md, Technical Plan, section 3). It holds the five
messages and the parsers that turn an untrusted `postMessage` payload into a
typed message or `undefined`. The code is pure, with no state. It is shaped
like `engine/pdf-protocol`.

Importers: `engine/detect/handler.ts`, `engine/detect/messages.ts` and
`engine/core/detect-client/client.ts`.

## Interface

`messages.ts`:

- `RunNumber` / `isRunNumber`: numbers each run the core starts, from 1. The
  guard accepts only a positive integer.
- `DetectRequest`: `load` (`run`, `packs`, the pack ids) or `page` (`run`,
  `page`, `chars`, the page's characters).
- `DetectReply`: `ready` (`run`, `packs`, each loaded pack's `id` and
  `version`), `hits` (`run`, `page`, `hits`, `errors`) or `failed` (`run`,
  `code: "recognizer-failed"`).
- `LoadedPack { id, version }`.

`parse.ts`:

- `parseDetectRequest(data: unknown): DetectRequest | undefined`
- `parseDetectReply(data: unknown): DetectReply | undefined`

## Invariants

- **Parsers fail closed.** A payload with an unknown `type`, a `run` that is
  not a positive integer, or any field that fails its guard, parses to
  `undefined`. Lists are parsed with `parseAll`, which drops the whole message
  when one element fails.
- A `page` carries the page's characters only, no boxes: there is no rule for
  "same row" in this phase.
- A pack id must be one of `packOrder`'s. A pack's `version` must be 12
  lowercase hex digits.
- Each hit needs a page index, `start < end` as non-negative integers, a
  `text`, a non-empty `identifier`, `rule` and `recognizer`, and evidence of a
  known kind and level, whose `label` is absent or a non-negative integer.
  `errors` is a non-negative integer.
- `failed` carries only `recognizer-failed`. A worker that fails in any other
  way is seen through the channel's error event.
- **Boundary.** `.fallowrc.json` zone `detect-protocol` may import only
  `model`.

## Side Effects

- None. These are types and pure parsers.

## Verification

- Run: `pnpm test` (this includes `tsc -p engine/detect-protocol` and the
  `fallow architecture --boundaries` check).
