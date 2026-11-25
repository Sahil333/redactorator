# Stored projects

## Overview

Projects as they are kept in a `Store` (`engine/storage/store.ts`). Each
project is a folder that holds its original files under their own names and its
records in a hidden `.redactorator/` folder. Each reader tag (`READER_TAG`,
such as `pdf-3`) has a folder of its own there, and files are only ever added:
an older build still finds the project as it last saw it
(docs/designs/pdf-leak-suite.md, part 3).

- `<folder>/.redactorator/project.json`, `text/<id>.json` and
  `images/<id>.json`: as the last build before reader tags wrote them; never
  written again.
- `<folder>/.redactorator/<tag>/project.json`: this build's project record,
  whose text pieces carry their letters.
- `<folder>/.redactorator/<tag>/text/<documentId>.json`: the document's page
  text as this build reads it, with the tag and the removed kinds.
- `<folder>/.redactorator/<tag>/images/<documentId>.json`: its placed images.
- `<folder>/.redactorator/<tag>/working/<documentId>.not-redacted.pdf`: its
  working copy, which holds every marked value until export, so its name says
  so.

Everything in a tag folder but `project.json` is derived from the original, so
any of it that is missing or damaged is made again by preparing that document.

The app's settings live in `.redactorator/settings.json` at the store's root.
The files are encoded and decoded by [`../formats`](../formats/README.md).

## Interface

- `projects.ts`
  - Types:
    - `StoredProject`: `{ folder, project }`; `ReadProject` adds `source`, the
      tag folder, or `"root"`, it was read from (`ProjectSource`).
    - `PreparedFiles`: a working copy's bytes, its reading and its removed
      kinds. `NewDocument` adds a prepared file's `id`, `file`, `bytes` (as
      the user picked it) and `sha256`.
    - `ProjectEntries`.
  - Reading projects (each takes this build's `tag`):
    - `readProject(store, folder, tag)`: returns a `ReadProject`, an
      unreadable entry with its `problem`, or undefined. It reads the tag
      folder's project file; else the newest older tag folder's, the highest
      number below this build's; else the root one.
    - `listProjects(store, tag)`
  - Migrating: `migrateToTag(store, read, tag)` copies a project read from an
    older folder into the tag folder, with each text piece's letters filled
    by `migratePieces` from the older stored text; `inTag(store, read, tag)`
    is the project as kept in the tag folder, migrated first when need be.
  - Making and saving projects (all into the tag folder only):
    - `saveProject(store, stored, tag)`
    - `createProject(store, name, added, tag)`
    - `duplicateProject(store, read, tag)`
    - `writeOriginals(store, stored, added, tag)`: returns the new
      `ProjectDocument`s.
    - `savePrepared(store, folder, tag, id, prepared)`: a document's working
      copy, text and images.
  - Moving and importing:
    - `moveProjects(from, into, locks, tag)`: returns the names of projects
      left behind.
    - `importProject(from, into, tag)`: returns undefined, `"projects"`,
      `"missing"` or a `StoredFileProblem`.
  - Document records: `readTexts`, `readImages` and `readWorking` (from the tag
    folder), and `findOriginal`.
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
- No code writes the root files, or another tag's folder.
- `writeOriginals` removes every file it started to write if any write fails,
  the original, working copy, text and images, so the folder never holds a
  file that the project does not list.
- `createProject`, `duplicateProject` and imports fill a new folder, and remove
  that folder again if filling it fails (`intoNewFolder`).
- When a project is moved, imported or duplicated, its whole `.redactorator/`
  folder is copied, older tag folders included, and each copied file is read
  back and compared byte for byte; the copy throws on a mismatch
  (`copyFolder`). `duplicateProject` copies the originals with plain writes.
- `duplicateProject` names the copy `<name> (copy)` and gives it a new id and
  creation time, in the tag folder only (`projects.ts:duplicateProject`).
- A copy never writes over a project that is already in the target. A copy
  whose id is already there gets a new id and a name like `Name (2)`, in the
  tag folder only (`copyProjectInto`). Re-identifying a copy read from an older
  folder migrates it first, so its marks keep their letters.
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
