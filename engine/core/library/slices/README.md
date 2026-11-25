# Library slices

## Overview

Pure reducers for the Library's part of the engine state. Each slice takes its
part and a `LibraryChange` ([`../changes.ts`](../changes.ts)) and returns the
next part. `index.ts` combines the slices into `LibraryParts`, which the gate
and effects read through `LibraryView` ([`../host.ts`](../host.ts)).

## Interface

- `index.ts`
  - `LibraryParts`: `{ list, place, settings }`.
  - `firstLibrary`: the initial parts.
  - `library(parts, change): LibraryParts`: the combined reducer.
- `list.ts`
  - `ListPart`: `projects` (undefined until the first list lands) and the
    `started` counter.
  - `noList`
  - `list(part, change)`
- `place.ts`
  - `PlacePart`: the `store`, the `place` (`LibraryState["place"]`) and the
    `phase`.
  - `noPlace`
  - `place(part, change)`
- `settings.ts`
  - `SettingsPart`: `settings`, `writable` and `creating`.
  - `firstSettings` (which starts from `defaultSettings`)
  - `settings(part, change)`

## Invariants

- `library` returns the same `parts` object when no slice changed
  (`index.ts:library`).
- `started` goes up on `refreshStarted` and `storeChanged`, so that a list
  begun earlier can be recognised as out of date. `listed` and `storeLoaded`
  replace `projects`. `storeLoadFailed` clears it (`list.ts:list`).
- `storeChanged` sets the store, place and phase. `moveStarted` sets the phase
  to `moving`. `storeLoaded` and `storeLoadFailed` set it to `ready`
  (`place.ts:place`).
- Settings are not writable from `storeChanged` until that store's settings
  are read. A `storeLoaded` with readable settings replaces the settings in use
  and makes them writable. When the stored settings are `"newer"`, they stay
  not writable. Settings that are `"damaged"` leave the settings in use
  unchanged but make them writable, so a later save can write over the damaged
  file. `settingsChanged` replaces the settings in use
  (`settings.ts:settings`).
- `creating` is true between `createStarted` and `createEnded`
  (`settings.ts:settings`).

## Side Effects

- None. Every function is a pure reducer.

## Verification

- Run: `pnpm test`
