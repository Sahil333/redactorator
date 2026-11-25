# Stored projects

## Overview

Projects as they are kept in a `Store` (`engine/storage/store.ts`). Each
project is a folder that holds its original files under their own names and its
records in a hidden `.redactorator/` folder:

- `<folder>/.redactorator/project.json`: the project record.
- `<folder>/.redactorator/text/<documentId>.json`: one file per document.
- `<folder>/.redactorator/images/<documentId>.json`: one file per document.

The app's settings live in `.redactorator/settings.json` at the store's root.
The files are encoded and decoded by [`../formats`](../formats/README.md).

## Interface

- `projects.ts`
  - Types:
    - `StoredProject`: `{ folder, project }`.
    - `NewDocument`: an inspected file with its `id`, `file`, `bytes`, `sha256`
      and `reading`.
    - `ProjectEntries`.
  - Reading projects:
    - `readProject(store, folder)`: returns a `StoredProject`, an unreadable
      entry with its `problem`, or undefined.
    - `listProjects(store)`
  - Making and saving projects:
    - `saveProject(store, stored)`
    - `createProject(store, name, added)`
    - `duplicateProject(store, stored)`
    - `writeOriginals(store, stored, added)`: returns the new
      `ProjectDocument`s.
  - Moving and importing:
    - `moveProjects(from, into, locks)`: returns the names of projects left
      behind.
    - `importProject(from, into)`: returns undefined, `"projects"`,
      `"missing"` or a `StoredFileProblem`.
  - Document records:
    - `readTexts` and `saveTexts`
    - `readImages` and `saveImages`
    - `findOriginal` and `readOriginal` (`readOriginal` throws when the
      original is missing).
  - Settings: `loadSettings(store)` (returns `defaultSettings` when the file is
    absent) and `saveSettings(store, settings)`.
  - `nameFromFile(file)`: strips a trailing `.pdf`.

## Invariants

- Folder and file names are made safe for every desktop. Characters that
  Windows or macOS refuse, and control characters, become `-`. Leading and
  trailing dots and spaces are trimmed, and names are cut to 120 characters
  (`safeName`). A name already taken gets ` (2)`, ` (3)` and so on, compared
  without regard to case (`unique`). The records folder name is always treated
  as taken.
- `writeOriginals` removes every file it started to write if any write fails,
  so the folder never holds a file that the project does not list.
- `createProject`, `duplicateProject` and imports fill a new folder, and remove
  that folder again if filling it fails (`intoNewFolder`).
- When a project is moved or imported, each copied file is read back and
  compared byte for byte, and the copy throws on a mismatch (`copyFolder`).
  `duplicateProject` copies the originals and the text and image records with
  plain writes and does not read them back.
- `duplicateProject` names the copy `<name> (copy)` and gives it a new id and
  creation time (`projects.ts:duplicateProject`).
- A copy never writes over a project that is already in the target. A copy
  whose id is already there gets a new id and a name like `Name (2)`
  (`copyProjectInto`).
- A readable project is moved only while its lock is held. If another tab holds
  the lock, the project is left behind and its name is returned. A project
  already gone from the source once the lock is taken counts as moved. The old
  copy is removed only after the new one has been copied and checked, or after
  an identical copy with the same id is found to be there already
  (`moveProject`, `alreadyThere`, `moveFolder`).
- An unreadable project folder is moved without a lock, under its folder name
  (`projects.ts:moveProjects`).
- Moving settings does nothing when the source has no settings file. Otherwise
  it writes them into a store that has none, or adds only the custom types that
  store lacks, and it never writes over that store's own settings. When either
  side's settings are `"damaged"` or `"newer"`, nothing is written. Either way
  the source's `.redactorator` folder is then removed, so settings that can't
  be read are dropped (`moveSettings`).

## Side Effects

- Reads, writes and removes files and folders in a `Store`. This includes the
  document's original bytes, its page text and its images, all in the user's
  chosen store.
- Acquires and releases project locks through `LockPort` (`moveProject`).
- Calls `crypto.randomUUID()` and `new Date()` for new project ids and creation
  times (`createProject`, `duplicateProject`). `copyProjectInto` calls only
  `crypto.randomUUID()`, and the copy keeps its `created`.

## Verification

- Run: `pnpm test`
