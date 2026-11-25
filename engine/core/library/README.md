# Library

## Overview

The engine's Library holds the project list, the app settings and the store
that projects live in: the browser's private storage, or a folder the user
picked.
`createLibrary` builds the `Library` facade (typed in `engine/api/facade.ts`).
Every command passes the gate first and then runs an effect. Opening a project
hands that project's lock to a Session. State changes go through the root
dispatcher as `LibraryChange`s. The slices reduce the Library's own parts. The
engine root reduces which Session is open and the problems
(`../createEngine.ts:reduce`, `../problems.ts:problems`).

## Interface

- `facade.ts`
  - `createLibrary(host: LibraryHost, first: FirstStore)`: returns
    `{ library, addCustomType }`.
    - `library.projects`: `refresh`, `create`, `open`, `rename`, `duplicate`,
      `archive` and `remove`.
    - `library.folders`: `check` (returns `usable` or `one-project`, or
      `projects-read-failed` when the read throws), `switchTo` and
      `importFrom`.
    - `library.settings.update`.
    - `addCustomType(name)`: adds a custom mark type to the settings if it is
      not there yet.
  - `FirstStore`: `{ store?, adoptFrom?, folderName? }`.
- `gate.ts`
  - `gate(view, command, projectId?)`: the `ErrorCode` that refuses a command
    now, or undefined.
  - `can(view)`: the commands Home may offer.
- `host.ts`
  - `LibraryHost`: `state`, `dispatch`, `lock`, `intake` and `session`.
  - `LibraryView`: `library`, `worker` and `session`.
- `changes.ts`: `LibraryChange`, the union of every change to the Library's
  part of the state and to which Session is open: `storeChanged`, `moveStarted`, `storeLoaded`, `storeLoadFailed`,
  `refreshStarted`, `listed`, `opened`, `closed`, `createStarted`,
  `createEnded`, `changeStarted`, `imported`, `settingsChanged` and
  `problemRaised`.
- Subdirectories:
  - [effects](./effects/README.md): the asynchronous work behind each command.
  - [slices](./slices/README.md): pure reducers for `LibraryParts`.

## Invariants

- Every Library command except `refresh` asks `gate` first and returns its
  refusal as `{ ok: false, error: { code } }` (`facade.ts:refused`).
- While the phase is `moving` or `opening`, the gate refuses every command with
  `busy-moving`. While the phase is `loading`, it refuses `create` and `import`
  (`gate.ts:gate`).
- While a Session is open, or files are being made into a project, the gate
  refuses `open`, `create` and `switchTo` (`session-open`, `busy-creating`).
  It refuses `manage` on the project this engine has open with `open-here`
  (`gate.ts:gate`).
- `can` offers `create` and `import` only while the PDF worker is `ready` and no
  project is being created. It offers nothing except `switchTo` until a list
  has landed (`gate.ts:can`).
- `rename`, `duplicate`, `archive` and `remove` run through
  `effects/manage.ts:whileLocked`, on a project that is in the current list
  (otherwise `unknown-project`) (`facade.ts:manage`).
- `folders.check` reports `one-project` when the picked folder is itself a
  project folder (`facade.ts:check`).
- `create` and `importFrom` return `no-store` when there is no store
  (`facade.ts:noStore`).

## Side Effects

- Dispatches `LibraryChange`s, with follow-up effects, through
  `LibraryHost.dispatch`.
- Through its effects, reads and writes projects and settings in a `Store`,
  holds project locks and calls intake over the PDF worker.
- `remove` deletes the project's whole folder from the store
  (`facade.ts`, `store.remove(current.folder)`).
- When `createLibrary` receives a first `store`, it dispatches `storeChanged`
  and starts `loadStore`.
- `switchTo` dispatches `storeChanged`, then starts `loadStore`. The phase is
  `moving` when `adoptFrom` is given and the current place is `browser`, and
  `opening` otherwise (`facade.ts:switchTo`).
- `create` dispatches `createStarted` before it runs `createFrom`
  (`facade.ts:create`).

## Verification

- Run: `pnpm test`
