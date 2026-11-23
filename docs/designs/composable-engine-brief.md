# Composable engine refactor

* **Author:** Sahil Chaddha
* **Date:** 2026-11-23 (after the third review round)

## Overview

Redactorator's engine today is one Web Worker (`engine/worker.ts`, about 760
lines) that reads PDFs, renders pages, extracts text, fingerprints images,
runs the project matcher, redacts and checks the output. The project's state
and rules (marks, undo and redo, saving, approval and spreading, adding
documents, the one-writer lock, the project list, settings) live in React
hooks under `app/`. Nothing runs without the UI, and detection (phase 4) would
land in the same worker and the same hooks.

This refactor splits what is already built into components that each own one
responsibility, under a headless engine. The engine is a facade object. The
code that uses it, the React app in a browser or a script in Node or Bun,
calls its commands and reads its state in the same thread. Behind the facade
the engine owns the project's state, its rules and each document's undo and
redo history. Heavy work (MuPDF today; models and OCR later) runs in workers
the host starts for the engine. The host also passes in the store the
projects live in, and the lock mechanism.

The refactor changes no behaviour, except the few deliberate changes listed
under Non-Goals. Tests may be rewritten for the new design, but each keeps
what it proves, and the outside oracle judges the outputs as before.

The code has three lifetimes, and the design gives each an owner:

| Lifetime | What lives that long today | Owner in the design |
| --- | --- | --- |
| The app (a process, for a CLI) | The PDF worker and its status; intake; settings; the project list | The engine root and its Library |
| The store, which changes only when the user picks a folder | Projects in Chrome's private storage or in a picked folder | The Library |
| One open project | Marks, history, saving, approval, the open document and its output | A Session |

The users are the owner and future maintainers now, and later a CLI or other
headless host that runs projects without the UI.

## Terms

The terms table now lives in the design document
([composable-engine.md, Terms](./composable-engine.md#terms)), which is the
source of truth for names (decision 47). The brief keeps its older names,
such as "view lease" for the open-document handle.

## Analysis

Three rounds of seven independent reviewers read the concept, the owner's
decisions and the code. Every round agrees the direction holds. Each section
below names the decisions that rule it and what it leaves to `/egm-draft`.

### 1. The engine root, the Library and the Session

*Ruled by decisions 1, 2, 11, 37. Left to the draft: the facade's full method
list with types.*

- **The root.** The host creates it once, passing a PDF-worker channel, the
  lock adapter and the first store. It owns the PDF-worker client, the
  worker's status and busy state, request numbering, intake, a list of coded
  problems, the Library, and at most one Session. File numbering lives at the
  root, so a reply meant for a closed Session can never reach a new one
  (`useEngine.ts:197, 256-258`).
- **Opening hands the lock from the Library to the Session.** Today `take`
  locks, reads the project again and checks its id
  (`useProjectStore.ts:182-206`), and `App` holds the release function
  (`App.tsx:72, 89`). `library.open(id)` takes the lock, reads the project
  again, and returns a Session holding the lock. Only `session.close()`
  releases it, and it resolves after the Library has refreshed its list (today
  `App.tsx:92`). After `close()`, the Session handle refuses every command, and
  any of its work still in flight does not change engine state.
- **Web Locks are not re-entrant.** With `ifAvailable` (`projects.ts:326-336`),
  this engine asking again for a lock its own Session holds gets nothing, and
  the user would see "open in another tab". So a Library command on the
  project this engine's own Session holds is refused with its own code. The UI
  never triggers it (Home is not shown while a project is open); it exists for
  headless callers.
- **Problems keep today's rules.** One problem slot is shown on Home and in
  the project (`App.tsx:138`, `ProjectView.tsx:306`); the worker's error takes
  precedence (`App.tsx:149`); a successful open clears the slot, which also
  clears the "settings from a newer version" notice
  (`useProjectStore.ts:199`); refusals from creating a project carry into the
  new Session (`App.tsx:48-49, 72, 118, 133`). Each problem carries its code
  and the engine-state revision it was raised at.
- **The worker serves both scopes.** Home inspects files before any project
  is open (`App.tsx:111`), and its add controls wait for the worker to be
  ready and not applying (`App.tsx:147-148`). So worker status and busy state
  are root state, and the Session gets a scoped PDF capability.
- **Intake is a root service**, used by create on Home and by add in a
  Session (`App.tsx:111`, `useAddDocuments.ts:26`).

### 2. The Library and its store

*Ruled by decisions 26, 31, 36, 37. Left to the draft: the Library state
diagram.*

The Library is a lift of `projects.ts` and the non-React half of
`useProjectStore.ts`. The store changes only when the user picks a folder:
the first move from Chrome's storage into a folder, or picking the folder
again after it went missing (decision 26). Importing reads another folder only
to copy one project in.

- **Sometimes there is no store.** While a remembered folder waits for
  permission or is missing (`useProjectStore.ts:88-89, 124-125`), Home still
  renders and shows the worker's status.
- **The host passes live `Store` objects** (decision 36) as arguments of
  Library commands: `switchStore(store, { adoptFrom })` for the first move,
  `checkFolder(store)` before it, and `importFrom(store)`. The app builds them
  from the folder it picked; the core never names a folder handle.
- **The order crosses the app and the engine.** The app remembers the folder
  before the Library moves projects into it, so a failed move resumes on the
  next visit (`useProjectStore.ts:253-254`).
- **`Whereabouts` splits** (`useProjectStore.ts:41-48`). Waiting for
  permission, reopening, missing, remembering and `persist()` stay in the app;
  Chrome storage, moving and folder belong to the Library.
- **Gates, all kept from today plus decisions 31 and 37:**
  - creating a project is refused while projects move, a folder opens, or
    another create runs (`App.tsx:58-61, 108`);
  - **new (decision 31):** opening a project is refused while projects move or
    a folder opens;
  - adding PDFs on Home waits for the worker (`Home.tsx:155, 162, 385`);
  - rename, duplicate, archive and delete are not gated; each takes the lock
    and reads again (`useProjectStore.ts:209-221`), which
    `projects.spec.ts:399-420` relies on. The list is only a hint;
  - **new (decision 37):** no store change while a project is open; each list
    refresh carries a sequence number so only the newest lands (today a
    refresh can land out of order, `useProjectStore.ts:168-176`).

**The race decision 31 fixes.** Today, while the first move runs, Home shows
"Moving your projects into …" (`Home.tsx:91-94`) but the rows stay clickable
(`Home.tsx:256`), and `openProject` (`App.tsx:65-74`) has no check. Opening
one then locks it in the old store, the move skips it with a wrong "open in
another tab" message (`projects.ts:247-248`), the store is swapped under the
open project (`useProjectStore.ts:127-128`), and later saves write a lone
`project.json` into the picked folder after `moveSettings` removed the old
settings (`projects.ts:272`). It can also happen at page load, when a
remembered folder still has projects waiting and the address names a project
(`App.tsx:54, 77-83`). This was read from the code, not reproduced.

### 3. The Session

*Ruled by decisions 3, 4, 13, 19, 33, 34. Left to the draft: the concurrency
table in full, the approval and close state diagrams.*

- **Commands are data, not closures.** `useProject.edit(id, change, kind)`
  takes a function today (`useProject.ts:104`). The Session's commands:
  `addMark`, `retypeItem`, `removeItem`, `linkItem`, `keepHere`, `undo(doc)`,
  `redo(doc)`, `planApproval`, `confirmApproval`, `cancelApproval`,
  `addDocuments`, `markDownloaded`, `view`, `apply`, `takeOutput`,
  `leaveOutput`, `exportGroundTruth`, `flush`, `close`. (Revised in drafting,
  2026-11-24: appearance changes go through the Library's `settings.update`;
  refusals come back in command results and the "files not added" notice is
  app state, so there is no `dismissRefused`; `keepHere` works out the
  value's key itself. The final names are in the design document.) Queries on the view lease: `render`, `pageText`, and the
  images of a document (`useImages.ts:16`). The rules inside today's closures
  move with them: one value has one type, removing drops every place of an
  item, mark ids (`nextId`), marking a value again drops it from the
  kept-visible list, undo keeps each mark's latest link id.
- **`addMark` (decision 33).** Its argument is
  `{documentId, lease, type, target}`, where `target` is
  `{kind: "text", pieces: [{page, start, end}, ...]}` or
  `{kind: "box", page, box}`. The pieces are the per-page ranges the UI
  already trimmed. The engine works out each piece's boxes and the joined
  text synchronously, from the live page text the PDF-worker client holds for
  the lease, with today's functions (`rangeText`, `rangeBoxes`, joined by a
  space; `selection.ts:152-161`). It never uses stored readings, whose boxes
  are rounded (`project.ts:221, 229`), so stored bytes stay the same. One
  function in `engine/model` builds valid targets (trimming, dropping empty
  pieces, today's running-header cut using only neighbour pages already
  loaded, `selection.ts:73-108`); the app's pending preview and the engine both
  call it. It refuses, with typed codes, a stale lease, page text not held, a
  target with nothing left after trimming, and a box with no area. The stored
  `text` and `pieces` keep exactly today's format; the text is never
  recomputed on load.
- **How commands answer.** Each command resolves to `{ok: true, value}` or
  `{ok: false, error: {code, data}}`. Only failures that must outlive the call
  (a failed save, a worker that stopped) also go into the state's problems.
- **Every Session command changes state synchronously before its first
  `await`.** Adding a mark, removing, retyping, undo and redo are synchronous
  today (`useMarks.ts:41-49`, `useProject.ts:76-82`) and stay so.
- **A concurrency table.** Today removing a mark during an apply drops the
  output (`redact.spec.ts:267-286`), adding documents is allowed during an
  apply (`ProjectView.tsx:281, 295`), undo is disabled while busy
  (`ProjectView.tsx:161`), adds and approvals exclude each other
  (`ProjectView.tsx:95, 252-253`), switching documents is blocked while
  applying (`ProjectView.tsx:283`), and leaving does not wait for an apply
  (`ProjectView.tsx:276`). Edits are allowed or refused, never queued.
  `flush()` is allowed during every operation and never queued. Undo while
  the app has a pending (not yet typed) mark stays an app rule.
- **Approval is two steps.** `planApproval(doc)` returns a plan id, a summary
  and whether a heads-up is needed; `confirmApproval(planId)` re-plans when the
  project changed in between, by comparing the project record the plan was
  made from, by identity, as `useApproval.ts:44, 68` does today (decision 45).
- **An output is tagged per document.** Marking a document downloaded keeps
  its output (`Workspace.tsx:126`), labelling changes keep it
  (`ProjectView.tsx:154`), and changes to other documents never touch it. So
  each output is tagged with its document, that document's edit counter, and
  the appearance it was written with (revised in drafting, 2026-11-24, so a
  setting unrelated to output never drops it). `apply` reads marks from engine state, never from the
  caller (today `ProjectView.tsx:186`).
- **The view lease.** The PDF worker holds one open document and its output
  (`worker.ts:35, 240, 251-258, 703-718`). `session.view(documentId)` reads the
  original, opens it, and returns a lease. `render` and `pageText` carry the
  lease and are refused when it is stale, as `isAboutOlderFile` does today
  (`contract.ts:380-381`). When an output goes stale, the client stops serving
  its renders (today `useEngine.ts:311-317`).
- **Undo history** keeps today's form: per document, up to 100 snapshots of
  its marks and kept-visible list, moved into the Session
  (`useProject.ts:22-27, 104-128`).
- **Closing.** `close()` refuses new commands, flushes the save, then releases
  the lock hold, and stays open if the save failed (today
  `ProjectView.tsx:276`, `App.tsx:86-94`). A failed save is retried by the next
  change or by `flush`, as today (`ProjectView.tsx:97`).
- **`pagehide`.** The app calls `flush()` from its `pagehide` handler. Because
  the engine runs in the caller's thread and `flush()` has no `await` before
  `store.write`, the write starts in the same task when no write is in flight,
  as today (`useProject.ts:56-62, 84-90`).
- **Intake.** The app wraps each file as `{name, path, type, read()}`; the
  engine calls `read()` only for PDFs, one at a time, so today's refusal order
  holds (revised in drafting, 2026-11-24); the root's intake sorts,
  inspects and merges refusals in today's order (`importFiles.ts:11-48`,
  tested at `projects.spec.ts:546-549`).

### 4. Settings

*Ruled by decision 13.*

Settings belong to the store, not a project: `.redactorator/settings.json`
(`projects.ts:26, 315-320`), merged on the first move, read-only when a newer
version wrote them (`useProjectStore.ts:118-119, 226`), written one after
another (`useProjectStore.ts:121, 223-230`). The Library owns them and their
write queue. A Session holds a narrow capability: read the appearance, add a
custom type. A mark with a new custom type changes the project at once and
then writes settings, which never gates the project change; this keeps today's
order (`useMarks.ts:36-45`). Settings have no lock and the last writer wins,
and `pagehide` does not drain the settings queue, as today.

### 5. The engine's state, and how the app reads it

*Ruled by decisions 19, 34.*

The app reads the latest state through the facade: `engine.getState()`
returns it, and `engine.subscribe(listener)` says when it changed. There are
no other events: a listener only learns that the state changed and reads it.
The state is an immutable value; each change produces a new one with a higher
revision, and an unchanged state is the same object. React needs exactly that
to redraw correctly (`useSyncExternalStore`). A script reads `getState()`
after each command.

There is one state for the whole engine: Library (project summaries with id,
folder, name, archived, unreadable status and counts; settings; worker status;
problems) and Session (project record, operation state, save state, the open
document, output details, derived views).

**Derived views** are worked out from the project rather than stored: `reach`
(for each hidden value, how many places and documents it is marked in),
`newFrom` for the open document (which files' approval brought its new marks),
(`ProjectView.tsx:15, 115`). The keep-here key is worked out inside the
`keepHere` command instead (revised in drafting, 2026-11-24). They rest on the
rule of what counts as the same value, so the engine computes them, once per
change of the project.

What never goes in the state: output bytes (`takeOutput`), page text and
pixels (`render`, `pageText`).

**The counters**, none of them stored:

| Counter | Rises when | Read by |
| --- | --- | --- |
| State revision | Anything in the state changes | Subscribers only |
| Document edit counter | An edit (not a label change) to that document | Output validity |
| List sequence | Each list refresh starts | The Library, to keep the newest |

### 6. The facade, ports and workers

*Ruled by decisions 2, 24, 25, 38.*

- **Facade.** One object; the app sees nothing else of the engine.
- **Ports and adapters.** The core declares the PDF port and the lock port;
  the store is passed in. Each host supplies adapters.
- **Composition root.** The host builds the engine once. Browser: a channel to
  a Web Worker it started, Web Locks, a Chrome-storage or folder `Store`. Node
  later: a channel to a `worker_threads` worker, a lockfile, a file-system
  `Store`.
- **The PDF seam.** The core owns the PDF-worker client and speaks the
  document-worker protocol over a channel the host supplies:
  `post(message, transfer)`, `onMessage`, `onMessageError`, `onError`,
  `terminate`. The core never names a platform's worker API.
- **Command pattern** inside the Session, as section 3.
- **Observer:** `getState()` and `subscribe()`.

The client is in-process only (decision 38). Message passing exists only
between the engine and its own worker.

- **The document-worker protocol** is today's messages, in a `pdf-protocol`
  layer that does not import `mupdf`, with their parsers and request
  bookkeeping (`Waiting`, `useEngine.ts:105-133`). Wire changes, all of them:
  `rendered` carries `{width, height, rgba}` instead of `ImageData`
  (`worker.ts:286-287`). `bad-message` stays on the wire; the facade splits it
  into five codes (worker stopped, not running, unexpected reply, unreadable
  reply, and the worker's own "unknown message", `worker.ts:734-739`), each
  keeping today's sentence. No message is added.
- **Who keeps which render bookkeeping.** The PDF-worker client keeps page
  text per lease (`addMark` needs it), fetches each page's text once, and
  fetches the next page's text early (`useEngine.ts:272-276, 296-299`). The
  app keeps its image cache: at most six finely drawn pages, a finer render
  kept over a coarser one that lands later, a page forgotten while its render
  was on the way staying forgotten (`useEngine.ts:43-54, 137-142, 217-218,
  278-286`).
- **No network transport.** The state and commands carry document text. The
  browser bundle ships no network transport; `tests/e2e/network.spec.ts` gains
  a check that no WebSocket or EventSource opens.
- **Worker naming.** Only the `worker-` prefix of the built file must stay
  (`tests/e2e/app.ts:28, 35`); the content hash stays, so an old tab never
  loads a changed worker during a deploy. The worker stays one bundled entry
  with no engine code in split chunks, because the test fakes put their code
  in front of it (`tests/e2e/app.ts:34-38`).

### 7. The PDF worker and the write path

*Ruled by decisions 10, 30, 35, 40.*

- **The verbatim set:** `redactionsByPage`, `drawBoxes`, `redact`, `check`,
  `textUnderBoxes`, `imagesUnderBoxes`, `blankUnder` and their helpers move to
  new files with their bodies unchanged. No new leak fixture; the
  oracle-judged tests are the proof, and the owner accepts the small
  remaining risk.
- **Frozen:** their code; their sentences, passed through as
  `{code, message}`; the `apply`, `applied` and `error` message shapes; and
  `apply`'s own sentences and its choice between `check-failed` and
  `apply-failed` (`worker.ts:705, 717, 723-727`; "Nothing was exported." is
  asserted at `redact.spec.ts:263`).
- **`apply` is plumbing.** It posts its own messages and reads the module's
  open document (`worker.ts:35, 702-730`), so it is edited in its own step.
  That edit changes no behaviour; the redaction and spreading tests prove it,
  and that step's PR is the plan-before-code plan AGENTS.md asks for.
- **A move table** in the draft lists each function's new module. Module state
  (`let opened`, reassigned at `worker.ts:77, 247`) and its accessors stay in
  one module; `post` and `fail` go to a shared module.
- **Writing and checking stay one exported entry.** Write internals sit in a
  sub-folder only the apply module may import, if the fallow spike shows a
  zone can say so.
- **A known misreport, kept:** [issue #14](https://github.com/Sahil333/redactorator/issues/14).

### 8. Tests

*Ruled by decisions 9, 20, 29, 40.*

- **Fakes stay at the worker wire**, for failure and timing cases only
  (`tests/e2e/app.ts:27-39`).
- **Rewrite before refactor.** A rewritten test lands in an earlier slice than
  the code it covers and passes on today's code. A test edit that only changes
  imports is not a rewrite.
- **Negative controls.** Each timing or ordering test is shown red once, with
  the behaviour it guards removed; the PR records the red run.
- **Self-checking fakes.** A route that matched nothing, or a hold that held
  nothing, fails the test. Helpers are named by behaviour
  (`holdApprovalSearch`, `delayPageText`) and typed from `pdf-protocol`.
- **A ledger**, kept in the PR, one row per rewritten test: old and new name,
  what it proves, the fault injected and the assertion before and after,
  evidence it can fail.
- **New tests for behaviours nothing watches** (decision 20): a new change
  clearing redo; undo putting a document in review and marking its download
  changed; approval clearing history only where it changed things; save
  coalescing and ordering (with its own write counter; `writeAttempts` exists
  only inside `failWrites`, `projects.spec.ts:369-383`); retry after a failed
  save; the `pagehide` flush, including during an apply and an approval
  search; undo disabled while busy; rename refused while another tab has the
  project; the settings write order; saving after the worker dies.
- **The golden stored-bytes test.** A scripted session (add text, add box, a
  cross-page mark with a running header, retype, link, undo, redo, approval
  with spreading onto an image, a new custom type, an appearance change, mark
  downloaded, then reload and save again) must write the same bytes to all
  four stored files: `project.json`, `settings.json`, `text/<id>.json` and
  `images/<id>.json`. Ids and dates are replaced by placeholders before
  comparing. A project written by current `main` opens and saves back
  byte-identical. Key order differs by code path today (`useMarks.ts:45`,
  `spread.ts:111, 123`, `project.ts:158`), so each path keeps its own builder
  with today's key order. No slice bumps a stored format version
  (`project.ts:102-105`), so redeploying the previous build is the rollback.
  Decision 40 is about PDF output only; this test is about stored files.

### 9. A core with no browser types

*Ruled by decisions 16, 32.*

- **`Store`:** `read(path): Promise<Uint8Array | undefined>` returns a fresh
  array the caller owns; `write(path, data: Uint8Array | string)`. The PDF port
  copies bytes before transferring them to the worker, since a transfer
  detaches the buffer (`useEngine.ts:247, 269`). Duplicating a project then
  reads each file whole instead of streaming it (`projects.ts:166-169`); moving
  projects already reads whole files (`projects.ts:185-198`).
- **A declaration file** types only the web globals the core uses, which Node,
  Bun and browsers share: `crypto.randomUUID` (`project.ts:33`,
  `projects.ts:154, 172, 215`), `crypto.subtle.digest` (`importFiles.ts:19`),
  `TextDecoder` (needed once `File.text()` goes, `projects.ts:76, 126, 135,
  317`). It covers `engine/model` too (`newDocumentId`, `project.ts:32-36`).
- **Elsewhere:** pixels are `{width, height, rgba}`; the app turns browser
  `File`s into plain values before intake; `new Worker(new URL(...,
  import.meta.url))` is host code; the dataset schema JSON may be imported by
  `engine/model`.

### 10. Errors

*Ruled by decision 28.*

The draft holds an error table: code, data, today's sentence, source line, for
every sentence site in `useProjectStore.ts`, `ProjectView.tsx`,
`useApproval.ts`, `useAddDocuments.ts`, `useDocumentInEngine.ts`,
`importFiles.ts`, `Home.tsx` and the worker. The app maps codes to today's
exact sentences.

### 11. Stale docs to propose to the owner

HLD.md:258 (engine runs in workers), Implementation-Plan.md:183 (spreading
runs in the worker; HLD.md:219's "the search runs in the worker" stays true),
HLD.md:378-399 (storage layout), HLD.md:57 (no shared state), HLD.md:38 and 247
(the verifier).

## Proposed components

Everything stays under `engine/` and `app/`, so the typecheck, unit test and
coverage patterns (`tsconfig.json:20`, `vitest.config.ts:6`,
`vite.config.ts:38`) keep covering every file.

| Layer | What goes in it, from today's code | May import |
| --- | --- | --- |
| `engine/model` | Units, geometry, document and text types, `Edit`, `Source`; the stored-format parse kit (with `isFingerprint`, `parsePlacedImage`); `pageText.ts`, `match.ts`; `spread.ts`, `images.ts`; the domain half of `marks.ts`; the target builder from `selection.ts`; `markTypes.ts`; `groundTruth.ts`; project and settings types | `dataset/*.json` |
| `engine/storage` | The `Store` interface | nothing |
| `engine/api` | Types only: the facade interface, the state type, command arguments and results, error codes, the lease and pixel types | model |
| `engine/pdf-protocol` | Document-worker messages, their parsers, `FileNumber`, `InspectionNumber`, `MatchNumber`, `Waiting` | model |
| `engine/core` | The root, Library, Session, intake, stored formats (`project.ts:95-279`), document readings, the PDF-worker client, the lock port | model, storage, api, pdf-protocol |
| `engine/pdf` | `worker.ts` split by the move table into read, images, inspect, text, render, apply, and a `write` folder holding the verbatim set; `glyphs.ts`; the only importer of `mupdf` | model, pdf-protocol, mupdf |
| `engine/host-browser` | Chrome-storage and folder `Store` backends, `writeWhole`; the Web Locks adapter (same lock name); starting the worker and its channel; the function that builds the engine | everything in `engine/` except `pdf` |
| `app` (React only) | Folder picking, permissions, remembering handles (`projectsFolder.ts`), `persist()`, the image cache and pixel ratio, tabs (`useTabs.ts`), the DOM half of `selection.ts`, pending marks, highlight, zoom, dialogs, shortcuts, error codes to sentences, downloads (`download.ts`), labelling UI. `useImages.ts`, `useAddDocuments.ts` and `useDocumentInEngine.ts` become thin hooks over the facade or go | model, api, `host-browser`'s build function |

Import rules: `app` may not import `engine/core`, `engine/pdf` or
`engine/pdf-protocol`. `engine/core` may not import `engine/pdf`; it reaches
the worker through the PDF port. Only `engine/pdf` may import `mupdf`. The
`declare global` blocks in `projectsFolder.ts` and `download.ts` stay out of
the engine's typecheck configs. Each module's colocated unit test moves with
it.

## Goals vs. Non-Goals

* **In-Scope Goals:**
  - Split the PDF worker, the engine client and the project hooks into the
    components above, each owning one responsibility.
  - An engine root with a Library and a Session, owning project state, rules,
    undo and redo, saving, settings, approval and intake.
  - A facade the app and scripts call in their own thread: commands with
    results, queries, `getState()` and `subscribe()`.
  - A PDF port over a host-supplied channel, a lock port, and live `Store`
    objects passed in by the host.
  - Boundaries enforced by per-folder typecheck configs and fallow zones.
  - New tests for behaviours nothing watches; the golden stored-bytes test.
  - Rewritten tests that keep what they prove, recorded in a ledger.
* **Out-of-Scope Non-Goals:**
  - Any change in behaviour, stored bytes or UI text, except these deliberate
    ones:

    | Change | Decision | Seen by users? |
    | --- | --- | --- |
    | Opening a project is refused while projects move into a folder: the rows are not clickable | 31, 43 | Yes |
    | Only the newest list refresh lands | 37 | Only as a fixed glitch |
    | No store change while a project is open | 37 | No (the UI cannot reach it) |
    | A Library command on this engine's own open project is refused with its own code | 11 | No (headless callers only) |
    | `addMark` refusals with typed codes | 33 | No (the UI never sends such targets) |
    | `bad-message` split into five codes, sentences unchanged | 28 | No |

  - Detection, recognizers, models or OCR; only their seams are named.
  - A CLI or Node host, a server, or any client transport besides in-process
    calls. The client never moves into a worker.
  - Schema migrations: the existing v1 and v2 migrations stay, none is added.
  - Fixing the latent undo-after-approval bug (decision 22) or the image-check
    misreport (issue #14). The undo bug: an approval leaves documents it did
    not change with their undo history, so undo there can bring back a mark in
    a type the project has since changed for that value, breaking "one value,
    one type" (`useMarks.ts:51`, `spread.ts:224-226`).
  - A render queue with priority and cancelling ([issue
    #13](https://github.com/Sahil333/redactorator/issues/13)), a diagnostics
    stream, automatic worker restart, editing `docs/`.

## Alternatives Weighed

| Alternative | Rejected because | Trade-off accepted |
| --- | --- | --- |
| Engine client in a worker, the UI keeping a copy of the state | Every mark and undo costs a round trip and a copy to reconcile; the owner ruled the client never moves into a worker | Heavy main-thread work must go behind a worker port |
| Engine in a worker with the UI predicting results | Two runners of the rules to keep in step | As above |
| Undo and redo in the UI, as snapshots or inverse commands | Project rules stay in or split into the UI; snapshot restores overwrite concurrent changes | The engine holds 100 snapshots per document |
| The engine holding folder handles and permissions | These need the user present | The app builds `Store` objects |
| A store-opener port and store descriptions | An extra port for a store that changes only when the user picks a folder | The Library cannot open a store by itself |
| A platform port for ids and hashes | More code than a declaration file of globals every runtime has | Those globals must exist in every host |
| `postMessage` or stdio client transports, a clone check | The client always runs in its caller's thread | A future remote client would need new design |
| A `MessageChannel` for renders | The in-process client already serves renders | None |
| Separate Library and Session states | Two reads could show new settings beside a stale output | One state changes more often |
| The UI sending the finished target, text included | Text and positions could disagree; positions are the single source of truth | `addMark` needs the page text held for the lease |
| Building onto today's worker and hooks | Detection would add to the coupling | None |
| Deferring the `worker.ts` split to phases 3 and 5 | Separation now, as a verbatim move | The oracle-judged tests are the only proof |
| Freezing every test and the worker protocol | Tests may be rewritten if each proves the same thing | A rewritten test can lose its point; the ledger and negative controls guard it |
| A Session-only engine, library operations left in the app | The lock rule would stay split | The Library adds the first move, settings and the lock hand-off |
| A stricter Library gate, one operation at a time | It refuses things that are safe today | None |
| A before-and-after byte comparison of cleaned PDFs | The owner accepts the small risk | None |

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| A rewritten test stops testing its point | Rewrite before refactor, negative controls, self-checking fakes, the ledger |
| The verbatim move hides a change in the write path | Named verbatim set, unchanged bodies, oracle-judged tests; the owner accepts the rest |
| Stored bytes change, breaking old tabs or rollback | The golden test over all four stored files, per-path builders, no version bump, the stable-names list before the first move |
| `addMark`'s computed text or boxes differ from today's | The same functions on the same live page text; the golden test's cross-page mark |
| The app writes around the save queue or the lock with its live `Store` | The app hands a `Store` only to `switchStore` and `importFrom`, and keeps no other use of it; fallow zones keep the app from importing storage backends except through `host-browser`'s build function |
| A store goes stale when the user revokes folder permission | Today's behaviour: writes fail and the save state shows it |
| Duplicating a project holds whole files in memory | Files are read one at a time; accepted (decision 32) |
| The UI keeps a project rule after the move | Commands are data; the concurrency table; output validity owned by the Session |
| Browser-only code creeps into the core | Per-folder typecheck configs and fallow zones, switched on per slice |
| Document text leaves through a transport | No network transport; the WebSocket and EventSource check |
| The unload flush stops landing | Synchronous commands, `flush()` never queued and with no `await` before the write; tested during an apply and an approval search |
| The data-loss race during the first move | Fixed in its own PR before the refactor (slice −1) |

## Key Decisions & Staging for Next Steps

**Decided by the owner** (numbers kept stable)

1. The engine runs headless, and owns project state and rules.
2. The engine client runs in the same thread as the code that uses it, in a
   browser or in a Node or Bun process, and never moves into a worker. Heavy
   work runs behind the facade, in workers the host starts for the engine.
3. Undo and redo history lives in the engine, per document; the UI keeps
   shortcuts, buttons and which document they act on.
4. Saving is engine behaviour. The one-writer rule is the engine's; its
   mechanism is a host port. Folder picking, permissions, remembering handles
   and persistent storage stay in the app.
5. Storage is a module: an interface in `engine/storage`, with backends in
   the host.
6. No schema migration work until the product is live; existing migrations
   stay.
7. Separating responsibilities is intended design; AGENTS.md and
   typescript-rules rule 1 were reworded on 2026-11-23.
8. The refactor comes before phase 3.
9. Tests may be rewritten for the new design as long as each proves the same
   thing.
10. The write path moves verbatim, with no new leak fixture; AGENTS.md's rule
    now covers changes to how the write path behaves.
11. The engine has Library and Session scopes.
12. One plan for the whole refactor (this brief, then `/egm-draft`).
13. The engine owns settings: appearance, custom mark types and, from phase 4,
    the policy.
14. No network transport and no server; a browser test checks no WebSocket or
    EventSource opens. (Revised by 38.)
15. The lock port excludes engines in the same lock domain only (for the
    browser, one profile and origin); it is not re-entrant and is released
    when its holder dies.
16. Headless is proved by a no-DOM typecheck for the core and fallow zones; a
    Node smoke test waits for the first real CLI.
17. The matcher keeps running inside the PDF worker.
18. (Merged into 24.)
19. The app reads one immutable engine state with one revision through
    `engine.getState()` and `engine.subscribe()`, bound to React with
    `useSyncExternalStore`. No clone check.
20. New tests cover every behaviour nothing watches, except the undo depth of
    100, which stays a named constant.
21. Labelling: the `label` change kind, link ids and the ground-truth builder
    are engine rules; the `?label` switch and the export button stay in the
    app.
22. The latent undo-after-approval bug stays, to be logged as a GitHub issue
    once the owner approves filing it.
23. HLD and plan edits are proposed as one change list once the design is
    final.
24. Renders and page text are facade queries on the view lease, served by the
    in-process PDF-worker client, and stay outside engine state. Pixels are
    `{width, height, rgba}`. A render queue is a later improvement, [issue
    #13](https://github.com/Sahil333/redactorator/issues/13).
25. Today's worker message names stay; the TypeScript type names may change.
26. The store only changes when the user picks a folder: the first move from
    Chrome's storage into a folder, or picking the folder again after it went
    missing. Importing reads another folder only to copy one project in.
27. Folder layout: everything under `engine/` (model, storage, api,
    pdf-protocol, core, pdf, host-browser) and `app/`.
28. Error codes: `bad-message` splits into five codes in the facade, each
    keeping today's sentence; it stays one code on the wire. (Name-field
    marking dropped by 42.)
29. Browser tests fake the PDF worker only for failure and timing cases, at
    the worker wire as today, with rewrite before refactor, negative controls,
    self-checking fakes and a ledger.
30. The verbatim move freezes the verbatim set's code and sentences, the
    `apply`, `applied` and `error` message shapes, and `apply`'s own sentences;
    `apply` itself moves as plumbing in its own step.
31. The data-loss race (opening a project during the first move into a
    folder) is fixed in a small bug-fix PR before the refactor.
32. The core has no browser types: a `Uint8Array`-or-string `Store`, a
    declaration file for the shared web globals it uses, plain pixels, and
    plain values from the app at intake.
33. Positions are the single source of truth for a text mark: `addMark` takes
    per-page pieces, and the engine works out the text and boxes.
34. The engine computes derived views (`reach`, `newFrom`) and keeps them in
    its state; the keep-here key is worked out inside the `keepHere` command
    (revised 2026-11-24).
35. The image-check misreport is [issue
    #14](https://github.com/Sahil333/redactorator/issues/14), fixed at the
    first planned change to how the write path behaves.
36. The host passes live `Store` objects into the engine; there is no
    store-opener port.
37. Library gating keeps today's rules plus three additions: no store change
    while a project is open, a sequence number so only the newest list refresh
    lands, and the "list is a hint" rule written down.
38. The client is in-process only. Message passing exists only between the
    engine and its own worker.
39. No parsers for facade commands, no diagnostics stream, and typed error
    causes only where the error table already needs a code.
40. No before-and-after byte comparison of cleaned PDFs and no extra
    moved-code check: the oracle-judged tests are the proof, and the owner
    accepts the small risk.

41. `addMark` takes per-page pieces the UI already trimmed; the engine works
    out text and boxes synchronously from the live page text held for the
    open-document handle (the view lease, renamed in drafting); one target builder in `engine/model` is shared with the app's
    preview; today's running-header rule stays; the stored format is
    unchanged.
42. Error data carries no "content" marking; decision 28's marking is dropped.
43. While projects move into a folder, the project rows on Home are not
    clickable, and opening from the address waits until the move ends. No new
    sentence.
44. No new worker message to drop a stale output; the client stops serving
    its renders, and the worker replaces its output at the next apply or open.
45. `confirmApproval` detects a change since planning by comparing the
    project record the plan was made from, by identity, as today.
46. The deliberate behaviour changes listed under Non-Goals are accepted.

47. Drafting rulings (2026-11-24): the draft's versions stand for the
    keep-here key, the appearance command (`settings.update` on the Library),
    refusals as command results, outputs tagged by appearance, and
    `IncomingFile.read()`. The design document is the source of truth for
    names from here on.

48. While approval works out what spreads, and while its heads-up is open,
    the page and the marks panel take no edits (2026-11-24). The record
    cannot change during an approval, so nothing is planned again; the
    identity check of decision 45 stays only as a guard, and if it finds a
    change the approval fails and nothing is approved.

49. Adding documents is refused while a document is being applied, and
    while the heads-up is open (2026-11-24). Only one Session operation runs
    at a time.

50. The engine is namespaces outside and slices inside: a hand-written
    dispatcher, typed change records, pure slices, selectors and effects
    (drafting, 2026-11-24; the design's Alternative K).

51. Decision 43 extends: while projects move into a folder, or the
    remembered folder reopens, each project row's menu is disabled too, and
    every Library command except refreshing the list is refused
    (2026-11-24).

**Open questions for the owner**

None at the time of writing.

**The design `/egm-draft` must contain** (moved out of the order of work)

State diagrams for the Library, the Session, approval and closing; the
concurrency table; the facade's commands, queries and state shape with types;
the error table; the `worker.ts` move table; the folder, typecheck config and
fallow zone table (folder, config path, lib and types, test files, the slice
that switches it on, the `typecheck` script line, the zone's allowed edges).

**Order of work**

Each slice is one PR. Each keeps every browser test, the oracle and fallow
green, turns on the typecheck config and fallow zone of every folder it made
clean, lists any layer edge it temporarily allows, and records its rewritten
tests in the ledger. Every slice can be rolled back alone. Moves copy,
verify, then remove.

| Slice | What it does | Done when | Decisions |
| --- | --- | --- | --- |
| −1 | Race fix: no project opens while projects move or a folder opens | A new browser test holds the first move (slow `createWritable`, as `projects.spec.ts:515-521`) and shows a row cannot be opened and the address waits; all tests green | 31 |
| 0 | Fallow spike: does fallow see the `new URL(..., import.meta.url)` worker edge, does it count for zones, can a zone limit a sub-folder to one importer? Fallbacks: list the worker as an entry, or allow exactly that edge. Stable-names list (lock name, IndexedDB and sessionStorage keys, stored paths, folder-naming rules, picker ids, `#project=`, `?label`, the `worker-` prefix). Ledger template | The spike's answers and the list are written into the design | 25, 29 |
| 1 | Tests: new tests for unwatched behaviours, the golden stored-bytes test, behaviour-named self-checking fakes, the WebSocket and EventSource check. Any rewritten test lands here | All pass on today's code; each timing test shown red once with its behaviour removed | 14, 20, 29 |
| 2 | Imports-only moves: split `contract.ts` into model and pdf-protocol; split `marks.ts` and `selection.ts`; move spreading, images, mark types, ground truth and stored formats | `engine/model`'s typecheck config (no DOM) and zone are on and green | 27 |
| 3 | Platform-neutral code: the new `Store` shape and backends, the declaration file, the lock port wired into today's callers (`projects.ts:247`, `useProjectStore.ts:185`); `App` keeps the lock hold as it keeps `release` today | `engine/storage` config and zone on; the golden test green | 15, 32 |
| 4 | The PDF-worker client and `pdf-protocol` move out of `useEngine.ts`, over a host channel; pixels as `{width, height, rgba}`; the view lease, issued to `useDocumentInEngine` until slice 6 | `engine/pdf-protocol` config on; `useEngine.ts` holds only React state | 24, 25, 28 |
| 5 | Engine root and facade (`getState`, `subscribe`, command results), Library skeleton with open and close and settings, a Session holding only the project record | `engine/api` config on; Home and ProjectView read the facade's state | 2, 11, 13, 19, 38 |
| 6a | Session: history, save queue, counters, `flush`, `close`; `useProject.ts` deleted | New history and save tests green | 3, 4 |
| 6b | Session: mark commands with `addMark` by positions, outputs, the view lease from `session.view`, derived views; `useMarks.ts` closures go | Golden test green; marking and redaction tests green | 33, 34 |
| 6c | Session: two-step approval; `useApproval.ts` deleted | Spreading tests green | 19 |
| 6d | Intake at the root, document images; `useAddDocuments.ts` reduced or deleted | Project and add tests green | 1 |
| 7 | Remaining Library commands, the first move and import; `useProjectStore.ts` reduced to app concerns | `engine/core` config on and green; folder and project tests green | 26, 36, 37 |
| 8 | `worker.ts` split: the verbatim set moves; then `apply` as plumbing in its own commit; one bundled worker entry | `engine/pdf` config (WebWorker lib) on; redaction and oracle tests green; the built worker has no engine code in split chunks | 10, 17, 30, 40 |
| 9 | Headless proof and docs: every engine config and zone on; the HLD and plan change list proposed to the owner | `pnpm typecheck` runs every config; fallow green | 16, 23 |
