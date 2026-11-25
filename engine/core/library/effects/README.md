# Library effects

## Overview

The asynchronous work behind the Library's commands: listing projects, opening,
creating, changing, importing and moving them, and saving settings. Each effect
takes a `LibraryHost` (see [`../host.ts`](../host.ts)), reads and writes the
store through [`engine/core/stored/projects.ts`](../../stored/README.md), and
reports what happened by dispatching `LibraryChange`s
([`../changes.ts`](../changes.ts)). The facade in [`../facade.ts`](../facade.ts)
calls these effects after its gate allows a command.

## Interface

- `refresh.ts`
  - `refresh(host): Promise<Result<void>>`: dispatches `refreshStarted`, then
    lists the projects in the current store and dispatches `listed`. With no
    store it lists nothing and resolves ok. A failed list dispatches
    `problemRaised` with `projects-read-failed` and resolves to that error
    (`refresh.ts:listAgain`).
  - `summaries(entries): ProjectSummary[]`: turns stored entries into list
    rows (mark, approved and document counts; `unreadable` for problem entries).
  - `readFailed`: the `projects-read-failed` error.
- `open.ts`
  - `openProject(host, listed, store): Promise<Result<Session>>`: locks a
    listed project, reads it again, opens a Session that holds the lock and
    dispatches `opened`. The close callback it gives the Session dispatches
    `closed` and refreshes the list.
  - `raised(host, error)`: dispatches `problemRaised` and returns the error as
    a failed `Result`.
- `create.ts`: `createFrom(host, files, store)`: runs intake on the chosen
  files, creates a project named after the first file that was added, refreshes
  the list, and opens it. It returns the optional `session` and the `refused`
  files.
- `manage.ts`: `whileLocked(host, listed, store, change)`: runs `change` on
  the project as it is stored now, only while this tab holds its lock. After
  the re-read it dispatches `changeStarted`. Once `change` ends, it refreshes
  the list.
- `import.ts`: `importInto(host, from, into)`: copies a picked project folder
  into the store and maps the reasons it was not imported to `import-projects`,
  `import-missing`, `import-damaged`, `import-newer` or `import-failed`. It
  dispatches `imported` on success and refreshes the list either way.
- `move.ts`: `loadStore(host, store, adoptFrom, name)`: optionally moves
  projects in from `adoptFrom`, then reads the store's projects and settings
  and dispatches `storeLoaded` (or `storeLoadFailed`). `storeLoaded` carries a
  `settings-damaged` or `settings-newer` problem when the settings can't be
  read (`move.ts:settingsProblems`). It returns the names of projects that
  were left behind. Moving in dispatches `moveStarted` when the source holds
  any project (`move.ts:moveIn`).
- `settings.ts`: `settingsWriter(host)`: returns an effect factory that saves
  settings one write after another.

## Invariants

- A project is opened or changed only while this tab holds its lock. When the
  lock is not free, `open-elsewhere` is raised, with `doing` set to `"open it"`
  or `"change it"` (`open.ts:openProject`, `manage.ts:whileLocked`).
- The project is read again under the lock. If the read throws, the lock is
  released and `projects-read-failed` is raised. If it finds no project, an
  unreadable one or a different project id, the lock is released,
  `project-gone` is raised and the list is refreshed (`open.ts:openProject`,
  `manage.ts:whileLocked`).
- `whileLocked` releases the lock in a `finally`, even when `change` throws. A
  thrown error becomes a `change-failed` problem (`manage.ts:whileLocked`).
- `openProject` releases the lock and refuses with `busy-moving` or
  `session-open` if, while the project was read, the store changed or another
  Session opened. Otherwise the opened Session keeps the lock until it closes
  (`open.ts:openProject`).
- Only the newest list lands. A list result is dispatched only when
  `library.list.started` is unchanged since that list began
  (`refresh.ts:listAgain`).
- Settings writes are chained one after another so that the latest change lands
  last. They are skipped when there is no store or when the settings part is not
  `writable`, as with settings from a newer version. A failed write dispatches
  `problemRaised` with `settings-save-failed` (`settings.ts:settingsWriter`).
- `createEnded` is always dispatched, in a `finally`. A thrown error becomes a
  `change-failed` problem, and the refused files are still returned
  (`create.ts:createFrom`).
- A failure while moving projects in is reported as `not-moved`, and each
  project left behind is reported as `left-behind` (`move.ts:moveIn`).

## Side Effects

- Reads, writes and removes files in a `Store` through `stored/projects`
  (`createProject`, `readProject`, `listProjects`, `importProject`,
  `moveProjects`, `loadSettings`, `saveSettings`).
- Acquires and releases project locks through `host.lock` (`LockPort`).
- Sends chosen files to intake over the PDF worker through `host.intake`
  (`create.ts:createFrom`).
- Opens a Session through `openSession` from `engine/core/session/facade.ts`
  (`open.ts:openProject`).
- Dispatches `LibraryChange`s to the engine root through `host.dispatch`.

## Verification

- Run: `pnpm test`
