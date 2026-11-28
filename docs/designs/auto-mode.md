# Phase 4: Auto mode

*   **Author:** Sahil Chaddha
*   **Status:** Proposed. Revised twice on 2026-11-28, after each of two
    design reviews, and once more that day when the author allowed marks to
    overlap; what changed is listed under "Changes after the design reviews".
*   **Date:** 2026-11-28

This document can be read without any other. It came from a brainstorm, whose
brief is the author's working file and is not part of the repository. "Brief
S24" or "brief A8" in brackets points to that brief's decision register, to
show where a decision came from. Where the two differ, this document takes
precedence.

--------------------------------------------------------------------------------

## Overview

Auto mode finds personal data in a PDF for the user. The user starts a run on
one document. Recognizers search its text and propose findings. The user goes
through the findings in a side panel, unticks or changes the wrong ones, and
confirms. Each confirmed finding then becomes an ordinary mark.

What happens after a mark exists comes from phases 1 to 3: approving the
document, spreading a value to the other documents of a project, writing the
output file, and the leak checks on that file. One rule of spreading changes
(decision D14). Marks made by Auto mode may overlap other marks, which the
writer must accept; that fix to the writer is separate work that lands before
this phase needs it (Risks and Mitigations).

This document covers the whole phase in one place, at the author's choice. It
has three parts:

1.  **The detection frame.** The code that runs recognizers in a worker, away
    from the page's own thread, turns their hits into findings, and stores the
    state of a findings review.
2.  **The rule packs.** Rules for 65 identifiers: those of the United States,
    the United Kingdom, India, Canada and Australia, those of three
    industries, and those used in any country.
3.  **The findings panel.** What the user sees and can change during a
    findings review.

This phase finds values that a pattern can find: numbers and codes with a
fixed format. It does not find people's names or free-text addresses. Those
need a model, which a later phase adds through the same frame and the same
panel.

The work is cut into slices arranged as a dependency graph, so that slices
which do not depend on each other are built at the same time (author, 27 Nov
2026). The rules for that are in the Detailed Implementation Plan, section 1.

## Terms

| Term | Meaning |
| --- | --- |
| Author | The one person who owns this product and decides its design. Earlier documents also say "owner" |
| Mark | One area of one page that the output file removes. A text mark holds its page, its character range, its text and its boxes |
| Type | The label a mark carries, such as "Person" or "SSN". The list of types is in `dataset/ground-truth.schema.json` |
| Key | The form of a value that every way of spacing it shares, made by the existing function `keyOf`: case is folded, and spaces, dots and dashes between two digits are dropped. Two marks with the same key are the same value. `123-45-6789` and `123 45 6789` have one key. `QQ 12 34 56 C` and `QQ123456C` have two, because joiners are dropped only between digits |
| Spreading | When a document is approved, each value it marks is found and marked in the project's other documents. It works by key |
| "Don't hide here" | The existing per-document choice (the `shown` list) that stops a value hidden in the project from being hidden in one document |
| The writer | The existing code that removes marked content and writes the output PDF, and checks its own result |
| The outside checker | The tool in `tests/oracle/` that judges an output file for leaks. It shares no code with the app (`docs/designs/pdf-leak-suite.md`) |
| Reader | The code that turns a PDF into pages, characters and boxes (MuPDF and the preparation around it). Each build names its reader with a tag, `READER_TAG`, today `pdf-3` |
| Reader folder | `.redactorator/<reader tag>/` inside a project's folder. Stored files that depend on character positions live there |
| Reader change | Opening or copying a project with a build whose reader tag differs from the one the project was stored under. The project is copied into the new reader folder and its documents are prepared again. Positions stored under the old tag are no longer valid |
| Run | One search of one document by Auto mode |
| Recognizer | Code that searches page text and reports hits. This phase has one, which runs the pack rules |
| Hit | One match by one recognizer at one place on one page, with the text it matched |
| Place | A page and a range of indexes into that page's stored characters (`PageText.chars`) |
| Identifier | A kind of value a rule looks for: SSN, IFSC, UPI ID. Each identifier is one type. The 65 are listed in the Detailed Implementation Plan, section 2, "The identifiers" |
| Evidence level | `checked` (a checksum or a list confirmed the value), `labelled` (a label or a companion hit supports it) or `format` (shape alone). `checked` is the strongest and `format` the weakest |
| Candidate | One reading of one span of text: an identifier and its evidence. Two rules that match the same span give one finding with two candidates |
| Finding | What the user decides on: one value in one document, with all its places and its candidates. Two found values that overlap are two findings. The panel calls findings "found values" |
| Resolver | The step that turns a run's hits into findings |
| Findings review | The state a document is in from a run that found something until its findings are confirmed, closed, dropped or all covered by marks. The code already uses "review" for a document's state (`not-started`, `in-review`, `approved`); the two are different things, and code names for the new thing use `findings` and `detection` |
| Design review | A review of this document. There were two, both on 28 Nov 2026 |
| Rejected value | A value the user unticked in a confirmed findings review. Auto mode does not offer it again in that document. It has no other effect |
| Pack | A named set of rules. Each profile choice adds one pack to a run; the `universal` pack is in every run |
| Profile | The countries and industries a project has chosen. A single run can use a different profile |
| Slice | One unit of building work, built in its own git worktree (a separate checkout of the repository). Slices have ids such as C0 and C1 |
| Fixture | A test file. A near-miss is a test value shaped like an identifier that must not be found |

## The Problem

Today every mark is made by hand. The user reads the document, selects each
value and marks it. Approving the document then spreads each marked value to
the rest of the project.

*   **It is slow.** A 100-page bank or tax file can hold hundreds of account
    numbers, tax numbers and card numbers. The first customers are back-office
    teams in India who prepare US and UK files for accountants, lawyers and
    medical offices. Their cost is the time one person spends on one file.
*   **It misses.** A value the user does not notice stays in the file. For
    this product a missed value is the worst error, worse than removing
    something that could have stayed.
*   **The plan for this phase no longer fits.** `docs/Implementation-Plan.md`
    describes six countries with India later, findings sorted into "auto" and
    "needs review" bands, and an unconfirmed finding redacted by default.
    `docs/designs/composable-engine.md` already replaced the last of these: a
    finding is a proposal and changes nothing until the user accepts it. The
    brainstorm replaced the others.

The solution is a run that proposes findings and a panel that lets a
non-technical user accept hundreds of them in a few actions. Every finding is
ticked when the panel opens, so the user's job is to find what to untick. The
rules come from public specifications and are checked by generated test files.
Nothing a user loads leaves the browser: the rules and the lists they use ship
with the app.

## Goals

Each goal can be checked by a test or a count that needs no benchmark. The
benchmark and the synthetic dataset are separate work (brief S4). Ids G6, G19
and G21 belonged to goals that were removed and are not reused. The table that
maps each goal to its test is in the Verification Plan.

**Finding**

*   **G1.** A run on one document finds every planted identifier in one
    generated PDF per pack. A browser test fails on any planted value that is
    missed or any planted near-miss that is found, and lists the other
    findings.
*   **G2.** Every rule has positive examples and near-misses, and records
    the source of its format and of its check: the issuer's page, a published
    standard, or an existing public resource such as Microsoft Purview's
    documentation, Presidio or python-stdnum. A fact recalled with no source
    is not enough to write a rule.
*   **G3.** The packs cover the 65 identifiers: one pack per country, one per
    industry, and one that every run uses.
*   **G4.** Pattern findings for a 100-page fixture arrive within 60 seconds
    in a Chrome worker, on the production build (brief S8). Slice C0 measures
    the time on the production build and on the instrumented build the browser
    tests use, and sets the test's limit for the instrumented build.
*   **G5.** A run shows which page it is on and can be stopped at any time.
    A run that ends early, by Stop or by an error, keeps the findings of the
    pages already searched and says which pages were not searched. The pack
    build fails on a pattern with a slow shape: one whose running time can
    grow very fast with the length of the text, such as a repeated group
    inside another repeated group.
*   **G7.** A profile is a set of countries and a set of industries. It
    belongs to the project and can be replaced for one run. Each choice adds
    one pack. A new project has no profile: the first run asks the user to
    choose, and choosing nothing is allowed.

**The findings review**

*   **G8.** Findings are sorted with the strongest evidence first (brief
    S38). The types leave room for a second stage of model findings; this
    phase has the pattern stage only (brief S30).
*   **G9.** Every finding is ticked when the panel opens. The findings are
    confirmed together. A finding is accepted or rejected for all its places
    in the document (brief S14, S36, S40).
*   **G10.** The user can change a finding's identifier or span by picking
    another of its candidates, and can move where it starts and ends (brief
    S20, S33).
*   **G11.** Accepted findings become marks in one step when the user
    confirms, after a dialog. One undo then removes all of them, after a
    dialog. Closing the panel, after a dialog, ends the findings review and
    keeps nothing. There is no undo inside a findings review (brief S24, S35).
*   **G12.** A findings review survives a reload, a restart and a return
    visit: the same findings, the same ticks and the same edits (brief S25).
    It is dropped in two cases, and the user is told why and offered a new
    run: a reader change, and stored text that no longer matches the found
    values.
*   **G13.** A later run never offers a value that is already marked at that
    place, or a rejected value (brief S26).
*   **G14.** Approving a document and confirming its findings are separate
    acts. Approving a document whose findings review is open shows a warning
    with the number of found values not yet marked, and lets the user proceed.
    The findings review stays open (brief S28).
*   **G15.** A mark made from a finding carries the specific identifier's
    name, such as SSN or IFSC, never a general name for a group of identifiers
    (brief S34).
*   **G22.** Marks may overlap. Every value Auto mode finds is a finding of
    its own and, once accepted, has marks of its own, also where it lies
    inside or around another found value or another mark.

**Keeping the product's rules**

*   **G16.** No request carries document bytes, text or findings. Packs and
    lists ship with the app. The existing same-origin test covers the new
    worker.
*   **G17.** This phase does not change how the output file is written. A
    downloaded file made from accepted findings passes the outside checker,
    including a fixture with a character stored as two UTF-16 units in front
    of an identifier, and a fixture with marks that overlap, touch, cross a
    line end, and number in the hundreds on a page, with and without each
    mark's type printed in its box (brief A2, A12).

**Preparing for what comes next**

*   **G18.** Hits that no regular expression made pass through the same
    worker messages, the same resolver, the same panel and the same step that
    makes marks. A test shows it with a prepared list of hits that carry model
    evidence and edges inside words (brief S12).
*   **G20.** The cost of a findings review is counted on the generated files:
    actions from Run to an approved document, findings in the panel, and
    unticks needed, against the hand marks the same document needs.

## Non-Goals

*   **People's names, addresses and other free text.** Recognizers that use
    named-entity recognition (NER) or a large language model are later phases.
*   **Patterns a user writes** (author, 28 Nov 2026). A later addition.
*   **Search and mark** (item REV-10 of `docs/Implementation-Plan.md`; author,
    28 Nov 2026). A later addition.
*   **A time limit on a rule, a page or a run** (author, 28 Nov 2026). The
    user stops a run that takes too long.
*   **Reading a page's layout** (author, 28 Nov 2026). This phase takes the
    page text as the reader gives it and does the plain thing with it. It does
    not pair a label with a value by row or by column, does not join a value
    that wraps onto the next line, and does not read a value written one
    character to a box. Reading layout, most likely with a model, is a
    research area for later. Until then a value in such a layout is found
    only if its rule needs no label and the value is unbroken.
*   **A notice of what Auto mode did not search for** (brief S29). A run that
    ends early still says which pages it did not reach.
*   **Scanned pages and formats other than PDF.**
*   **The benchmark and the synthetic dataset** (brief S4).
*   **Looking a value up at an outside site or service.** It would send a
    finding out of the browser.
*   **Any change to how the output file is written.**
*   **Hand marking while a document's findings review is open** (brief S31).
*   **A warning or a refusal on Preview or Download during a findings
    review.** The output shows the marks as they are.
*   **Keeping a value in some places of a document and removing it in others**
    (brief S36).
*   **The stage of model findings.** Its state and storage are built with the
    first model recognizer.
*   **A slider, bands, thresholds or strictness settings** (brief S7).
*   **Keyboard shortcuts for the findings review** (item REV-11; brief S41).
    The panel still works from the keyboard, because the accessibility
    standard WCAG 2.2 at level AA is kept.
*   **A timed session with an outside user as a condition for closing the
    phase** (author, 27 Nov 2026). The count in G20 is the phase's only
    measure of the cost of a findings review.
*   **A run across a whole project, or two runs at once.** One run covers one
    document, and a project has one run at a time.
*   **A second regular-expression engine.** JavaScript `RegExp` sits behind an
    interface; nothing else is built behind it (brief S11).
*   **A runtime dependency on a stdnum library, and converters that import
    rules from other tools** (brief A11).
*   **The UK modulus check on a sort code and account number,** until the
    licence for shipping its tables is checked (brief A14). The rule uses
    labels until then.
*   **The checksum inside a crypto wallet address.** It needs SHA-256, which
    the platform offers only asynchronously. The address is found by its
    format and a label.

## Open Questions

The design decisions are in the Technical Plan, section 10, and slice C0's
measurements are under "C0 results and rules left out". Two points wait for
the author:

*   **IMEI's pack.** It is in `legal`, as the author approved with the first
    draft. The first design review proposed moving it to `universal`. It
    stays in `legal` unless the author moves it before slice PX starts.
*   **The unit tests before the panel exists.** Slices C1, W1 and E1 add four
    unit test files, because no screen exists yet to test through. Each is an
    exception to "browser tests first"; they are written as listed unless the
    author strikes one.

## Critical User Journeys (CUJs)

### CUJ 1: Run Auto mode and confirm

*Goals: G8, G9, G11, G15. Plan: sections 1 and 4.*

*   **Given**: a project whose profile is the United States and finance, and
    an open 100-page bank file with no marks.
*   **When**: the user presses "Run Auto mode".
*   **Then**: the run shows the page it is on. When it finishes, the findings
    panel takes the place of the marks panel, with every finding ticked,
    strongest evidence first. Each finding shows its identifier's name, the
    exact text that will be removed, the number of places, and the reason
    ("passed its check", "next to the label Account No"). Hand marking is off.
    The user presses the confirm button, whose label states the result: "Mark
    188 values for removal". A dialog repeats the count and asks to confirm or
    cancel. On confirm the 188 values become 612 marks, one for each place,
    and the marks panel returns. On cancel the findings panel stays open.

### CUJ 2: Change findings before confirming

*Goals: G9, G10, G22. Plan: section 4.*

*   **Given**: the findings panel is open.
*   **When**: the user unticks a phone number, changes the identifier of one
    finding to another of its candidates, lengthens the edge of a third, and
    shortens the edge of a fourth.
*   **Then**: on confirm, the unticked value becomes a rejected value: it
    stays in the file and is not offered again in this document. The user
    never has to choose an identifier: each finding has a default, which stays
    unless the user picks another. A shortened edge applies in every place of
    the value. A lengthened edge marks the wider text in each place where it is
    present, and the value as found in the other places.

### CUJ 3: Leave a findings review and come back

*Goals: G12. Plan: section 5.*

*   **Given**: the findings panel is open and the user has unticked 12
    findings and edited 2.
*   **When**: the user closes the tab and opens the project the next day.
*   **Then**: the findings panel shows the same findings, with the same 12
    unticked and the same 2 edits. No run happens. No mark has been made yet.

### CUJ 4: Run Auto mode again

*Goals: G13, G22. Plan: section 3, the resolver.*

*   **Given**: a document whose findings review was confirmed last week: 188
    values were marked and 4 were rejected. The user has since marked 3
    people's names by hand, and has marked part of one account number.
*   **When**: the user runs Auto mode again after a pack was updated.
*   **Then**: the panel offers only what is new. It offers none of the 188
    marked values and none of the 4 rejected values. The account number that
    the hand mark covers in part is offered, because no mark of that whole
    value is there; accepting it adds a mark that overlaps the hand mark. If
    nothing is new, no panel opens and one line says so.

### CUJ 5: Approve a document while its findings review is open

*Goals: G14. Plan: section 4.*

*   **Given**: a document whose findings panel is open with 40 findings.
*   **When**: the user approves the document.
*   **Then**: the approval dialog says: "40 found values are not marked and
    stay in the file." If the user proceeds, the document is approved on its
    marks as they are. The findings review stays open. If the user confirms it
    later, the new marks put the document back in review, as any edit to an
    approved document does today.

### CUJ 6: Undo a confirmed findings review

*Goals: G11. Plan: section 4.*

*   **Given**: a findings review that was confirmed and marked 188 values in
    612 places, on a document not approved or reloaded since.
*   **When**: the user chooses undo.
*   **Then**: a dialog in the centre of the view says that the 612 marks Auto
    mode made for 188 values will be removed. If the user confirms, they are
    removed in one step. The rejected values stay rejected. The undo step is
    lost in the ways every undo step is lost today: when the project is
    reloaded or reopened, when the document is approved, and when another
    document's approval spreads marks into it.

### CUJ 7: Stop a run

*Goals: G5. Plan: sections 1 and 8.*

*   **Given**: a run that has been on page 12 of 100 for a long time.
*   **When**: the user stops it.
*   **Then**: the worker is ended at once. If pages 1 to 11 gave findings,
    the findings panel opens with them and one line: "Stopped. Pages 12 to 100
    were not searched." If they gave none, no panel opens and the same line is
    shown beside the Run control. The document cannot be approved while a run
    is in progress, and can be once it has stopped.

### CUJ 8: Close the findings panel without confirming

*Goals: G11. Plan: section 4.*

*   **Given**: the findings panel is open with 192 findings.
*   **When**: the user presses Close.
*   **Then**: a dialog says: "Close without marking? 192 found values stay in
    the file. Your unticks and edits will not be kept." On confirm the
    findings review ends, nothing is marked, nothing is rejected, and hand
    marking comes back. A later run offers every finding again, ticked.

### CUJ 9: Choose what a run looks for

*Goals: G7. Plan: section 6.*

*   **Given**: a new project, which has no profile.
*   **When**: the user presses "Run Auto mode" for the first time.
*   **Then**: a chooser asks for countries and industries, with nothing
    selected, and lists under each choice the identifiers it adds. The user
    may continue with nothing selected; the run then looks only for the
    identifiers used in any country. The answer is stored as the project's
    profile and the run starts. Later, for an Indian back office preparing a
    US client's file that carries the preparer's own Indian tax numbers, the
    user picks "For this run only" and chooses the United States, India and
    finance. That run uses those packs; the project's profile is unchanged
    afterwards.

### CUJ 10: A maintainer adds an identifier

*Goals: G2, G3. Plan: section 6.*

*   **Given**: a new identifier whose format has a source that can be
    recorded.
*   **When**: the maintainer adds its id and name to the type list, its pack
    to `engine/model/identifiers.ts`, and the rule, its positive and negative
    examples and its source to the pack.
*   **Then**: the change is data and fixtures, one line of code for the pack,
    and a check function if the identifier needs a new one. The pack build
    fails on a slow pattern. The pack's generated PDF and its browser test
    cover the new rule.

### CUJ 11: A later phase adds a model recognizer

*Goals: G18. Plan: section 3.*

*   **Given**: this phase as built.
*   **When**: a maintainer adds a recognizer that runs a model.
*   **Then**: the recognizer runs in a detection worker and answers with the
    same messages. Its hits go through the same resolver and the same panel.
    That phase also builds what this one leaves out: the second stage's state
    and storage, and one undo that covers both stages. In this phase a
    prepared list of hits, not made by a regular expression, shows that such
    hits pass through (G18). It proves nothing about a real model.

### CUJ 12: Open a project after a reader change

*Goals: G12. Plan: section 5.*

*   **Given**: a document whose findings panel was open when the project was
    last used, and a new build with a different reader tag.
*   **When**: the user opens the project and the document.
*   **Then**: the document is prepared again and its marks are placed again,
    as today. Its findings review is gone. A notice on the document says: "The
    found values of this document were dropped, because an update changed how
    the app reads PDFs. Your unticks and edits were not kept. Run Auto mode to
    find them again." The notice has a Run button and can be dismissed. No run
    starts by itself, here or on rename, archive, duplicate or import.

### CUJ 13: A run meets an error

*Goals: G5. Plan: section 8.*

*   **Given**: a run on a 100-page document.
*   **When**: a check function fails with an error on one value on page 30,
    and later the worker itself fails on page 50.
*   **Then**: the error on page 30 costs only that one value: it counts as not
    having passed its check, and the run goes on. When the worker fails, the
    run ends early. The findings of pages 1 to 49 are offered, with one line:
    "The run ended early because of an error. Pages 50 to 100 were not
    searched."

### CUJ 14: Two found values overlap

*Goals: G22. Plan: section 4.*

*   **Given**: a UK bank statement where `12-34-56 12345678` appears, and a
    profile with the United Kingdom.
*   **When**: the user runs Auto mode.
*   **Then**: the panel lists two rows for that place: "Sort code and account
    number" with the whole text, and the account number `12345678` under its
    own name. Both are ticked. Confirming makes two marks that overlap, and
    both are drawn. If the user unticks the wider row, only the account number
    is marked, and the wider value becomes a rejected value.

## Technical Plan (Architecture)

**How the existing Session is built**, in the words this plan uses
(`docs/designs/composable-engine.md`, section 5, has the full account). The
app calls *commands* on a Session, which is one open project. A command first
asks the *gate* whether it may run now; the gate answers with an error code or
lets it through. A command changes state by dispatching a *record*, a small
object such as `markAdded`. Pure functions called *slices* each turn their own
part of the state and a record into the next state; a slice sees only its own
part. Work that waits, such as reading a stored file, is done by *effects*,
which dispatch records when they finish. The Session runs one *operation* at a
time (adding, planning, confirming, applying, updating). The *history* slice
keeps, for each document, a snapshot of its marks and its "Don't hide here"
list before each record that can be undone.

### 1. How a run flows

```text
 app                      engine/core (main thread)             detection worker
 ---                      -------------------------             ----------------
 "Run Auto mode"    --->  session.detection.run(document, profile?)
                          gate (section 7); no profile -> refused
                          effect: read the document's stored
                          page texts (not the viewer's)
                          start the worker if the Session has none
                          "load" with the profile's pack ids -->  load packs, lists
                          <-- "ready" with pack versions      <--
                          per page, one at a time:
                          "page" with that page's characters -->  text view -> rules
                          <-- "hits" for the page            <--  -> validators -> hits
                          state: running, page 12 of 100
                          when the run ends (finished, stopped
                          or failed): write the run record and,
                          if there are hits, the hits file
                          resolver(hits, marks, rejected
                            values, the user's changes)
 FindingsPanel     <----  state: the document's findings
   untick / pick a
   candidate / edges -->  session.findings.*        (state file, section 5)
   "Mark N values for removal"
   + confirm dialog  -->  session.findings.confirm(document)
                          effect builds one mark per place
                          from the stored page texts
                          record: findingsApplied
                          marks slice adds them: ONE undo step
 MarksPanel        <----  ordinary marks; spreading, apply and
                          the checks are unchanged
```

Four facts about the existing engine shape this flow:

*   **A mark is made from stored text, not from the open viewer.** The
    existing `textTarget` in `engine/model/selection.ts` builds a text mark's
    target from stored page texts and character ranges; it is what a hand mark
    uses. Confirming a findings review calls the same function, so a mark made
    from a finding is built exactly as a hand mark is, and the writer's check
    compares the same characters.
*   **One record is one undo step.** One `findingsApplied` record that carries
    every mark of the findings review is therefore one undo step, whatever its
    size (brief S24).
*   **A run is not an operation.** A run must not block opening another
    document, so it has its own state and its own gate rows (section 7).
    Confirming findings is an operation, because it changes the project
    record.
*   **Approval plans from a snapshot.** `approval.plan` works from the project
    record as it is, and `approval.confirm` fails if the record changed since
    (`engine/core/session/effects/plan.ts`). Confirming findings changes the
    record. The two are therefore separate acts that never happen inside each
    other (section 4).

The core sends one page and waits for its answer before sending the next. The
app can therefore show which page the run is on, and a page that takes too
long shows as a counter that does not move. Stop ends the worker at once: a
running `RegExp` cannot be interrupted any other way. Pages that answered
before the stop keep their hits. The next run starts a new worker.

The detection worker belongs to the Session. The Session starts it at its
first run, through a function the host supplies, keeps it for later runs, and
ends it on Stop, on a failure, and when the Session closes. A worker stuck on
a slow pattern is therefore never handed to another project.

### 2. Zones and what each may import

A zone is a folder with a rule, checked by the tool `fallow`, for which other
folders its code may import.

| Zone | Folder | May import | Holds |
| --- | --- | --- | --- |
| `model` (existing) | `engine/model` | nothing | New pure parts: the text view, the hit, candidate and finding types, the resolver, the profile, the identifier list |
| `detect-protocol` (new) | `engine/detect-protocol` | `model` | The messages between the core and the detection worker, and their parsers. Shaped like `pdf-protocol` |
| `detect` (new) | `engine/detect` | `model`, `detect-protocol` | The recognizer, the `RegexEngine` interface and its JavaScript implementation, validators, the packs and lists under `engine/detect/packs/`, the message handler, and the worker entry `detectWorker.ts`. No DOM |
| `tools` (new) | `tools/**/*.ts` | `model`, `detect` | The pack compiler |
| `core` (existing) | `engine/core` | `model`, `storage`, `api`, `pdf-protocol`, and now `detect-protocol` | The detection client, the new Session slices, effects, gate rows and commands |
| `host-browser` (existing) | `engine/host-browser` | as today | Starts the detection worker. One more line carries the exempt comment and names `../detect/detectWorker.ts`, as one names `../pdf/worker.ts` today |
| `tests` (existing) | `tests` | as today, and now `detect-protocol` and `detect` | The new browser tests |
| `app` (existing) | `app` | as today | The findings panel and its controls. No project rule lives here |

The packs have no zone of their own. They live inside `detect`, which only
`tools` and `tests` may import, so no pack reaches the main bundle through an
import. A browser test also checks that the main bundle holds no pack text.

The worker entry has its own tsconfig (`engine/detect/tsconfig.worker.json`)
that adds the `WebWorker` library, as `engine/pdf/tsconfig.worker.json` does.
It is named `detectWorker.ts` so that Vite builds it as
`assets/detectWorker-<hash>.js`. The PDF worker builds as
`assets/worker-<hash>.js`, and the test fakes and the network test find it by
that name.

The detection worker shares nothing with the PDF worker. The PDF worker's
handler is synchronous, and page renders wait behind it, so detection never
runs there.

### 3. Contracts

Slice C1 writes these. The field lists say what each thing holds; the code
block at the end of the section gives the shapes C1 must type exactly, because
four slices build against them at the same time.

**Text view** (`engine/model`, pure). Turns one page's characters into a
string and a map from each position in the string back to an index in `chars`.
Line ends and block ends stay visible in the string. The existing `normalise`
in `engine/model/match.ts` already builds such a map, and already handles a
character stored as two UTF-16 units. The text view and `normalise` share that
one loop, so positions are handled in one place.

**Hit.** `page`, `start`, `end` (indexes into `chars`, for the value only),
`text`, `identifier`, `evidence` (a list), `rule`, `recognizer`. `text` is
what the existing `rangeText` reads at that range, the function a mark's text
is read with. Phase 3 set the rule "a mark's text and boxes are its identity;
its offsets are a cache" (`docs/designs/pdf-leak-suite.md`); a hit follows it.
A hit never carries the label text around the value.

**Evidence.** A closed list of kinds, each mapped to one level:

| Kind | Example | Level |
| --- | --- | --- |
| `checksum` | Luhn, Verhoeff, modulus 97 passed | `checked` |
| `list` | the IFSC's first four letters are a known bank code | `checked` |
| `label` | "Account No" within the rule's distance. It carries which of the rule's labels matched, so the panel can name it | `labelled` |
| `companion` | a valid IFSC in the same block as the account number | `labelled` |
| `format` | the shape alone | `format` |
| `model` | a score from a model, mapped into the three levels by its recognizer | any |

A rule states the least evidence it needs. A rule may need only `format` when
its shape is distinctive, such as an email address; the pack compiler refuses
`format` alone for a pattern that can match digits only.

**The value, its key and its separators.** One definition serves rules, keys,
spreading and validators:

*   A finding's key is `keyOf` of the hit's text. That is by construction the
    key of the mark the finding becomes, so a finding and its marks group the
    same way. No other key exists.
*   `keyOf` drops joiners only between two digits. A value of letters and
    digits written two ways in one document is therefore two findings, as it
    is two values for hand marks today. This is accepted (Risks).
*   The pack compiler's named piece "one separator" is built from the
    matcher's own joiner class in `engine/model/match.ts`: white space, a
    hyphen, a dot, the dashes U+2010 to U+2015 and the minus sign U+2212. A
    rule therefore accepts exactly the separators a key ignores.
*   A validator receives the value's letters and digits only.

**Recognizer** (`engine/detect`). `load(packs)` once, then `detect(page)` for
each page, returning hits and never findings. The pattern recognizer is the
only one in this phase. Evidence that needs two hits is worked out inside it:
a companion, and a rule that gives way to another (`yieldsTo` below).

**Validators** are small pure functions on the matched text: check-digit
algorithms such as Luhn, Verhoeff and modulus 97. They look nothing up. A
validator can fail with an error only through a coding fault; the recognizer
catches it, counts the value as not having passed its check, counts the error,
and goes on (section 8).

**RegexEngine interface.** `compile(rules)` and `scan(text)`, returning for
each match the rule, the span of the whole match and the span of the value
group, all in positions of the text view's string. Matches of one rule are
found from left to right and do not overlap. The only implementation is
JavaScript `RegExp` with the `d` flag for group positions and the `u` flag.

**Rule.** `id`, `identifier`, `pattern`, `valueGroup`, `needs` (least
evidence), `labels` and `distance`, `notNextTo` (digit or letter, checked in
code after the match), `validator` (a name), `list` (a name), `companion`
(another rule and a distance), `yieldsTo` (a list of other rules), `source`,
`licence`, `verified` (date and where the format was checked). `yieldsTo`
works like this: if one of the named rules has a labelled hit on the same
span, this rule's hit is dropped. For example, a twelve-digit number labelled
UAN can pass the Aadhaar check by chance; `yieldsTo` stops it being called an
Aadhaar number. The source format of a rule is in the Detailed Implementation
Plan, section 2.

**Pack.** `id`, `version` (the first 12 hex digits of the SHA-256 of its
compiled rules, written by the compiler), `rules`.

**Detection messages** (`engine/detect-protocol`).

| Direction | Message | Fields |
| --- | --- | --- |
| to the worker | `load` | `run` (a number), `packs` (pack ids) |
| to the worker | `page` | `run`, `page`, `chars` |
| from the worker | `ready` | `run`, each loaded pack's id and version |
| from the worker | `hits` | `run`, `page`, `hits`, `errors` (how many values met an error in a check) |
| from the worker | `failed` | `run`, `code` (`recognizer-failed` when the packs could not be loaded) |

A reply whose `run` is not the current one is ignored. A worker that stops
answering through an error of its own is seen through the channel's error
event, with the code `detector-failed`.

**Finding** (made by the resolver, never stored). `key`, `text` (as written
at the first place), `places`, `candidates`, `chosen` (which candidate),
`edge` (section 4), `level` (the chosen candidate's), `reasons` (its evidence,
for the panel's sentence), `ticked`. A candidate is one identifier for the
finding's span.

**Resolver** (`engine/model`, pure). Input: the hits of one ended run, the
document's marks without its lost marks, its rejected values, and the changes
the user made in the open findings review. It needs no page text, because each
hit carries its own. Output: the findings. In order:

1.  Drop a hit where a text mark of the same value already sits: a mark with
    the hit's key that overlaps the hit's place (decision D11). This is what
    makes a later run skip values already marked. A hit inside or around a
    mark of another value is kept, and so gets a mark of its own. A mark that
    is lost, meaning it could not be placed after a reader change, is not
    counted: its stored positions point at other characters.
2.  Drop a hit whose key is one of the document's rejected values.
3.  Join hits on exactly the same span into one set of candidates, one per
    identifier. The default is the identifier with the stronger evidence, then
    the order of the packs (section 6), then the order of the rules in the
    pack (brief S39). Hits on different spans stay apart, also when the spans
    overlap: each becomes a finding of its own (decision D11).
4.  Join places that share a key into one finding (brief S10, S36). A finding
    has one identifier: the one with the strongest evidence at any of its
    places.
5.  Apply the user's stored changes by key, and drop a change whose finding
    no longer exists. If two findings now have the same key, they become one;
    the merged finding is ticked if either was. Then drop a place where a mark
    of the finding's value, as the user changed it, already sits.
6.  Sort by level, strongest first, then by first place (brief S38).

The same input always gives the same output.

**Where the resolver runs.** In the findings effect, never in a slice: a
slice cannot see the marks. The effect runs it and dispatches the result as
the record `findingsResolved`:

*   when a run ends;
*   when the Session begins, for each document with a stored findings review;
*   after each change the user makes in the panel;
*   after each record that changes the document's marks from outside the
    panel: an approval that spreads marks in, and marks placed again after a
    reader change.

If a pass leaves no findings, the effect ends the findings review and deletes
its stored files (section 5).

**The Session's new commands** (`engine/api/facade.ts`).

| Command | Takes | Does |
| --- | --- | --- |
| `detection.run` | `document`, optional `profile` | Starts a run. The optional profile replaces the project's for this run only |
| `detection.stop` | `document` | Ends the run. Pages already searched keep their hits |
| `findings.setTicked` | `document`, `key`, `ticked` | Ticks or unticks one finding |
| `findings.choose` | `document`, `key`, `candidate` (its index) | Picks another candidate: another identifier for the same span |
| `findings.setEdges` | `document`, `key`, `page`, `start`, `end` | Moves the edges of the finding. The user shows the new span at one place; the engine applies it to every place (section 4) |
| `findings.confirm` | `document` | Makes the marks and the rejected values, and ends the findings review. The app shows its dialog before calling |
| `findings.close` | `document` | Ends the findings review and keeps nothing. The app shows its dialog before calling |
| `findings.dismissNotice` | `document` | Removes a stored notice |
| `profile.set` | `profile` | Sets the project's profile |

**The shapes C1 types exactly.**

```ts
// engine/model/findings.ts
type EvidenceKind = "checksum" | "list" | "label" | "companion" | "format" | "model";
type EvidenceLevel = "checked" | "labelled" | "format";
interface Evidence { kind: EvidenceKind; level: EvidenceLevel; label?: number }
interface Hit {
  page: PageIndex; start: number; end: number; text: string;
  identifier: MarkType; evidence: Evidence[]; rule: string; recognizer: string;
}
interface FindingPlace { page: PageIndex; start: number; end: number }
interface Candidate { identifier: MarkType; level: EvidenceLevel; reasons: Evidence[] }
interface Finding {
  key: string; text: string; places: FindingPlace[];
  candidates: Candidate[]; chosen: number; edge?: string;
  level: EvidenceLevel; reasons: Evidence[]; ticked: boolean;
}
/** What the user changed in an open findings review, by finding key. */
interface FindingChange { ticked?: boolean; candidate?: MarkType; edge?: string }

// engine/model/detection.ts
type Country = "us" | "uk" | "in" | "ca" | "au";
type Industry = "finance" | "legal" | "medical";
type PackId = "universal" | Country | Industry;
interface Profile { countries: Country[]; industries: Industry[] }
interface RunRecord {
  run: string; ended: "finished" | "stopped" | "failed"; code?: ErrorCode;
  profile: Profile; packs: { id: PackId; version: string }[];
  pages: number; notSearched: PageIndex[]; hitsPerRule: Record<string, number>; errors: number;
}

// engine/core/detect-client/client.ts
interface DetectionClient {
  /** Loads the packs and searches the pages one at a time; resolves when the run ends. */
  run(input: {
    packs: PackId[];
    pages: { index: PageIndex; chars: readonly string[] }[];
    onPage(result: { page: PageIndex; hits: Hit[]; errors: number }): void;
  }): Promise<{ ended: "finished" | "stopped" | "failed"; code?: ErrorCode; packs: { id: PackId; version: string }[] }>;
  /** Ends the worker; a run in progress resolves as "stopped". */
  stop(): void;
}

// engine/api/facade.ts, added to Session
readonly detection: {
  run(document: DocumentId, profile?: Profile): Result<void>;
  stop(document: DocumentId): Result<void>;
};
readonly findings: {
  setTicked(document: DocumentId, key: string, ticked: boolean): Result<void>;
  choose(document: DocumentId, key: string, candidate: number): Result<void>;
  setEdges(document: DocumentId, key: string, page: PageIndex, start: number, end: number): Result<void>;
  confirm(document: DocumentId): Promise<Result<{ values: number; marks: number }>>;
  close(document: DocumentId): Promise<Result<void>>;
  dismissNotice(document: DocumentId): Result<void>;
};
readonly profile: { set(profile: Profile): Result<void> };

// engine/api/state.ts, added to SessionState
readonly detection: ReadonlyMap<DocumentId, DocumentDetection>;
interface DocumentDetection {
  run: { state: "idle" } | { state: "running"; page: number; pages: number };
  findings?: { findings: Finding[]; notSearched: PageIndex[] };
  notice?:
    | { kind: "nothing-found"; notSearched: PageIndex[] }
    | { kind: "run-failed"; code: ErrorCode }
    | { kind: "dropped"; reason: "reader-changed" | "text-changed" };
  nextUndo?: { kind: "edit" } | { kind: "findings"; values: number; marks: number };
  can: { run: boolean; stop: boolean; confirm: boolean; close: boolean };
}
// ApprovalPlan gains: readonly unmarkedFindings: number;
// The project state gains: readonly profile?: Profile;

// engine/core/session/changes.ts, the new records
// runStarted, pageSearched, runEnded, findingsOpened, findingChanged,
// findingsResolved, findingsApplying, findingsApplied, findingsClosed,
// noticeSet, noticeDismissed, profileSet
// findingsApplied: { document; marks: Mark[]; replaces: Mark["id"][]; rejected: string[] }

// engine/core/session/slices/history.ts
// A step keeps its snapshot as today. Beside `past` and `future` run two
// lists of tags, moved between them as the snapshots are:
type StepTag = { kind: "edit" } | { kind: "findings"; values: number; marks: number };
// `isUndoable` returns { document, tag } where it returns a document today.
```

A published finding carries positions, not boxes. The app works out the boxes
from the viewer's page text, as it does for a selection.

A `findings` command with a key that is not a finding, a candidate index that
does not exist, or a range that is empty or does not overlap the finding at
that page is refused with `unknown-finding`.

### 4. The findings review

**States of a document**

```text
                 finished or ended early,
                 with findings to offer
 none --run--> running ------------------------> open
   ^              |                               |
   |              | finished or ended early,      | confirm, after a dialog:
   |<-------------+ nothing to offer              |   marks and rejected values
   |              | (a line says so)              | close, after a dialog:
   |              |                               |   nothing is kept
   |<-------------+ could not start or load       | every found value is now
   |              | (a line gives the error)      |   marked: ends by itself
   |              |                               | reader change, or stored text
   |<-------------+ reload during the run         |   changed: dropped, a notice
   |                (its hits are lost)           |
   +----------------------------------------------+
```

`none` is `run: idle` with no `findings`; `open` is `findings` present. A run
cannot start from `open`: the gate refuses it.

*   `running`: the document cannot be approved (brief S2). The user can stop.
    The run's hits are held in memory and written when it ends, so a reload
    during a run loses them and the user runs again.
*   A run **ends early** when the user stops it or the worker fails. It keeps
    the hits of the pages that answered and lists the pages that were not
    searched (decision D17).
*   `open`: hand marking is off for this document (brief S31). The user
    unticks, picks candidates and moves edges. Each change is stored.
*   A run with nothing to offer, because it found nothing or marks and
    rejected values account for all of it, opens no panel.
*   If marks spread in from another document's approval come to mark every
    found value of an open findings review, it ends by itself, and its stored
    files are deleted.

**Confirm** (author, 28 Nov 2026). The confirm button's label states the
result. Pressing it opens a dialog: "Mark 188 values for removal? 4 unticked
values stay in the file and will not be offered again in this document." On
confirm:

1.  The record `findingsApplying` starts an operation named `marking`. From
    here until it ends, the existing rule of one operation at a time refuses a
    second confirm, an approval plan and Close.
2.  The effect reads the document's stored page texts and tests every stored
    hit against them (section 5). If one no longer matches, nothing is marked
    and the findings review is dropped with a notice.
3.  It builds one mark for each place of each ticked finding.
4.  One `findingsApplied` record adds the marks and the rejected values. It
    also takes the place of any lost mark with the same letters on the same
    page, as a hand mark does today (`markedAgain` in
    `engine/core/session/facade.ts`). Without that, removing the lost mark
    later would remove the new mark with it.
5.  The project is saved. Only when the save has succeeded are the stored
    files of the findings review deleted. The marks panel returns.

If no finding is ticked, the record carries only rejected values. It is then
not an edit: it makes no undo step and leaves the document's review state as
it was.

**Close** (author, 27 Nov 2026; the dialog added after the first design
review). The dialog's text is in CUJ 8. On confirm the stored files are
deleted and hand marking comes back. Nothing becomes a mark or a rejected
value. Closing the browser tab is different: it leaves the findings review
open.

**Approving a document is a separate act** (author, 28 Nov 2026). Approval
never confirms, closes or changes a findings review.

*   Approving a document whose findings review is open always shows the
    approval dialog, with one more line: "40 found values are not marked and
    stay in the file." Today an approval that changes nothing but the review
    state is applied without a dialog.
*   If the user proceeds, the document is approved on its marks as they are.
    The findings review stays open, and hand marking stays off for that
    document until it is confirmed or closed.
*   Confirming the findings review later is an edit like any other: it puts
    the approved document back in review and marks its download as changed.

**What an accepted finding marks** (decision D11, author, 28 Nov 2026). Each
place of an accepted finding gets one mark, which covers the finding's span at
that place and carries the chosen identifier as its type. Marks may overlap:
the marks of two findings whose values overlap, and a finding's mark with a
mark that was there before. The author's picture is that marks behave like
bosons: any number can occupy the same place, and each stays a mark of its
own.

*   Two found values that overlap are two findings and two rows. In a
    statement, `12-34-56 12345678` found as a sort code and account number,
    and `12345678` found as an account number, are both listed and both
    ticked. Confirming marks both. To remove less, the user unticks the wider
    row.
*   Each value therefore has marks under its own key, so each spreads to the
    project's other documents on its own.
*   The writer must accept overlapping marks, also when each mark's type is
    printed in its box. That is a fix to the writer made outside this phase
    (Risks and Mitigations); slices R1 and R3 wait for it.

**Edge editing.** The user moves a start or end handle at one place.
`findings.setEdges` receives that page and the new character range. The engine
stores the move as the normalised text of the new span, read with `normalise`
from `engine/model/match.ts`. It is stored as text because two places of one
value can be written with different separators, and the normalised text is
what they share. `normalise` is used and not `keyOf`, because `keyOf` also
trims punctuation at both ends, and a move over a closing bracket would be
lost.

*   At each place, the engine looks for a span that overlaps the hit and
    whose normalised text equals the stored text. Where it finds one, the
    mark covers that span. Where it does not, the mark covers the span as
    found.
*   A shorter span is found at every place, since every place holds the whole
    value. A longer span is found only where the neighbouring characters
    match.
*   So a finding lengthened where the wider text is present in 12 of its 15
    places makes 12 marks of the wider text and 3 of the value as found. The
    panel says: "Wider in 12 of 15 places."
*   A value the user shortened is offered again, whole and ticked, by a later
    run, because no mark of the whole value exists. An SSN shortened to
    `123-45` so that its last four digits stay readable comes back as
    `123-45-6789`. It is the user's choice to untick it again or to let it be
    marked whole (author, 28 Nov 2026).
*   If a shorter span makes a finding's key equal to another finding's key,
    the two become one (resolver, step 5).

A finding never splits in the panel, and it is accepted or rejected for all
its places (brief S36).

**A found value is left out only where that same value is already marked**
(decision D11, author, 28 Nov 2026). A hand mark on `45-6789` does not hide
the SSN `123-45-6789` around it: the SSN is offered, and accepting it adds its
own mark. A hand mark on `John Smith 123-45-6789` does not hide the SSN inside
it either. Each value ends with a mark of its own.

**A value on the "Don't hide here" list is offered like any other** (decision
D15, author, 28 Nov 2026). Confirming it marks it and removes it from that
list, as marking it by hand does today. It is the user's choice to reverse an
earlier one.

**Undo.** The history step made by `findingsApplied` carries a tag with the
number of values and marks. The state tells the app that the next undo is a
findings review, so the app shows the dialog (CUJ 6). Redo puts the marks back
and keeps the tag. Rejected values are not part of what undo restores
(decision D13). The step is lost when any undo step is lost (CUJ 6).

**Preview and Download during a run or a findings review** (author, 27 Nov
2026). Neither is refused and neither shows a warning. The output is made from
the document's marks as they are at that moment. The panel's instruction line
says: "Found values are removed only once you confirm."

### 5. What is stored

**In the project file** (`project.json`, decision D2):

```json
{ "profile": { "countries": ["us", "in"], "industries": ["finance"] },
  "documents": [ { "rejected": ["123456789", "jane@example.com"] } ] }
```

*   `profile` is optional and absent until the user chooses.
*   `rejected` holds keys and is read as an empty list when absent.

The parser fills these defaults for every file, as it does for `removedSeen`
today. The version stays 3 and no migration is written. Files of versions 1
and 2 get the same defaults. The folder `fixtures/golden/pre-phase-3/`, which
an older build stored and six tests open, stays as it is and still reads.

**In the reader folder, per document** (decisions D1, D8 and D16), under
`.redactorator/<reader tag>/findings/`:

| File | Holds | Written |
| --- | --- | --- |
| `<document id>.hits.json` | `run` (the run's id), `notSearched`, and the hits | Once, when a run ends with hits |
| `<document id>.state.json` | Either `{ "kind": "open", "run": ..., "changes": { "<key>": { ... } } }`, or `{ "kind": "dropped", "reason": "reader-changed" }` | When the run ends, with no changes yet; then on each change |
| `<document id>.run.json` | The run record: the run's id, how it ended, the profile, each pack's id and version, the pages not searched, the number of hits per rule, the number of errors. No values | When each run ends, whatever its outcome, replacing the record before |

Each has its own format name and starts at version 1. The hits and the state
are two files because they change at different rates: the hits can be
thousands of entries and never change, and the state is small and changes
with every untick.

The rules, in full:

*   **A findings review is open** exactly when the hits file can be read and
    every hit's text still reads at its place. The stored hits are tested
    with the same test that tells a lost mark (`engine/model/textAnchor.ts`)
    when the Session begins and again at confirm.
*   **If a hit's text no longer reads at its place**, which can happen when
    the document's original file was replaced and the document was prepared
    again, the findings review is dropped: both files are replaced by a state
    file of kind `dropped`, reason `text-changed`, and the user sees the
    notice with a Run button.
*   **The state file is tied to its run.** A state file of kind `open` whose
    `run` matches no hits file is ignored and overwritten by the next run. It
    is never applied to a later run, so old unticks cannot become rejected
    values of a run the user never reviewed.
*   **A notice needs no hits file.** A state file of kind `dropped` is kept
    until `detection.run` or `findings.dismissNotice` removes it.
*   **A hits file with no state file** is an open findings review with no
    changes.
*   **A file this build cannot read is left alone**, whether it is damaged or
    written by a newer build, and the document has no findings review. It is
    overwritten by the next run.
*   **Writes** to the state file go one after another through a queue, as
    `effects/save.ts` saves the project. The existing saving indicator covers
    the queue: it shows "saving" until the project and the queue are both
    written. `Session.flush` and `Session.close` wait for both.
*   **Ending after Confirm**: the project is saved; only if that succeeds, the
    hits file is deleted, then the state file. After a crash before the
    deletes, the findings review reopens with its hits and its changes. The
    resolver finds every value already marked, as the user had changed it, or
    rejected, and the findings review ends by itself.
*   **Ending after Close**: the hits file is deleted, then the state file.
    After a crash between the two, the state file matches no hits file and is
    ignored. After a crash before both, the findings review is still open and
    the user closes it again.
*   **The run record** is never deleted by a findings review ending. Nothing
    in the app shows it in this phase; it can be read from the project folder
    to answer "was this document searched, and with which rules?"

The hits file and the rejected list hold the text of found values. Nothing new
is exposed by that: each document's whole page text is already stored in the
same folder.

**Duplicating and importing a project** copy the whole `.redactorator/` folder,
so findings files stored under this build's reader tag are copied with it.

**A reader change** (decision D8, amended). `migrateToTag` copies a project
into the new reader folder. It runs when a project stored under an older tag
is opened, renamed, archived or duplicated, and on import when a project with
the same id is already there. It does not copy the hits, the state or the run
record: their positions are no longer valid. For each document whose older
folder holds a readable hits file, it writes a state file of kind `dropped`,
reason `reader-changed`. Nothing else happens then. When the user later opens
that document, the notice is shown (CUJ 12). No run ever starts by itself.

### 6. The profile and the packs

**A profile is two sets of choices** (author, 28 Nov 2026): countries and
industries. Either set may be empty, and both may be. Each choice adds one
pack to a run. One pack, `universal`, is in every run and is not a choice.

| Choice | Pack | Name the user sees | Holds |
| --- | --- | --- | --- |
| (every run) | `universal` | Used everywhere | Payment card, IBAN, email address, phone number, date of birth |
| a country | `us` | United States | The country's personal and account identifiers |
| a country | `uk` | United Kingdom | The same for the United Kingdom |
| a country | `in` | India | The same for India |
| a country | `ca` | Canada | The same for Canada |
| a country | `au` | Australia | The same for Australia |
| an industry | `finance` | Finance | Identifiers of businesses, securities and wallets |
| an industry | `legal` | Legal | Court case numbers and device and network identifiers |
| an industry | `medical` | Medical | Insurance, claim and prescription identifiers |

*   A country's pack holds every country-wide identifier whatever its
    evidence (brief A8). An industry never switches a country's pack off
    (brief S19, S32, S37).
*   **No default** (author, 28 Nov 2026). A new project has no profile.
    `detection.run` on a project without one is refused with `no-profile`,
    and the app answers by showing the chooser. The chooser starts with
    nothing selected. Under each choice it lists the names of the identifiers
    that choice adds. It may be submitted with nothing selected; the profile
    is then two empty sets and a run uses `universal` only. Its answer is
    stored with `profile.set` and the run starts.
*   **For one run only.** The chooser can also be opened from the Run control,
    filled in with the project's profile. Its answer is passed to
    `detection.run` and replaces the project's profile for that run.
*   **Setting the profile** changes the project record. It is not undone and
    does not put any document back in review. It is refused while another
    operation runs.
*   **Order of the packs,** used only to break a tie between two identifiers
    with equal evidence for the same span: `universal`, `us`, `uk`, `in`,
    `ca`, `au`, `finance`, `legal`, `medical`.
*   **Lists** are committed snapshots (bank codes, UPI handles, court
    case-type codes). Each records its source, its date and the terms it was
    published under. A list or a set of labels that is publicly readable is
    used even where its terms do not grant copying; the author settles
    licensing later, once the product has customers (28 Nov 2026). A list
    raises a hit to `checked`; a value missing from the list keeps its other
    evidence.
*   **Loading.** The compiled packs and lists are part of the worker's
    script. The worker uses the packs the `load` message names. Nothing is
    fetched because of a matched value, since that fetch would signal a
    finding.
*   **The pack build** runs in `pnpm test:tools`. It checks every pattern for
    slow shapes after the named pieces are expanded, and has a negative
    control: a known slow pattern must fail. The checker is `scslre`, chosen
    in slice C0; a pattern it cannot parse fails the build.
*   **Order of work.** The identifiers with a checksum first, then label
    rules, then formats that differ by state or province. Of the 65
    identifiers, 24 have a check digit or checksum, and this phase checks 23
    of them (the wallet address is the exception). The other 41 have none:
    most need a label, and a few have a distinctive format (email, URL, IP
    address, MAC address) or a list (IFSC, UPI ID).
*   **Names.** An identifier's id and name live in the dataset schema's type
    list (decision D3). Its pack is in `engine/model/identifiers.ts`.

### 7. What may run together

New refusals, added to `engine/core/session/gate.ts`. `busy-updating` and
`busy-approving` are existing codes; the others are new.

| When | Refused | Code |
| --- | --- | --- |
| A run is in progress in the project | A second run, on any document | `busy-detecting` |
| A run is in progress on a document | Approving that document | `busy-detecting` |
| A findings review is open on a document | On that document: `marks.add`, retype, remove and "Don't hide here"; `labelling.link`; undo and redo; `detection.run` | `findings-open` |
| No findings review is open on a document | Every `findings` command on it but `dismissNotice` | `no-findings` |
| A `findings` command names a finding, candidate or range that does not exist | That command | `unknown-finding` |
| The project has no profile and the run names none | `detection.run` | `no-profile` |
| The document's prepared files are not read yet, or documents are being prepared again | `detection.run` and every `findings` command | `busy-updating` |
| The document could not be prepared, or its original is missing | `detection.run` | the document's existing error code |
| An approval is being planned or its dialog is open | `detection.run`, `findings.confirm`, `findings.close`, `profile.set` | `busy-approving` |
| Findings are being confirmed (the operation `marking`) | Everything another operation refuses today, and `findings.confirm`, `findings.close` | `busy-marking` |

Other documents of the project stay fully usable during a run or a findings
review. `findings.setTicked`, `choose` and `setEdges` are allowed while an
approval is planned: they change the state file, not the project record, and
the number in the approval dialog counts findings whether ticked or not.
`findings.close` is refused then because it would change that number.

There is no gate row for a worker that cannot be started. The start fails
after the run has begun, so the run ends as failed (section 8), and the next
run starts a new worker.

### 8. Failures

| What goes wrong | What happens |
| --- | --- |
| A validator fails with an error on one value | That value counts as not having passed its check. The error is counted in the page's reply and in the run record. The run goes on |
| The worker cannot be started | The run ends as failed with `detector-not-started`. No page was searched, so no panel opens. A line beside the Run control gives the sentence for the code |
| The packs cannot be loaded | The same, with `recognizer-failed` |
| The worker fails during a page | The run ends early with `detector-failed`. The hits of the pages that answered are offered, and one line says which pages were not searched (CUJ 13) |
| A page never answers | The page counter does not move. The app sets no limit (G5). Stop ends the worker, and the run ends early in the same way |
| The stored text is missing when a run starts | The existing update that prepares the document again starts, and the run is refused with `busy-updating` |
| The Session closes during a run | The run is stopped and its hits are lost, as on a reload. The worker is ended |
| A stored findings file cannot be read | It is left alone and the document has no findings review (section 5) |

A run that ended as failed or early blocks nothing: the document can be
approved and a new run started.

### 9. Test fixtures and harness

The table that maps each goal to its test is in the Verification Plan.

*   **One generated PDF per pack,** with planted identifiers and planted
    near-misses, and a truth file. The generator is a Python script in
    `tests/oracle/`, beside the existing `make_fixtures.py`, whose PDF-writing
    helpers it reuses. Its values are synthetic.
*   **How the pack test matches** (G1, G2). The truth file lists each planted
    value with its text, its identifier id and its number of places, counted
    per key, and each near-miss with its text. The test sets the profile to
    the one choice that adds the pack, runs Auto mode, and reads the panel's
    rows, each of which exposes its text, identifier id and number of places.
    A planted value passes when a row has the same key, the same identifier id
    and the same number of places. A near-miss fails the test when a row whose
    identifier belongs to the pack under test has its key. Other rows are
    listed in the test's output. Each planted number is written in several
    ways: plain, with spaces, a hyphen, a dot, an en dash, a minus sign and a
    no-break space.
*   **Offset fixture.** A page with a character stored as two UTF-16 units
    and a ligature in front of an identifier; the outside checker judges the
    download against the fixture's known value (G17).
*   **Shapes for the writer.** Marks that overlap, marks that touch, marks
    that cross a line end, and hundreds on a page, each judged by the outside
    checker, the overlapping ones also with each mark's type printed in its
    box (G17, brief A12).
*   **Detection worker fakes.** Every existing fake in `tests/e2e/fakes.ts`
    is a typed function turned into a script, and each test fails if its fake
    did nothing. The detection fakes are written the same way, through one new
    helper that serves a given function in place of
    `assets/detectWorker-*.js`. Each spec passes its own function: one that
    never answers a page, one that fails, one that answers with a prepared
    list of hits. Nothing of them ships in the bundle.
*   **G18 is judged** with a prepared list of hits that carry model evidence
    and edges inside words: they appear as rows with their level and reason;
    one is accepted; and the outside checker confirms the download lost
    exactly that range.
*   **The reader-change test** needs no fake reader. With the project closed,
    a helper copies the stored folder `.redactorator/pdf-3/` to
    `.redactorator/pdf-2/` and removes `pdf-3/`. The build then finds the
    project under an older tag and copies it over, as after a real reader
    change.
*   **The network test** is extended to the detection worker's script (G16).
*   **Speed** (G4). A 100-page generated fixture with every pack loaded. The
    browser tests run on the instrumented build, which is slower, so the
    test's limit is the one slice C0 sets for that build.
*   **Coverage.** Counts are read from workers alive when a test ends
    (`tests/e2e/coverage.ts`). The detection worker is kept after a run, so
    its counts are read. A worker ended by Stop leaves none; the code it ran
    is counted by the other tests.

### 10. Decisions

Each had more than one defensible answer and was put to the author as its own
question, with options that were not ranked. The options not chosen are under
Alternatives Considered; each alternative's heading names its decision.

| Id | Question | Decision | Decided |
| --- | --- | --- | --- |
| D1 | Where an open findings review is stored | In the reader folder, per document: the run's hits, and the user's changes | 27 Nov 2026; two files since the first design review |
| D2 | How the new project fields are stored | Optional when read, with defaults from the parser. Version stays 3; no migration | 28 Nov 2026 |
| D3 | How a mark carries the identifier's name | The identifiers join the type list in `dataset/ground-truth.schema.json` | 27 Nov 2026 |
| D4 | The source format of a pack | YAML, compiled to committed JSON by a TypeScript tool | 27 Nov 2026 |
| D5 | Who enforces a time limit | Withdrawn. There is no time limit; the user stops a run | 28 Nov 2026 |
| D6 | What text a rule runs on | The page as written | 27 Nov 2026 |
| D7 | Where a rejected value is kept | A `rejected` list on the document. Only the resolver reads it | 27 Nov 2026; narrowed 28 Nov |
| D8 | Whether a run's hits are stored | Stored. A run happens only when the user starts one. A reader change drops the findings review and leaves a notice | 27 Nov 2026; amended 28 Nov |
| D9 | What a profile is, and its default | Sets of countries and industries, one pack per choice, one pack in every run. No default; an empty profile is valid | 28 Nov 2026 |
| D10 | Approving while a findings review is open | Separate acts. The approval dialog warns; the findings review stays open | 28 Nov 2026 |
| D11 | Marks that overlap | Allowed. Each found value is its own finding and gets its own marks. A found value is left out only where that same value is already marked | 28 Nov 2026. The author first chose two marks for one finding, then no overlap, then this, once the writer's fault with overlapping marks got its own fix |
| D12 | Ending a findings review | Confirm and Close each ask in a dialog | 28 Nov 2026 |
| D13 | Does undo restore rejected values | No. Undo covers marks only | 28 Nov 2026 |
| D14 | A value that lies inside a wider mark, when values are spread | Spreading marks a value wherever no mark of that same value sits, also inside another mark. Approval's own rule is unchanged | 28 Nov 2026. The author first chose to change approval |
| D15 | A value on the "Don't hide here" list | Offered ticked, like any other finding | 28 Nov 2026 |
| D16 | The record of what each run did | One small file per document, kept after confirm and Close | 28 Nov 2026 |
| D17 | A run that meets an error | An error in one check costs that value only. A worker failure ends the run early and keeps the pages searched | 28 Nov 2026 |

**What follows from D3**

*   The schema stays the one source of type ids and names. `builtInMarkTypes`
    already reads it, so marks, the panel, the type picker and ground-truth
    export all get the names with no second list.
*   The 14 general types stay in the list, for marks made by hand. Six of
    them already are one identifier each and are used for findings as they
    are: `email`, `phone`, `date-of-birth`, `payment-card`, `ip-address` and
    `url`. They appear once in the type picker, among the general types. The
    other 59 identifiers are new entries, grouped in the picker by pack.
*   Because the picker reads the schema, the 59 entries are added in the same
    slice that groups the picker (U1), not before.
*   A custom type whose name equals a built-in type's name, ignoring case, is
    refused. A typed name that is only part of a built-in name is added
    through a row "Add 'Case number' as a new type"; pressing Enter alone
    picks the highlighted match.
*   The schema's country list (`US`, `UK`, `CA`, `AU`, `NZ`, `IE`) gains `IN`.
*   When the user has chosen to print each mark's type in its box, the printed
    text is the specific name. The writer is unchanged; only the label text
    it is given differs.
*   A test fails if a pack names an identifier the schema does not list.

**What follows from D4**

*   The compiler is a TypeScript tool under `tools/packs/`. It has to be
    JavaScript, because it compiles every pattern with the same `RegExp` the
    app uses, so a pattern the browser would refuse fails the build.
*   The compiled JSON is not committed (author, 28 Nov 2026, in slice P0's
    review; first planned as committed and checked with `--check`).
    `pnpm build`, `pnpm dev`, `pnpm test` and `pnpm test:coverage` run
    `pnpm packs` first, so a rule that fails a check fails the build, and the
    pack fixtures are written the same way.
*   The compiler also checks each rule's fields, that its identifier is in
    the dataset schema, that its validator and list exist, and that its
    pattern is not a slow shape. It writes the index file that imports every
    compiled pack and list.
*   `yaml` becomes a development dependency. It is not shipped.

**What follows from D6**

*   The text view is one string per page: the characters in reading order,
    with line ends and block ends kept, and a map back to `chars`.
*   The fixture generator plants each number in several ways of writing it,
    so a rule that misses one fails its pack's browser test.
*   An identifier broken across a line end is not found: "one separator" does
    not include a line end, as the matcher's joiners do not join across
    lines. Slice C0 measured this and kept line ends out: allowing them joined
    about five pairs of separate numbers for each broken value they repaired
    (Risks and Mitigations).

**What follows from D14**

*   Today, spreading skips a place that any text mark already covers
    (`placeMark` in `engine/model/spread.ts`). A value that lies inside a
    wider mark, such as an SSN inside a marked `John Smith 123-45-6789`, then
    has no mark of its own in that document. When that document is approved,
    approval finds the value in its text without a mark of its own, concludes
    the user un-marked it, and stops hiding it in every document.
*   The change: spreading skips a place only where a mark of that same value
    already sits. The value gets its own mark inside the wider one, so
    approval sees it as marked and its rule needs no change.
*   This is a change to spreading from Phase 3. It does not touch the writer.
    It comes with a browser test in `tests/e2e/spreading.spec.ts` whose
    downloads the outside checker judges.
*   A document that got a wider mark before this change, and into which the
    value was never spread, can still show the old behaviour when it is
    approved. That concerns projects made before this phase only, and is
    accepted (Risks and Mitigations).

## Alternatives Considered

Each entry gives what the alternative offered, what it cost, and the reason it
was not chosen. A "D" number in a heading names the decision, in section 10
of the Technical Plan, that the alternative lost to.

### Engine and rules

#### 1. Vectorscan, or Rust `regex`, compiled to WebAssembly in this phase

*   **Pros**: One pass over the text however many rules are loaded. Linear
    time, so no pattern can run slowly.
*   **Cons**: No published WebAssembly build of Vectorscan exists, so the port
    would be ours. It has no capture groups and is weak at reporting where a
    match starts, which are the two things a redaction needs. Neither engine
    has lookaround.
*   **Reason for Rejection**: Rejected by author: JavaScript `RegExp` has
    groups and needs no download. An early trial in Node, without validators,
    scanned 300 synthetic rules over 100 pages in 65 ms; slice C0 repeats it
    in a Chrome worker with validators. Both engines stay possible behind the
    `RegexEngine` interface (brief S11).

#### 2. Running rules on the matcher's normalised text (D6)

*   **Pros**: Short rules (`\d{9}`). Every way of writing a number reads the
    same.
*   **Cons**: Grouping is lost as evidence: an SSN written 3-2-4 and any nine
    digits look the same. Two numbers separated by one space become one run of
    digits.
*   **Reason for Rejection**: Rejected by author: the way a number is grouped
    on the page is evidence a rule needs.

#### 3. Rules on the page as written, validators on a second, normalised view (D6)

*   **Pros**: Each job uses the view that suits it.
*   **Cons**: Two views of every page to keep consistent.
*   **Reason for Rejection**: Rejected by author: a validator can strip the
    separators of the one value it is given, so a second view of the page adds
    nothing.

#### 4. Packs as TypeScript modules (D4)

*   **Pros**: The typecheck catches a missing field or an unknown validator.
    No compiler to maintain.
*   **Cons**: Adding a rule is a code change.
*   **Reason for Rejection**: Rejected by author: rules should be readable and
    editable as data by someone who does not write TypeScript.

#### 5. Packs as JSON checked by a JSON schema (D4)

*   **Pros**: No compiler.
*   **Cons**: Every backslash in a pattern is doubled, which is where rule
    typos come from, and JSON has no comments for a rule's source.
*   **Reason for Rejection**: Rejected by author, for those two costs.

#### 6. A stdnum library at run time, and converters that import other tools' rules

*   **Pros**: Check-digit code for many countries, already written. Upstream
    fixes could be pulled by re-running a converter.
*   **Cons**: stdnum-js credits python-stdnum, which is LGPL, for many of its
    algorithms, so its licence needs checking. Each converter is a tool to
    maintain for a one-time import.
*   **Reason for Rejection**: Rejected by author, after the review of the
    brief: the phase needs about two dozen validators, few enough to write
    from the public specifications (brief A11).

#### 7. A country pack made only of identifiers with a checksum

*   **Pros**: The pack produces almost no false findings.
*   **Cons**: It leaves out 41 of the 65 identifiers, SSN among them.
*   **Reason for Rejection**: Rejected by author, after the review of the
    brief: a missed identifier costs more than an extra finding (brief A8).

#### 8. Verifying a code at an outside site or API

*   **Pros**: An IFSC or a bank code could be confirmed as live.
*   **Cons**: The request carries a finding out of the browser. A list of live
    codes would also reject the code of a closed branch on an old statement,
    which still has to be found.
*   **Reason for Rejection**: Rejected by author: it breaks the rule that no
    request carries findings.

#### 9. A time limit per page, kept by the engine core, with a slower retry that names the slow rule (D5 as first decided)

*   **Pros**: A slow pattern is stopped without the user doing anything, and
    the rest of the run continues.
*   **Cons**: A timer in the engine core, a way to start workers again, a
    second mode of the worker's messages, and a retry path. A built-in rule
    that hangs once is left out for the rest of the run.
*   **Reason for Rejection**: Rejected by author after the first design
    review: too much code for a case the pack build should prevent. The user
    sees the page counter and stops the run.

#### 10. A time limit kept by the host (D5)

*   **Pros**: The engine core stays without a timer.
*   **Cons**: Every host has to build the same watchdog.
*   **Reason for Rejection**: Rejected by author with alternative 9: there is
    no time limit.

#### 11. Six countries, with India after the MVP

*   **Pros**: It is the Implementation Plan as written.
*   **Cons**: The first customers are Indian back offices; New Zealand and
    Ireland have no rules in the chosen sources.
*   **Reason for Rejection**: Rejected by author, for the first customers
    (brief S5).

#### 12. Patterns a user writes, in this phase

*   **Pros**: A firm's own reference numbers could be found.
*   **Cons**: A user's pattern is untrusted: it needs its own worker, a check
    before saving, a cap on matches, and a way to stop it alone. The review
    found four of those undecided.
*   **Reason for Rejection**: Rejected by author after the first design
    review: a later addition, on its own design.

### Findings and marks

#### 13. An unapproved detection is redacted by default (the HLD's rule)

*   **Pros**: Nothing found is left in the file by oversight.
*   **Cons**: The file changes without the user's decision.
*   **Reason for Rejection**: Rejected by author:
    `docs/designs/composable-engine.md` overrides the HLD. A finding is a
    proposal (brief S1).

#### 14. General mark types for identifiers (D3)

*   **Pros**: SSN, ITIN and EIN are all "government id", so most name choices
    disappear and the type list stays at 14.
*   **Cons**: The user is not told what the value is.
*   **Reason for Rejection**: Rejected by author: a general name says no more
    than "an id" (brief S34).

#### 15. The identifier as a type id in a new namespace, mapped to the schema (D3)

*   **Pros**: No change to the dataset schema or the benchmark's files.
*   **Cons**: Two lists of types and a mapping to keep right; an older build
    shows the raw id as the name.
*   **Reason for Rejection**: Rejected by author: one list of type names.

#### 16. A general type on the mark plus a field for the identifier (D3)

*   **Pros**: Scoring against the 14 types needs no mapping.
*   **Cons**: A stored field on every mark, and every place that shows a type
    must prefer it. A general type still sits behind each specific name.
*   **Reason for Rejection**: Rejected by author, for the same reason as 15.

#### 17. The default of a merged finding is the candidate that removes the most

*   **Pros**: A merged finding never removes less than its parts would.
*   **Cons**: A mark is known by its text. A long capture around an SSN
    becomes the value, so the SSN is not found in other documents.
*   **Reason for Rejection**: Rejected by author: the value matters, not the
    words around it (brief S27).

#### 18. Keeping a value in some places of a document and removing it in others

*   **Pros**: A short value that means two things in one document could be
    handled place by place.
*   **Cons**: Approving a document marks every place of a marked value again,
    so the kept places would be marked anyway. Changing that changes spreading
    and the stored format.
*   **Reason for Rejection**: Rejected by author, for that cost (brief S36).

#### 19. Making marks each time a stage is confirmed

*   **Pros**: Accepted work is in the project record at once.
*   **Cons**: One undo could not reverse a whole findings review once a second
    stage exists.
*   **Reason for Rejection**: Rejected by author, to keep one undo (brief
    S35).

#### 20. Rejected values in the existing "Don't hide here" list (D7)

*   **Pros**: Already stored, already restored by undo, already respected by
    spreading.
*   **Cons**: That list means "hidden in the project, kept visible here". It
    would also hold values never hidden anywhere, and the marks panel has no
    row from which to reverse such an entry.
*   **Reason for Rejection**: Rejected by author: a rejection is about what
    Auto mode offers in one document, not about what the project hides.

#### 21. A rejected value that also stops spreading into its document (D7 as first decided)

*   **Pros**: A value the user chose to keep stays in that document even when
    another document's approval hides it elsewhere.
*   **Cons**: When a document is approved, every project value its text
    contains stops being hidden everywhere, unless the document marks the
    value or lists it under "Don't hide here". That rule does not read the new
    list, so approving the document with the rejection would remove the
    value's marks from every other document. One wrong untick would also keep
    a value in a document permanently.
*   **Reason for Rejection**: Rejected by author after the first design
    review: a rejection concerns one document's offers only. "Don't hide here"
    remains the way to keep a value visible.

#### 22. An accepted finding replaces a hand mark it contains (D11)

*   **Pros**: One mark per spot.
*   **Cons**: The shorter value loses its mark, so the next approval stops
    hiding it in the project's other documents.
*   **Reason for Rejection**: Rejected by author after the first design
    review, for that cost. A found value now gets its own mark beside the mark
    it overlaps (D11).

#### 23. A longer edge that fits only some places splits the finding in two (D11)

*   **Pros**: Each finding has exactly one text.
*   **Cons**: The wider text becomes the value where it fits, so the
    identifier inside it has no mark of its own there and stops spreading. The
    split also needs a notice and rules for the two halves.
*   **Reason for Rejection**: Rejected by author, who had first approved it.
    After the first design review it gave way to two marks (alternative 54).
    Now a lengthened finding stays one row: each place gets one mark, wider
    where the wider text is present (D11).

#### 24. Merging by which hit arrived before a stage opened

*   **Pros**: Model findings that arrive early could join a stage that has not
    opened yet.
*   **Cons**: The same document gives a different findings review on a fast
    and a slow machine, and browser tests become timing tests.
*   **Reason for Rejection**: Rejected by author, after the review of the
    brief, for those two costs (brief A6).

#### 25. Undo of a findings review also restores the rejected values (D13)

*   **Pros**: Undoing and running again offers everything afresh.
*   **Cons**: The list joins what undo snapshots, which changes the history
    and marks code and their tests.
*   **Reason for Rejection**: Rejected by author: undo covers marks only.

### What is stored

#### 26. Finding the hits again every time a project is opened (D8)

*   **Pros**: Nothing but the user's choices is stored, and a corrected rule
    reaches an open findings review at once.
*   **Cons**: Findings can differ between two visits, the time is paid on
    every open, and a model's findings cannot be made again cheaply.
*   **Reason for Rejection**: Rejected by author: a run the user did not start
    should not change what they are reviewing.

#### 27. Stored hits, with an automatic run when the packs or the reader change (D8)

*   **Pros**: Rule fixes reach open findings reviews without the user asking,
    and a reader change repairs itself.
*   **Cons**: A run the user did not start. After a reader change it also
    needed a stored note of which documents to run, and projects move to a new
    reader folder on rename, archive, duplicate and import, not only on open.
*   **Reason for Rejection**: Rejected by author. The run after a reader
    change was first accepted and then removed after the first design review:
    the user is told the reason and starts the run.

#### 28. Finding stored hits again by their text and boxes after a reader change (D8)

*   **Pros**: An open findings review survives an update, as marks do.
*   **Cons**: A second re-anchoring path, with "lost" hits to handle as lost
    marks are.
*   **Reason for Rejection**: Rejected by author, who chose it first and then
    reversed it: a second re-anchoring path costs more than a new run.

#### 29. Keeping the user's unticks and edits across a reader change (D8)

*   **Pros**: They are stored by value, not by position, so they could be
    applied to the findings of the new run.
*   **Cons**: A stored state "changes waiting for a run", and a new reader can
    read a value differently, so an untick could stop applying and nothing
    would tell the user.
*   **Reason for Rejection**: Rejected by author after the first design
    review: everything is dropped and the notice says so.

#### 30. The findings review inside `project.json` (D1)

*   **Pros**: One file, saved with every change, moved with the project.
*   **Cons**: With stored hits, each untick rewrites a file holding thousands
    of hits, and an approval plan compares the whole project record.
*   **Reason for Rejection**: Rejected by author, for the cost of each write.

#### 31. The findings review in a file outside the reader folder (D1)

*   **Pros**: Survives a reader change with no copy step.
*   **Cons**: Breaks the rule that each build writes only inside its own
    reader folder, and the positions inside are wrong after a reader change
    anyway.
*   **Reason for Rejection**: Rejected by author, for the broken rule.

#### 32. Required new project fields with no migration (D2 as first decided)

*   **Pros**: A project file always has every field.
*   **Cons**: Six existing tests open a project stored before Phase 3, which
    would read as "damaged". The current build cannot write that folder again,
    and those tests are the proof that marks survive a reader change.
*   **Reason for Rejection**: Rejected by author after the first design
    review.

#### 33. Version 4 of the project file with a migration (D2)

*   **Pros**: An older build refuses a newer project and so cannot drop its
    new fields.
*   **Cons**: A migration and a golden case for projects only the author has.
*   **Reason for Rejection**: Rejected by author: not worth it while the
    author is the only user. It is listed under Future Improvements.

#### 34. Storing every finding with a status, "accepted" included, after confirming

*   **Pros**: A later run can skip accepted findings by looking them up.
*   **Cons**: If the mark is undone or removed, the status still says
    "accepted", and the value is neither marked nor offered again.
*   **Reason for Rejection**: Rejected by author, after the review of the
    brief: the mark is the only record of an accepted value (brief S26).

### The findings review

#### 35. A smartness slider (Basic, Medium, High)

*   **Pros**: One control for how much Auto mode does.
*   **Cons**: It implies one scale, while patterns and models find different
    kinds of data.
*   **Reason for Rejection**: Rejected by author, for that false scale (brief
    S7).

#### 36. One list sorted by a single confidence number

*   **Pros**: One order for everything.
*   **Cons**: A pattern's evidence and a model's score are not on one scale.
*   **Reason for Rejection**: Rejected by author: each stage is sorted on its
    own scale.

#### 37. Several sections in one panel, dynamic stages, or a stage per evidence level

*   **Pros**: Checked values could be approved apart from doubtful ones.
*   **Cons**: Several sections in one panel are hard to read; dynamic stages
    need a waiting stage for late findings and rules for reopening.
*   **Reason for Rejection**: Rejected by author: two fixed stages (brief
    S30).

#### 38. Stages formed by the app alone

*   **Pros**: The findings review could change with no engine change.
*   **Cons**: What a stage holds decides what merges, what one undo covers and
    what the gate allows, and the engine design keeps project rules out of
    `app/`.
*   **Reason for Rejection**: Rejected by author, after the review of the
    brief, for those reasons.

#### 39. Sorting a stage weakest evidence first

*   **Pros**: Everything is ticked, so the user's job is to find what to
    untick, and the weakest findings are where that is.
*   **Cons**: The first screen is the least certain findings.
*   **Reason for Rejection**: Rejected by author for now; to be reversed if
    users ask (brief S38).

#### 40. Hand marking during a findings review, or turning a selection into a "user finding"

*   **Pros**: A user who notices a missed name can mark it at once.
*   **Cons**: While the findings panel takes the marks panel's place, a hand
    mark would be listed nowhere, and the page would need a rule for which
    gesture wins: selecting text, clicking a finding or dragging an edge. A
    user finding is a new kind of finding, with a variant that has no text for
    box marks.
*   **Reason for Rejection**: Rejected by author (brief S31). The user can
    confirm, then mark by hand, and loses nothing.

#### 41. Putting a findings review aside and keeping its unticks

*   **Pros**: A user who leaves to mark one name does not lose 30 unticks.
*   **Cons**: A third state between open and ended, with hand marks made in
    between to reconcile.
*   **Reason for Rejection**: Rejected by author, for the third state.

#### 42. Approval ends the findings review

*   **Pros**: An approved document never has a findings panel open.
*   **Cons**: Approval plans from a snapshot of the project and fails if the
    project changes before it is confirmed, so marks made by the findings
    review inside an approval break the approval. Joining the two also makes
    approval decide what happens to unticks and edits.
*   **Reason for Rejection**: Rejected by author after the first design
    review: approving a document and confirming findings are two acts (D10).

#### 43. Deferring edge editing to the NER phase

*   **Pros**: Pattern findings have exact edges, so the feature would wait for
    the findings that need it.
*   **Cons**: A wrong edge could only be fixed by unticking and marking by
    hand.
*   **Reason for Rejection**: Rejected by author, for that cost (brief S33).

#### 44. A notice of what Auto mode did not search for

*   **Pros**: A user who confirms is told that names and addresses were not
    searched.
*   **Cons**: One more thing on the panel in every findings review.
*   **Reason for Rejection**: Rejected by author for this phase (brief S29).

#### 45. A warning or a refusal on Preview and Download during a findings review

*   **Pros**: A file is not downloaded with found values still in it.
*   **Cons**: Preview stops being a plain view of the current marks.
*   **Reason for Rejection**: Rejected by author. One sentence in the panel
    says that found values are removed only once confirmed.

#### 46. A profile that can switch off a country's pack, or no country choice at all (D9)

*   **Pros**: Switching off cuts findings further. No choice at all means a
    wrong country can never lose identifiers.
*   **Cons**: The first loses identifiers in mixed files. The second runs
    every country's label rules on every file.
*   **Reason for Rejection**: Rejected by author: the country is a choice, a
    run can use several, and an industry never switches a country off (brief
    S19, S32, S37).

#### 47. A default profile: the United States and finance, or all five countries (D9)

*   **Pros**: The first run needs no question.
*   **Cons**: With the United States alone, a UK or Indian file finds none of
    its own identifiers and nothing says so. With all five, every file gets
    the label rules of four other countries.
*   **Reason for Rejection**: Rejected by author after the first design
    review: no default; the first run asks.

#### 48. A pack for each pair of country and industry (D9)

*   **Pros**: A United States medical rule would run only when both the United
    States and medical are chosen.
*   **Cons**: Up to fifteen packs, most of them empty, and a rule for which
    pairs exist.
*   **Reason for Rejection**: Not chosen: the author defined a profile as
    choices that each add one set of patterns. The cost is that the medical
    and court rules, which have United States formats today, run for any
    country (Risks).

#### 49. Search and mark, built on a term-list recognizer, in this phase

*   **Pros**: A name Auto mode cannot find could be marked everywhere in one
    step, and a second kind of recognizer would exercise the frame.
*   **Cons**: The term-list recognizer has no terms during a run, and it would
    match the page as written while spreading matches through `keyOf`, so the
    two would find different places.
*   **Reason for Rejection**: Rejected by author after the first design
    review: search and mark is a later addition, and the recognizer goes with
    it.

### Scope and process

#### 50. A timed session with an outside user as a condition for closing the phase

*   **Pros**: The only measure of review time taken from a person.
*   **Cons**: It needs an outside person before the phase can close.
*   **Reason for Rejection**: Rejected by author, for that dependency. The
    count of review actions on generated files stays (G20).

#### 51. A design document for the frame and the findings review only, with packs to follow

*   **Pros**: The file list would rest on settled facts, and the document
    would be shorter.
*   **Cons**: The rule format would be fixed before it had met all 65
    identifiers.
*   **Reason for Rejection**: Rejected by author, for that risk.

#### 52. Leaving the command-line detector to the benchmark work

*   **Pros**: One slice less. Nothing uses the tool in this phase.
*   **Cons**: Nothing would show that detection runs without a browser, and a
    rule change could only be tried through the app.
*   **Reason for Rejection**: Rejected by author after the first design review
    proposed it. The author has since taken the tool out of this phase for the
    opposite reason: a detector that reads stored text files is too little.
    What is wanted is the whole engine run from the command line, which is
    its own piece of work after this phase (Future Improvements).

#### 53. A first slice that creates every shared file as a stub

*   **Pros**: No two later slices would edit the same file.
*   **Cons**: About 45 files fixed before the rule format was proven; stubs
    that imported files not yet created; and the rule still broke for three
    READMEs and the findings panel.
*   **Reason for Rejection**: Rejected by author after the first design
    review. The first slice fixes the contracts; a file is created by the
    first slice that needs it; list files are merged by hand.

### After the second design review

#### 54. Two marks for one finding: the identifier's own and a wider one (D11 as first decided)

*   **Pros**: The identifier keeps a mark of its own in every place, so it
    spreads to other documents even where the user chose to remove more.
*   **Cons**: When the user has chosen to print each mark's type in its box,
    the writer's own check requires the text under each box to be that box's
    label and nothing else. A box inside a box puts two labels under the wider
    one, the check fails, and Preview and Download are refused for the
    document. Fixing that means changing what the writer is given.
*   **Reason for Rejection**: Rejected by author after the second design
    review, when overlap was given up. Overlap is allowed again since, but as
    two findings with a mark each, not two marks of one finding (D11).

#### 55. Joining overlapping marks into one before the writer sees them (D11)

*   **Pros**: Overlapping marks could exist, and the writer would still
    receive ranges that do not overlap.
*   **Cons**: It changes what the write path is given, so it needs a new leak
    fixture judged by the outside checker, and a rule for which label a joined
    range prints.
*   **Reason for Rejection**: Rejected by author with alternative 54. The
    writer's fault is fixed instead in how it draws and checks the labels,
    outside this phase.

#### 56. Offering a found value that overlaps an existing mark, locked and unticked (D11)

*   **Pros**: The user sees exactly which values were held back.
*   **Cons**: Rows that cannot be ticked are one more kind of row to build and
    test.
*   **Reason for Rejection**: Rejected by author. Such values were first left
    out; they are now offered like any other (D11).

#### 57. Leaving approval as it is and recording the risk (D14)

*   **Pros**: No change to approval code that works today.
*   **Cons**: Approving a document that marks a combined value can remove
    another document's marks for a value inside it, without saying so.
*   **Reason for Rejection**: Rejected by author: it leaves a value in another
    file. Spreading is changed instead (D14).

#### 58. Removing "Remove more" and outward edge moves (D14)

*   **Pros**: Auto mode would never mark wider than what a rule found.
*   **Cons**: Rules that find a combined value, such as a sort code with an
    account number, and hand marks would still cover a shorter value.
*   **Reason for Rejection**: Rejected by author: it reduces the case without
    removing it. "Remove more" has since gone for another reason: values that
    overlap are separate findings (D11).

#### 59. Not offering a value on the "Don't hide here" list, or offering it unticked (D15)

*   **Pros**: An earlier choice to keep a value in a document is not reversed
    by confirming a long list.
*   **Cons**: A value the user forgot they had kept is never offered, or a
    second kind of row is needed.
*   **Reason for Rejection**: Rejected by author: reversing an earlier
    decision is the user's choice.

#### 60. Dropping the record of what each run did (D16)

*   **Pros**: One stored file and one format fewer. Nothing in the app shows
    the record yet.
*   **Cons**: After confirming, nothing says which rules searched a document.
*   **Reason for Rejection**: Rejected by author: one small file per document
    is kept.

#### 61. A failed run opens no panel (D17 as first written)

*   **Pros**: A run that did not finish is never shown as if it had.
*   **Cons**: An error on one page discards the findings of every page, on
    every run of that document.
*   **Reason for Rejection**: Rejected by author after the second design
    review: an error must not cost the other findings.

#### 62. A "Skip this page" control that restarts the worker (D17)

*   **Pros**: The pages after a slow page would still be searched.
*   **Cons**: One more command and gate row, and a worker restart in the
    middle of a run.
*   **Reason for Rejection**: Not chosen: an error is caught inside the worker
    and costs one value, and a slow page is the user's to stop. The pages
    after it stay unsearched (Risks).

#### 63. A key made per identifier, from the validator's own form of the value

*   **Pros**: A National Insurance number written `QQ 12 34 56 C` and
    `QQ123456C` would be one finding.
*   **Cons**: Marks and the project's hidden values are keyed by `keyOf`
    today. A second kind of key would have to replace it everywhere or live
    beside it.
*   **Reason for Rejection**: Not chosen: hand marks split the same way today,
    and changing how every mark is keyed is outside this phase.

#### 64. Carrying rejected values forward into later runs, unticked

*   **Pros**: A value unticked by mistake could be ticked on any later run.
*   **Cons**: It reverses "a rejected value is not offered again" (G13), and
    every later panel grows by the rejected rows.
*   **Reason for Rejection**: Not chosen: the confirm dialog already says that
    the unticked values stay in the file.

#### 65. Running the packs that were not chosen and reporting only their counts

*   **Pros**: A user who left India out would be told that six values in
    Indian formats were seen.
*   **Cons**: Every run takes the time of every pack, and counts from label
    rules of countries nobody chose are mostly noise.
*   **Reason for Rejection**: Not chosen: it works against the profile's
    purpose. It is listed under Future Improvements.

#### 66. Leaving no notice after a reader change (D8)

*   **Pros**: No stored notice, no dismiss command, less to test.
*   **Cons**: A half-done findings review would vanish with nothing said.
*   **Reason for Rejection**: Rejected by author: the user is given the reason
    and offered a run.

#### 67. Confirm and Close without a dialog (D12)

*   **Pros**: One press fewer at each end of a findings review.
*   **Cons**: Close would drop every untick and edit, and leave every found
    value in the file, with nothing said. That was the design before the first
    design review.
*   **Reason for Rejection**: Rejected by author: both ask in a dialog that
    states the counts.

### After the author allowed marks to overlap

#### 68. No overlapping marks: one mark per place, and a found value that a mark overlaps is not offered (D11 as decided after the second design review)

*   **Pros**: Nothing overlaps, so the writer's check never meets a box inside
    a box.
*   **Cons**: A value partly under a hand mark is not offered, and the rest of
    it stays in the file. Where a wider text is marked, the identifier inside
    it has no mark of its own. Rules are needed for which span wins at each
    place.
*   **Reason for Rejection**: Rejected by author the same day. The writer's
    fault with overlapping marks is fixed on its own, and marks can then
    simply overlap, each staying a mark of its own.

#### 69. One finding with "Remove more" and "Remove less" where hits overlap (D11)

*   **Pros**: Fewer rows in the panel.
*   **Cons**: One row can carry only one name for the place, and the choice of
    span has to be worked out again at every place of the value.
*   **Reason for Rejection**: Rejected by author: values that overlap are two
    findings, and the user unticks the one they do not want.

#### 70. Leaving out a found value that any mark covers whole (D11)

*   **Pros**: After the user marks a wide text by hand, Auto mode offers
    nothing inside it.
*   **Cons**: The value inside has no mark of its own, so it is not spread to
    other documents under its own name.
*   **Reason for Rejection**: Rejected by author: a found value is left out
    only where that same value is already marked.

#### 71. Approval counts a value inside a wider mark as marked (D14 as first decided)

*   **Pros**: It also covers a document that was marked before this phase. No
    overlapping marks are made by spreading.
*   **Cons**: The document's marks panel does not show the value. Auto mode
    would make overlapping marks and spreading would not.
*   **Reason for Rejection**: Rejected by author: spreading follows the same
    rule as Auto mode. The case this covered concerns older projects only,
    which is accepted while the product is at MVP stage.

#### 72. Remembering a shortened value so that later runs leave it out, or offer it unticked (D11)

*   **Pros**: A value shortened on purpose is not marked whole by a later
    run that the user confirms without reading every row.
*   **Cons**: Either the rejected list also holds values the user only
    narrowed, or one more list is stored and one more kind of row is built.
*   **Reason for Rejection**: Rejected by author: the whole value is offered
    again, ticked, and reversing the earlier choice is the user's call, as it
    is for a "Don't hide here" value (D15).

### After slice C0

#### 73. Writing a rule only once its format is verified at the body that issues it (G2 as first written)

*   **Pros**: Every rule rests on the authority for its identifier.
*   **Cons**: Many official sites refuse automated reading, and several
    issuers do not publish their check method. Slice C0 could verify 20 of the
    65 identifiers that way, which would leave out Aadhaar, GSTIN and every
    passport rule.
*   **Reason for Rejection**: Rejected by author. It was the drafter's
    wording, not a decision. The rules build on the existing public pattern
    and validator resources, with the source recorded (G2).

#### 74. Pairing a label with its value by row, worked out from character boxes

*   **Pros**: In a table drawn column by column it paired all eight labels
    with their values in slice C0's trial, where distance in reading order
    paired none.
*   **Cons**: It is a hand-built rule about page layout, the first of several
    the same problem would ask for: columns, wrapped values, one character
    to a box.
*   **Reason for Rejection**: Rejected by author for this phase: reading
    layout is a harder problem, to be researched later with models.

## Risks and Mitigations

Each line gives the risk and either what reduces it or that its cost is
accepted. A missed value is the worst error, so those come first.

| Risk | What reduces it, or the accepted cost |
| --- | --- |
| A rule misses a way of writing an identifier | Every fixture plants each number written in seven ways; the pack test fails on a miss (G1). Rules and keys share one set of separators |
| An identifier broken across a line end is not found | Measured in slice C0: 21% of the identifiers in a narrow statement column, and every value written one character to a box. Accepted for this phase by the author; reading layout is a research area for later |
| A value whose label sits in another block is missed: a table drawn column by column, or a column header | Measured in slice C0: no label was found for any value of such a table. Accepted for this phase by the author (Non-Goals) |
| The user leaves a country or industry out of the profile, and its identifiers are not searched | A new project has no profile; the first run asks, and the chooser lists what each choice adds. A wrong choice still misses: accepted |
| Found values stay in the file because the user closed the panel, approved with the panel open, or downloaded during a findings review | Close and the approval dialog state the number of found values that stay. The panel says that found values are removed only once confirmed. Accepted by the author |
| A pattern runs for minutes on one page | The pack build fails on slow shapes, with a negative control. The run shows its page; Stop keeps the findings of earlier pages and says which pages were not searched. Those pages stay unsearched until the rule is fixed: accepted |
| A check function fails with an error on a value that is in fact valid | The value is not offered. The error is counted in the run record, and a pack's browser test would catch a rule that fails on its own examples. Accepted |
| The user unticks a value by mistake and confirms | It is not offered again in that document. The user marks it by hand. A view of rejected values is a future improvement |
| Confirming marks a value the user had chosen "Don't hide here" for | It is the user's choice to reverse it (D15). Accepted by the author |
| A later run offers, whole and ticked, a value the user had shortened; confirming without noticing removes what they kept | It is the user's choice to reverse it. Accepted by the author |
| Where the user lengthened a finding's edge, the value as found has no mark of its own in the places that got the wider mark | It is still marked where the wider text is absent. If every place is wider, the value as found is not spread from this document: accepted |
| A combined value and its parts are separate rows, so the panel is longer, and a user who unticks one row may not see that another row still removes the same text | Rows are sorted by evidence and then by first place, so rows that overlap usually sit together. Accepted by the author |
| A document marked before this phase holds a wider mark with an unmarked value inside it; approving it stops hiding that value in other documents | A project made after this phase cannot reach that state (D14). Accepted while the product is at MVP stage |
| One value written two ways, in letters and digits, is two findings | Each is ticked by default, so both are removed unless the user unticks one. Hand marks split the same way today: accepted |
| A reader change, or a replaced original file, drops an open findings review with its unticks and edits | A stored notice tells the user why and offers a run. Accepted by the author |
| An older build opens a project and saves it | Its parser keeps only the fields it knows, so the profile and the rejected values are dropped and nothing tells the user. Accepted while the author is the only user (D2) |
| The four medical rules and the court case rule have United States formats, yet run for any country when their industry is chosen | A few extra findings on a non-US file, all needing a label. Accepted until those packs gain other countries' rules |
| An identifier has no source for its format | The rule is left out and listed under "C0 results and rules left out" |
| A shipped list or set of labels was copied from a source whose terms do not grant copying | Each list records its source and its terms, so it can be licensed or replaced later. Accepted by the author until the product has customers |
| The type list grows from 14 names to 73 | The picker groups them and filters as the user types (slice U1). The benchmark work must accept the longer list |
| The undo of a findings review is lost on reload, on approval, and when another document's approval spreads marks in | It is how every undo step works today. Stated in CUJ 6 |

**A change this phase waits for.** Overlapping marks fail the writer's own
check today when the user has chosen to print each mark's type in its box, and
Preview and Download are then refused for that document. Nothing leaks, since
the writer refuses. The fix is in how the writer draws and checks those
labels. It is separate work with its own pull request, and it must be merged
before slice R1, the first slice that makes overlapping marks.

## Non-Functional Requirements

*   **Privacy.** No request carries document bytes, text or findings. Packs
    and lists are part of the build. The Content Security Policy already
    limits workers and connections to the app's own origin, and it applies to
    the new worker. The hits file and the rejected list hold the text of found
    values, beside page text that is already stored; the run record holds no
    values.
*   **Speed.** G4. Reopening a project with an open findings review runs the
    resolver only, never a run.
*   **Accessibility.** WCAG 2.2 at level AA is kept. The findings panel, the
    chooser and the three dialogs work from the keyboard and with a screen
    reader.
*   **Rollout and rollback.** D2: the new project fields are optional when
    read, so every existing project opens. An older build that opens and
    saves a project drops the fields it does not know.

## Additional Resources

*   `docs/designs/composable-engine.md`: section 5 describes the Session;
    section 11 is the sketch of findings this design builds on.
*   `docs/designs/pdf-leak-suite.md`: the reader folders, the writer and the
    outside checker.
*   `docs/Implementation-Plan.md` (Phase 4) and `docs/HLD.md` (the high-level
    design): the author's live documents. This design differs from them on
    countries, bands, export blocking, pack delivery, user-written patterns
    and search and mark; the differences go to the author as proposed changes
    and are not edited here.

The author's working files are not part of the repository and are not needed
to read this document: the brainstorm's brief, the workbook the 65 identifiers
were chosen from, and the reports of the two design reviews.

--------------------------------------------------------------------------------

## Appendix: how this design came to differ

### Differences from the brief

The brief was written before the code was read for this design. The author
decided each of these while the design was drafted or after a design review.

| The brief | This design | Decision |
| --- | --- | --- |
| Pending findings are not stored; they are found again on open | A run's hits are stored; reopening runs nothing | D8 |
| A findings review survives restarts, reloads and return visits | It is dropped after a reader change, with a notice | D8 |
| A rejection goes in the existing "Don't hide here" list | A `rejected` list that only the resolver reads | D7 |
| One timed session with an outside user is a goal | It is a non-goal | |
| A country core, plus industry add-ons for that country | One pack per choice, country or industry | D9 |
| A profile has a default | No default; the first run asks | D9 |
| Custom patterns and search and mark are in the phase | Both are later additions | |
| Every regular expression runs under a time limit | No time limit; the user stops a run | D5 |
| Approving through the warning ends the findings review | Approval leaves the findings review open | D10 |
| Overlapping hits merge into one finding with alternatives | They are separate findings, and their marks overlap | D11 |
| Every slice is vertical and starts with a browser test | C1, W1 and E1 come before any screen and are checked by unit tests | |

### Changes after the design reviews

Both design reviews found the design not ready to build. Each row says what
the review found and what the design now says.

**After the first design review**

| Found | Now |
| --- | --- |
| Required new project fields made six existing tests read old storage as damaged | The fields are optional when read (D2) |
| A rejected value that also stopped spreading could remove another document's marks | A rejected value only stops Auto mode offering it again (D7) |
| Ending a findings review could leave found values in the file with nothing said | Confirm and Close each ask in a dialog; approval is a separate act (D10, D12) |
| The contracts slice did not leave the build passing | It fixes contracts only and lists every file it touches |
| The detection worker would build under the PDF worker's file name | `engine/detect/detectWorker.ts` |
| The pack tests could not choose a profile | The profile slice comes first; each pack test sets its own profile |
| A run started by itself after a reader change, and could not be tested | No run starts by itself; a stored notice offers one |
| No risks section | Risks and Mitigations |
| Time limits with a slower retry | No time limit (D5) |
| What a profile is was unclear, and its default missed other countries | Two sets of choices, no default (D9) |
| Custom patterns, search and mark and labels in column headers were under-specified | All three are out of this phase |

**After the second design review**

| Found | Now |
| --- | --- |
| A hit carried no text, so findings could not be keyed and stale hits could not be told | A hit carries its text; stored hits are tested against the page |
| Two marks for one finding failed the writer's check with labels on | The writer's fault is fixed on its own, outside this phase. Marks may overlap, and values that overlap are separate findings (D11) |
| A wider mark could make approval stop hiding the value inside it | Spreading gives the value its own mark inside the wider one (D14) |
| A lost mark could turn a confirmed finding into a leak | The new marks take the place of lost marks with the same letters |
| The reader-change notice was deleted by the cleanup rule | The notice is its own kind of state file; the state file is tied to its run |
| An error on one page discarded every finding | An error costs one value; a worker failure ends the run early (D17) |
| Nothing said where the resolver runs, or what closing a project does to a run | Section 3, "Where the resolver runs"; the worker belongs to the Session |
| The first slices could not pass the tests or the audit | The schema change moves to the picker's slice; a stated exemption covers code not yet used or reached by a browser test |
| Several slices left out files they must edit, and the tools' build was not written down | The file lists and the build config are in the Detailed Implementation Plan |

### Future Improvements

*   **The engine from the command line** (author, 28 Nov 2026). One command
    takes PDFs and a profile and does the whole path through the same engine
    the app uses: makes a project, runs Auto mode, accepts every finding,
    approves, and writes the cleaned files. It is a tool for the author and
    the build sessions, not a product. It needs a Node host for the engine:
    both workers as Node threads, MuPDF included, a lock, and a store over
    ordinary folders. `docs/designs/composable-engine.md` left that host for
    when a consumer exists. It gets a short design of its own and is built
    after this phase. An earlier draft of this design had a smaller tool in
    its place, slice T1, which ran only the detection step on a stored text
    file.
*   **Model recognizers:** a new recognizer, the second stage with its state
    and storage, and one undo covering both stages.
*   **Patterns a user writes,** on their own design.
*   **Search and mark.**
*   **Reading layout with a model:** labels paired by row and by column,
    values wrapped across lines, and values written one character to a box.
*   **Pseudonymisation where marks overlap:** replace the union of their text
    and keep each mark as it is.
*   **A notice of what Auto mode did not search for,** which could include
    counts from the packs that were not chosen.
*   **A view of a document's rejected values,** so the user can reverse one.
*   **A screen for the run record.**
*   **Keeping a value in single places of a document.**
*   **The UK modulus check** and **the checksum inside a wallet address.**
*   **A second regular-expression engine,** if a measurement shows it is
    needed.
*   **A migration and a version step for the project file,** before anyone
    but the author has projects.
*   **Medical and legal rules for countries other than the United States.**

--------------------------------------------------------------------------------

## Detailed Implementation Plan

### 1. The slice graph

Slices are built in separate worktrees. An arrow points from a slice to the
slices that wait for it. Slices with no path between them can be built at the
same time.

```text
C0 spikes and checks
 |
 v
C1 contracts
 |
 +--> M1 spreading marks a covered value
 +--> U1 type picker in groups --> F1 profile chooser --+
 +--> W1 detection worker, first rule ------------------+
 +--> E1 run, hits and resolver ------------------------+
                                                        |
      V1 findings panel, Run, Stop  <-------------------+   first end-to-end test
       |
       +--> R1 confirm, marks, rejected values, undo, Close, approval warning --+
       +--> W2 runs that fail or end early -------------------------------------+
       |                                                                        |
       |    R2 stored findings review, later runs, reader change  <-------------+
       |     |
       |     +--> R3 candidates and edges
       |
       +--> P0 rule format, pack compiler, fixture generator
             +--> PU United States and medical
             +--> PK United Kingdom
             +--> PI India
             +--> PC Canada
             +--> PA Australia
             +--> PX universal, finance and legal

Z1 closing checks: waits for every slice above
```

| Id | Slice | Waits for |
| --- | --- | --- |
| C0 | Spikes and checks | none |
| C1 | Contracts | C0 |
| M1 | Spreading marks a covered value | C1 |
| U1 | Type picker in groups | C1 |
| F1 | Profile chooser | U1 |
| W1 | Detection worker and first rule | C1 |
| E1 | Run, hits and resolver in the Session | C1 |
| V1 | Findings panel, Run and Stop | F1, W1, E1 |
| R1 | Confirm, marks, rejected values, undo, Close, approval warning | V1 |
| W2 | Runs that fail or end early | V1 |
| R2 | Stored findings review, later runs, reader change | R1, W2 |
| R3 | Candidates and edges | R2 |
| P0 | Rule format, pack compiler, fixture generator | V1 |
| PU, PK, PI, PC, PA, PX | Packs | P0 |
| Z1 | Closing checks | all |

Slices R1 and R3 make overlapping marks. They also wait for the fix that lets
the writer take overlapping marks with each mark's type printed in its box
(Risks and Mitigations), which is not a slice of this phase.

After C1, the slices M1, U1, W1 and E1 run at once. After V1, the slices R1,
W2 and P0 run at once. After P0, the six pack slices run beside R2 and R3.
There are 20 slices.

**How slices stay out of each other's way**

*   **Create** means the file is new. **Fill** means an earlier slice created
    the file as a placeholder, and this slice writes its real body. **Modify**
    means the file exists, in the repository today or from a slice this one
    waits for.
*   The placeholders are: in C1, the two new Session slices, the three effect
    modules and the detection client; in W1, the two hand-written pack files
    that P0's compiler replaces; in P0, the empty pack sources, list files and
    validator files that the pack slices fill.
*   Where one file appears in two slices, one waits for the other. The
    exceptions are files that are lists by nature, which several slices append
    to and which are merged by hand: `package.json` (scripts),
    `.fallowrc.json`, `app/errors.ts`, `tests/e2e/auto.ts` (page helpers),
    every `README.md`, and the section "C0 results and rules left out" of this
    document.
*   The index of compiled packs and lists is written by the pack compiler. A
    merge conflict in a compiled file is resolved by running `pnpm packs`
    again.
*   Each slice updates the README of every folder it changes that has one
    today, and a new source folder gets a README from the slice that creates
    it. The tables list a README only where its content is worth naming.
    Folders of fixtures and of compiled output get none.
*   A path in a table is from the repository root. A second path in the same
    cell that starts without a folder is in the folder of the first.

**Tests.** Browser tests come first (AGENTS.md). Slices C1, W1 and E1 come
before any screen exists, so they add or extend unit tests, each with its
reason; these are the exception the author accepted with the audit exemption
below. Every other slice that changes the app starts with its own browser
test. No test is added in a skipped or expected-to-fail state.

**The audit exemption** (author, 28 Nov 2026). `pnpm exec fallow audit` fails
a change that adds a file or an export nothing uses, and it scores each
function against the coverage of the browser tests. A hook blocks a commit on
that verdict. The slices before V1 add code that nothing uses yet and that no
browser test reaches, on purpose. So:

*   `.fallowrc.json` gains a block, marked with a comment naming this
    section: an `overrides` entry that sets the rules `unused-files`,
    `unused-exports` and `complexity-crap` to `warn` for the listed files.
*   C1, W1 and E1 each add their own files to that block. The files are named
    in each slice's table.
*   V1 removes the block. From V1 on every file is imported by the app and
    reached by `auto-run.spec.ts`.
*   The pack compiler's entry is different: nothing imports it, ever,
    because it is run from the command line. P0 lists it under
    `supportEntry`, to stay.
*   Slice C0 found these keys by running the audit on stub files (C0's
    results, item 6).

### 2. Decisions fixed here so that no slice has to make them

*   **Names in code.** `findings` and `detection` for the engine's new parts.
    The list of rejected values is `rejected`. The test files
    `auto-review.spec.ts` and `review-cost.spec.ts` keep the plain word.
*   **Phone numbers** are written as rules per country inside the `universal`
    pack, without a phone-number library.
*   **One run at a time in a project.**
*   **The format names** of the stored files: `redactorator-findings-hits`,
    `redactorator-findings-state` and `redactorator-run-record`, each at
    version 1.
*   **A run's id** is a UUID made when the run starts.
*   **The page counter** is part of the Run control's own text and does not
    have the status role, so the tests that expect one status element keep
    working.
*   **Pack order** for ties: `universal`, `us`, `uk`, `in`, `ca`, `au`,
    `finance`, `legal`, `medical`, then the order of rules in the pack's
    source.

#### The identifiers

This is the list U1 adds to the type list of
`dataset/ground-truth.schema.json`, and C1 writes into
`engine/model/identifiers.ts`. "Existing" marks the six ids already in the
schema; the other 59 are new. The name is what the user sees on a mark and in
the type picker.

| Pack | Id | Name shown |
| --- | --- | --- |
| `universal` | `payment-card` (existing) | Payment card |
| `universal` | `iban` | IBAN |
| `universal` | `email` (existing) | Email |
| `universal` | `phone` (existing) | Phone |
| `universal` | `date-of-birth` (existing) | Date of birth |
| `us` | `us-ssn` | SSN |
| `us` | `us-itin` | ITIN |
| `us` | `us-ein` | EIN |
| `us` | `us-ptin` | PTIN |
| `us` | `us-routing-number` | Bank routing number (US) |
| `us` | `us-bank-account` | Bank account number (US) |
| `us` | `us-passport` | Passport number (US) |
| `us` | `us-drivers-license` | Driver's license (US) |
| `us` | `us-npi` | NPI |
| `us` | `us-dea-number` | DEA number |
| `us` | `us-mbi` | Medicare Beneficiary Identifier |
| `uk` | `uk-nino` | National Insurance number |
| `uk` | `uk-nhs-number` | NHS number |
| `uk` | `uk-utr` | UTR |
| `uk` | `uk-vat-number` | VAT number (UK) |
| `uk` | `uk-driving-licence` | Driving licence (UK) |
| `uk` | `uk-passport` | Passport number (UK) |
| `uk` | `uk-sort-code-account` | Sort code and account number |
| `uk` | `uk-vehicle-registration` | Vehicle registration (UK) |
| `in` | `in-aadhaar` | Aadhaar |
| `in` | `in-aadhaar-vid` | Aadhaar Virtual ID |
| `in` | `in-pan` | PAN |
| `in` | `in-gstin` | GSTIN |
| `in` | `in-voter-id` | Voter ID (EPIC) |
| `in` | `in-passport` | Passport number (India) |
| `in` | `in-driving-licence` | Driving licence (India) |
| `in` | `in-vehicle-registration` | Vehicle registration (India) |
| `in` | `in-bank-account` | Bank account number (India) |
| `in` | `in-ifsc` | IFSC |
| `in` | `in-upi-id` | UPI ID |
| `in` | `in-tan` | TAN |
| `in` | `in-uan` | UAN |
| `in` | `in-abha-number` | ABHA number |
| `ca` | `ca-sin` | SIN |
| `ca` | `ca-business-number` | Business Number (Canada) |
| `ca` | `ca-bc-phn` | BC Personal Health Number |
| `ca` | `ca-bank-account` | Bank account number (Canada) |
| `ca` | `ca-passport` | Passport number (Canada) |
| `ca` | `ca-drivers-licence` | Driver's licence (Canada) |
| `au` | `au-tfn` | TFN |
| `au` | `au-abn` | ABN |
| `au` | `au-acn` | ACN |
| `au` | `au-medicare-number` | Medicare number (Australia) |
| `au` | `au-bank-account` | Bank account number with BSB |
| `au` | `au-passport` | Passport number (Australia) |
| `au` | `au-drivers-licence` | Driver's licence (Australia) |
| `finance` | `bic` | BIC |
| `finance` | `lei` | LEI |
| `finance` | `isin` | ISIN |
| `finance` | `cusip` | CUSIP |
| `finance` | `crypto-wallet-address` | Crypto wallet address |
| `legal` | `us-court-case-number` | Court case number (US) |
| `legal` | `ip-address` (existing) | IP address |
| `legal` | `url` (existing) | URL |
| `legal` | `mac-address` | MAC address |
| `legal` | `imei` | IMEI |
| `medical` | `us-provider-tax-id` | Provider tax ID (US) |
| `medical` | `health-insurance-member-id` | Health insurance member ID |
| `medical` | `insurance-claim-number` | Insurance claim number |
| `medical` | `prescription-number` | Prescription number |

The 23 identifiers this phase checks with a validator are: payment card,
IBAN; US bank routing number, NPI, DEA number; NHS number, UTR, UK VAT number,
UK driving licence; Aadhaar, Aadhaar Virtual ID, GSTIN; SIN, Business Number,
BC Personal Health Number; TFN, ABN, ACN, Australian Medicare number; LEI,
ISIN, CUSIP, IMEI. If slice C0 confirms that the ABHA number has a check
digit, slice PI adds its validator. `validators/medical.ts` stays empty in
this phase.

#### The source format of a rule

Slice P0 builds the compiler for this format. The rule's fields in the
compiled JSON are those of the Technical Plan, section 3.

```yaml
pack: in
rules:
  - id: in-ifsc
    identifier: in-ifsc
    pattern: '(([A-Z]{4})0[A-Z0-9]{6})'
    value: 1                      # which group is the value
    needs: checked                # checked | labelled | format
    labels: ["IFSC", "IFSC Code"]
    labelSide: before             # before | after | either
    distance: 40
    notNextTo: letter-or-digit    # letter | digit | letter-or-digit
    validator: null
    list: { name: in-bank-codes, group: 2 }   # the group looked up in the list
    companion: null               # or { rule: in-ifsc, distance: 200 }
    yieldsTo: []
    source: "https://..."
    licence: "public specification"
    verified: { date: 2026-12-01, at: "https://..." }
    examples: ["HDFC0001234"]
    nearMisses: ["HDFC1001234"]
```

Slice P0 made this format final; `tools/packs/README.md` gives every field,
the forms an example and a near-miss can take, and what each check's failure
means. P0 changed two things: a list is looked up by a group of the pattern
(`group`), not by a slice of the value, so that a handle after an `@` or a
top-level domain can be looked up too; and a rule may name a python-stdnum
module in `stdnum`, which only the fixture generator reads.

*   **Named pieces.** A pattern may use `{sep}` for one separator and `{sep?}`
    for one optional separator. The compiler expands both from the matcher's
    joiner class. No other piece exists in this phase.
*   **How a label matches.** A label is compared with the page text after
    both pass through `normalise`, so case and spacing do not matter. It must
    lie on the stated side of the value, within `distance` characters of the
    text view, and in the same block. There is no rule for "same row" or "same
    column" in this phase (Non-Goals).
*   **Examples** live in the YAML and are not written to the compiled JSON.
    The fixture generator reads the YAML.
*   **The version** of a pack is the first 12 hex digits of the SHA-256 of
    its compiled JSON, computed with `node:crypto`.

#### Wording

The exact text of what the user reads. `{n}`, `{m}`, `{a}`, `{b}` and
`{name}` are filled in.

| Where | Text | Slice |
| --- | --- | --- |
| Run control | "Run Auto mode"; while running: "Searching page {a} of {b}" and "Stop" | V1 |
| Run control menu | "For this run only" | V1 |
| Chooser, title | "What should Auto mode look for?" | F1 |
| Chooser, under each choice | "Adds: {names}" | F1 |
| Panel, instruction line | "Found values are removed only once you confirm." | V1 |
| Row reasons | `checksum`: "passed its check". `list`: "is a known {name}". `label`: "next to the label {name}". `companion`: "near a {name}". `format`: "has the format of a {name}". `model`: "found by a model" | V1 |
| Confirm button | "Mark {n} values for removal"; with nothing ticked: "Keep all {n} values in the file" | R1 |
| Confirm dialog | "Mark {n} values for removal? {m} unticked values stay in the file and will not be offered again in this document." | R1 |
| Close dialog | "Close without marking? {n} found values stay in the file. Your unticks and edits will not be kept." | R1 |
| Undo dialog | "Remove the {m} marks Auto mode made for {n} values?" | R1 |
| Approval dialog, added line | "{n} found values are not marked and stay in the file." | R1 |
| Nothing new | "Auto mode found nothing new in this document." | V1 |
| Stopped | "Stopped. Pages {a} to {b} were not searched." | V1 |
| Ended early | "The run ended early because of an error. Pages {a} to {b} were not searched." | W2 |
| `detector-not-started` | "Auto mode could not start. Try again." | C1 |
| `recognizer-failed` | "Auto mode could not load its rules. Try again." | C1 |
| `detector-failed` | "Auto mode stopped because of an error." | C1 |
| Wider span | "Wider in {a} of {b} places." | R3 |
| Identifier picker | "Other possible types ({n})" | R3 |
| Notice, `reader-changed` | "The found values of this document were dropped, because an update changed how the app reads PDFs. Your unticks and edits were not kept. Run Auto mode to find them again." | R2 |
| Notice, `text-changed` | "The found values of this document were dropped, because its text changed. Run Auto mode to find them again." | R2 |
| Type picker | "Add '{name}' as a new type" | U1 |

The other new error codes are refusals the app never shows, and join that
group in `engine/api/errors.ts`.

#### The tools' build

The pack compiler imports engine sources, whose imports carry no file
extensions, so Node cannot load it as it is. No runner is added. Vite builds
it into one file for Node. This config was tried on 28 Nov 2026 with a tool
that imports `engine/model/match.ts`; it wrote the file, and the file ran
under Node 24.

```ts
// tools/vite.config.ts
import { defineConfig } from "vite";
export default defineConfig({
  build: {
    ssr: true,
    outDir: "tools/.build",
    emptyOutDir: true,
    target: "node24",
    rolldownOptions: {
      input: { compile: "tools/packs/compile.ts" },
      output: { entryFileNames: "[name].mjs" },
    },
  },
});
```

`tools/tsconfig.json` is `{ "extends": "../tsconfig.json", "compilerOptions":
{ "types": ["node"] }, "include": ["."], "exclude": [".build"] }`. It extends
the root config, as `tests/` does, and not `engine/tsconfig.base.json`, which
declares `crypto` and `TextDecoder` itself and would clash with Node's types.

| Script in `package.json` | Command | Slice |
| --- | --- | --- |
| `build:tools` | `vite build -c tools/vite.config.ts` | P0 |
| `packs` | `pnpm build:tools && node tools/.build/compile.mjs && uv run --project tests/oracle python tests/oracle/make_pack_fixtures.py` | P0 |
| `typecheck` | gains `tsc -p engine/detect-protocol && tsc -p engine/detect && tsc -p engine/detect/tsconfig.worker.json` | W1 |
| `typecheck` | gains `tsc -p tools` | P0 |
| `build`, `dev`, `test`, `test:coverage` | each start with `pnpm packs`; the compiled packs and the pack fixtures are not committed | P0 |
| `report:review-cost` | `playwright test --grep @report` | Z1 |

The fixture generator fails when a positive example fails python-stdnum's
check or a near-miss passes it. The generator's own tests run
with the existing `uv run --project tests/oracle python -m pytest tests/oracle
-q`. The golden files are recorded with `GOLDEN_UPDATE=1 pnpm exec playwright
test golden`.

#### C0 results and rules left out

Slice C0 wrote this part on 28 Nov 2026, and amended it the same day with
the author's decisions on its results. Each pack slice adds the rules it
leaves out, with the reason, to the table "Rules left out" at the end.

C0 adds no code. Its spike scripts stayed outside the repository, so each
result says how it was made, and the repository's own commands are given in
full. Every test value and document was synthetic. Times were taken on one
Apple M3 Pro laptop in Chrome 158.0.8127.37, through Playwright.

**What these results change in the design.** In short:

*   `labelRow` is not built in this phase, by the author's decision, so the
    `page` message carries no boxes. A label in a table drawn column by
    column is not found. See item 2.
*   A rule may rest on an existing public resource as well as on the issuer:
    a published standard, Microsoft Purview's documentation, Presidio,
    python-stdnum, stdnum-js, validator.js or the like (author, 28 Nov
    2026). With that, 64 of the 65 identifiers have a source for their
    format; the Indian bank account number has none and is a label rule.
    22 of the 23 validators have a source for what they check: 21 check
    digits, and the UK driving licence's date fields. The DEA number's
    check method has none. See item 7.
*   A line end is not made a separator. Identifiers broken across a line end
    are common in narrow table columns and in boxed form fields; the author
    has made reading them a research area for later. See item 4.
*   The UPI handle list and the Purview keyword lists may be used, with
    their source and terms recorded. See item 8.
*   The audit exemption needs `overrides` with `unused-files` and
    `unused-exports`; `ignoreExports` covers only a new export in an
    existing file. The tool entries fit `supportEntry` better than `entry`.
    See item 6.
*   The speed test's limit is 30 seconds. Approval needs no extra slice.

##### 1. Speed

**What was measured.** One trial rule for each of the 23 identifiers with a
validator, each with its check function, plus a label search within 40
characters before the value. The rules ran in a Web Worker made from a blob
on a blank page. The main thread sent one page at a time, as an array of
characters with boxes, and waited for that page's hits, as the design's flow
does. The text was 100 synthetic statement-like pages of 60 lines each,
414,855 characters in all, with dates, amounts, reference numbers and
planted identifiers. Each case ran five times; the median is given.

The instrumented case used the same script after `istanbul-lib-instrument`,
with the options `vite.config.ts` uses when `COVERAGE=1`: `esModules: true`,
`coverageGlobalScope: "globalThis"`, `coverageGlobalScopeFunc: false`.

| Rules | As written: median (min to max) | Instrumented: median (min to max) |
| --- | --- | --- |
| 23 | 232 ms (191 to 440) | 202 ms (199 to 230) |
| 92 (the 23, four times) | 316 ms (314 to 319) | 337 ms (327 to 372) |
| 299 (the 23, 13 times) | 678 ms (672 to 720) | 703 ms (697 to 708) |

The 299-rule row stands in for every pack loaded, with room to spare.
Instrumenting added at most 7%, probably because the regular expressions
run inside the engine, where the counters are not.

"As written" is the trial script, not the app's production bundle, which
does not exist yet. The goal G4, 60 seconds on the production build, is met
by about 80 times.

**Decision.** The speed test `auto-speed.spec.ts` on the instrumented build
fails over **30 seconds**. That is half the goal, so a pass on the slower
build leaves room on the production build, and it is more than 40 times the
measured time, so a slow machine does not fail it.

**How to repeat.** Write the trial rules as JavaScript, start a classic
worker from a blob URL on `about:blank` in Playwright with `channel:
"chrome"`, and time from the `load` message to the last page's `hits`. A
module worker from a blob did not start on `about:blank` in this setup; a
classic one did.

##### 2. Labels

**What was read.** The app's own reader: each file was added to a project in
the production build, and its stored page text was read from
`<project>/.redactorator/pdf-3/text/<document id>.json`. That is what a rule
will see. The files were `fixtures/form.pdf`, `fixtures/table.pdf`, and four
generated one-page tables with eight label-and-value pairs each, all in the
same row:

*   **a**: two columns drawn row by row (label, then its value);
*   **b**: the same table drawn column by column (every label, then every
    value);
*   **c**: four columns, two pairs to a row, drawn row by row;
*   **d**: "Label: value" as one line.

**Distance** is counted in characters of the stored text, from the end of
the label to the start of its value.

| File | Distance | Same block | Same row by boxes |
| --- | --- | --- | --- |
| `form.pdf` ("Client name:" and its value) | 1 | yes | yes |
| `table.pdf` (3 pairs) | 1 | yes | yes |
| a (8 pairs) | 1 | yes | yes |
| b (8 pairs) | 70 to 91 | no | yes, all 8 |
| c (8 pairs) | 1 | yes | yes |
| d (8 pairs) | 2 | yes | yes |

In table b the reader puts each label and each value in a block of its own,
and gives all eight labels before all eight values. "Within N characters,
same block" finds no label for any value. Without the block condition, the
nearest label before every value is the last label, "Date of birth", so a
larger distance finds the wrong label. "Same row" from the boxes (the label's
and the value's boxes overlap in height by at least half the smaller one, and
the label ends left of the value) pairs all eight correctly.

In table c a value is followed, one character later, by the next pair's
label. A rule that accepts a label after the value would take the wrong one,
so `labelSide: before` should be the usual choice.

**Decision.** `labelRow` is not built in this phase, by the author's
decision (28 Nov 2026): "a harder problem than to solve in this session".
The `page` message carries no boxes. A rule uses a label within N
characters, in the same block, before the value. A table drawn row by row
needs only that; 40 characters, the distance in the rule format's example,
covers every pair measured.

What this misses, from the table above: in a table drawn column by column
(table b), no label is found for any of its eight values. A rule that needs
a label finds nothing there, and a rule with a checksum or a distinctive
format finds the value without its label's support.

**Column headers.** Not measured and not solved, as the brief asked. Table b
shows what a header row is likely to meet: the reader gives whole columns in
blocks, so a header is far from its values in reading order.

**How to repeat.** Make the tables as `tests/oracle/make_fixtures.py` makes
PDFs, add each file in the app, and read the stored text file; its
`boxes` hold four numbers for each character that has a box.

##### 3. Slow-pattern checkers

The author agreed on 28 Nov 2026 to install these four packages into a
scratch folder, never into `package.json`. All four are MIT-licensed.

| Package | Version | Size unpacked, with its dependencies |
| --- | --- | --- |
| `safe-regex2` | 5.1.2 | 13 KB, plus `ret` 69 KB |
| `scslre` | 0.3.0 | 29 KB, plus `@eslint-community/regexpp`, `refa` and `regexp-ast-analysis`: about 1.9 MB |
| `redos-detector` | 6.1.4 | 815 KB, plus `regjsparser` 74 KB |
| `recheck` | 4.6.2 | 11.6 MB, plus a native binary (`recheck-macos-arm64`, 30 MB) or a Java build (`recheck-jar`, 24 MB) |

Each judged four known slow patterns, one safe control, and the 23 trial
patterns of item 1.

| Pattern | `safe-regex2` | `scslre` | `redos-detector` | `recheck` |
| --- | --- | --- | --- | --- |
| `(a+)+$` | slow | slow | cannot judge | slow |
| `(\d+)*x` | slow | slow | cannot judge | slow |
| `(a\|aa)+$` | safe (wrong) | slow | cannot judge | slow |
| `\s*\d+\s*\d+\s*$` (polynomial) | safe (wrong) | slow | cannot judge | slow |
| `\d{3}-\d{2}-\d{4}` | safe | safe | safe | safe |
| The 23 trial patterns | 5 called slow (wrong) | all safe | 6 cannot judge | all safe |

`safe-regex2` judges by how deeply repeats nest, so it misses an
alternation that repeats, and calls five plain patterns slow (card, IBAN,
VAT, Business Number, Medicare). `redos-detector` stopped at its default
score limit on every slow pattern. With the limit raised ten times it still
could not judge `(a+)+$` or the card pattern; at a hundred times it ran out
of memory. `recheck` was right on every pattern, but needs a native binary
or Java, and its first call took about a second; its pure-JavaScript mode
gave no answer within two minutes. `scslre` was right on every pattern,
answered in 2 ms or less, is plain JavaScript, and analyses a pattern
without running it.

**Decision.** The pack compiler uses **`scslre`** (MIT). A pattern it cannot
judge fails the build: for `scslre` that is a pattern it cannot parse, which
it reports by throwing.

##### 4. Line ends

**What was measured.** Two generated three-page statements, each row being
a date, an amount, a balance and a details column that wraps at its width,
with an identifier planted in each row's details, and a generated flattened
form. All were read with the app's reader, as in item 2.

| Document | Identifiers planted | Broken by a line end |
| --- | --- | --- |
| Statement, details column 150 points wide | 86 | 18 (21%): 10 IBANs, 4 cards, 3 Aadhaar numbers, 1 ABN |
| Statement, details column 230 points wide | 117 | 1 (1%): 1 IBAN |

The generator wraps text at spaces, as most do, so every break fell at a
space inside a grouped value. No value without spaces broke.

The form shows a different cause. A value written one character to a box (a
comb field) is read one character to a line: each digit of the SSN, the
Aadhaar number and the account number became a line of its own. A value
written one group to a box (sort code `20 | 45 | 77`) is read one group to
a line. A value drawn as two text runs with a small gap
stayed on one line.

**What allowing a line end would cost.** The trial rules were run again with
the line end added to "one separator". In the statements, the reader puts a
row's date, amount and balance on separate lines of one block, so they join.

| Document | Joins of one value across a line end | Joins of two values | Of those, passing their check |
| --- | --- | --- | --- |
| Statement, 150 points | 22 | 101 | 8 |
| Statement, 230 points | 1 | 118 | 9 |
| Form | 1 (the boxed NHS number) | 0 | 0 |

In the narrow statement it would make about five wrong joins for each right
one, and in the wide one 118 for one. About 8% of the wrong joins pass their
check and would be shown as `checked`. It would not help comb fields, whose
digits have line ends and no separators between them.

**Decision.** "One separator" does **not** include a line end. The design is
unchanged. The risk in Risks, "an identifier broken across a line end is not
found", is common in narrow columns and certain in comb fields. The author
has decided that reading such values is a research area for later, with
models that read layout: "In this phase lets do what can be done easily or
in a vanilla way." This phase reads the page text as the reader gives it.

##### 5. Approval

**What was measured.** A generated 10-page document with 5,000 distinct
8-digit numbers. Its project file was given one text mark for each number,
and the app was reloaded. The time runs from clicking Approve to the
"Approved" badge, then to "Saved". Three runs each, in the production build.

| Case | Click to dialog or Approved | Dialog's Approve to Approved | Then to Saved | Total |
| --- | --- | --- | --- | --- |
| One document, 5,000 marks | 1.40 to 1.41 s | no dialog | 0.29 s | about 1.7 s |
| Two documents; the approval spreads 5,000 marks into the second | 1.94 to 2.04 s | 0.61 to 0.63 s | 0.40 to 0.42 s | 2.95 to 3.09 s |

**Decision.** Under 5 seconds, so no slice to speed approval up is added.

The first try spread nothing, and showed a fact about the matcher. The
numbers were separated by single spaces, and `findAll` reads digits joined
by spaces on one line as one number. So a line of numbers with only spaces
between them has no word boundary inside it, and no value in it spreads. The
same holds for a marked account number followed by a space and an amount on
one line. The runs above used commas between the numbers. This is how the
matcher works today. Whether it should change is a question for the author;
it is not part of Phase 4.

##### 6. The audit exemption

**What was run.** `pnpm test:coverage` first (263 tests passed), because
`pnpm exec fallow audit` needs `coverage/coverage-final.json`. Then three
temporary stub files, since removed: an exported function in a file nothing
imports, an exported function of cyclomatic complexity 10 that no browser
test reaches, and a tool under `tools/` that imports the second. The
settings were tried one at a time and then together, each time with `pnpm
exec fallow audit` and `pnpm exec fallow architecture --boundaries`.
`.fallowrc.json` was then restored; its SHA-1 is unchanged.

What failed with no exemption: all three files as "unused files", the tool
as "no matching boundary zone", and the complex function's CRAP score (110
against the limit 30; its cyclomatic 10 and cognitive 9 were under their
limits). By fallow's CRAP formula an untested function of cyclomatic
complexity 5 scores 30, the limit, and so fails too.

| Setting | Result |
| --- | --- |
| A `tools` zone and its rule | Boundary check passes. A rule that names a zone not yet defined (`detect` before W1 adds it) fails both commands with "invalid boundary configuration" |
| `entry` or `supportEntry` with `tools/**/*.ts` | The tool and what it imports count as used. Both pass |
| `ignoreExports` with `"exports": ["*"]` for a new file | No effect: the file is still unused |
| `ignoreExports` naming one new export in a file that is imported | Passes. This is the case `ignoreExports` is for |
| `overrides`, `unused-files` set to `warn` or `off` | Passes. With `warn` the file is still listed and the verdict is a warning; the commit hook blocks only a failing verdict |
| `overrides`, `unused-exports` set to `warn`, for a new file that is imported but has an unused export | Passes; without it that export fails |
| `overrides`, `complexity-crap` set to `warn` or `off` | Passes |
| `ignoreFindings`, or `health.ignore`, or `health.thresholdOverrides` | Each also passes, but hides more or reads less clearly |
| A `//` comment in `.fallowrc.json` | Accepted |

**Decision.** The smallest block, for C1, W1 and E1 to add their files to:

```jsonc
// Phase 4 audit exemption: docs/designs/auto-mode.md, Detailed
// Implementation Plan, section 1. V1 removes this entry.
"overrides": [
  {
    "files": ["engine/model/findings.ts"],
    "rules": {
      "unused-files": "warn",
      "unused-exports": "warn",
      "complexity-crap": "warn"
    }
  }
]
```

The file named is an example. `unused-exports` is needed for a listed file
that another file imports while some of its exports stay unused: a second
try, with a new file imported by `engine/model/pageText.ts`, failed without
it and passed with it. A new export added to an existing file needs an
`ignoreExports` entry naming that export instead. P0 adds for the tools, to
stay:

```jsonc
"supportEntry": ["engine/globals.ts", "tools/**/*.ts"],
// in boundaries.zones:
{ "name": "tools", "patterns": ["tools/**/*.ts"] },
// in boundaries.rules:
{ "from": "tools", "allow": ["model", "detect-protocol", "detect", "core"] }
```

`supportEntry` is the key the schema gives for tooling that does not run in
production; `entry` also works. This differs from the design's guess of
`ignoreExports` and `entry`.

##### 7. Facts

**What counts as a source.** The author decided on 28 Nov 2026: "We
piggybacking on existing regex pattern resources and validator resources to
build our own." A rule may be written when its format, and for a checked
rule its check method, is stated by an existing public resource: the
issuer's page, a published standard, Microsoft Purview's documentation,
Presidio, python-stdnum, stdnum-js, validator.js or the like. A third-party
page counts too, named as what it is. A fact recalled with no source is not
enough. The earlier wording, "verified at the body that issues it", is
withdrawn.

Every page below was read on 28 Nov 2026. Many official sites refuse
automated reading; most of those were also tried in a normal browser. Some
could not be read even so: `cms.gov` refused every page, `aba.com` showed a
check for robots, which was not got round, and `gov.bc.ca` did not answer. A
page not read no longer blocks a rule that has another source.

**Read at the issuer or its standard.** The facts the workbook marks
unverified: what the issuer or its standard states, where it could be read.
"Not read at the issuer" means only that; the table after this one gives
the source each rule rests on.

| Fact | Result | Source |
| --- | --- | --- |
| SSN: area not 000, 666 or 900 to 999; group not 00; serial not 0000 | Verified. The page says "900 series" | https://secure.ssa.gov/poms.nsf/lnx/0110201035 |
| EIN: format and valid prefixes | Prefixes verified (a table by campus). The written form 12-3456789 is not stated there | https://www.irs.gov/businesses/small-businesses-self-employed/how-eins-are-assigned-and-valid-ein-prefixes |
| PTIN: "P" and 8 digits | Verified, IRM 2.3.63.2 | https://www.irs.gov/irm/part2/irm_02-003-063 |
| ABA routing number: weights 3, 7, 1 | Not read at the issuer. Only third-party sources; the registrar's site blocked reading | https://www.aba.com/about-us/routing-number |
| NPI: Luhn with the prefix 80840 | Not read at the issuer. The final rule states 10 positions with a check digit in the tenth, but not the method; the CMS check-digit paper could not be read | https://www.govinfo.gov/content/pkg/FR-2004-01-23/html/04-1149.htm |
| Medicare Beneficiary Identifier format | Not read at the issuer. `cms.gov` refused every page | https://www.cms.gov/medicare/new-medicare-card |
| US court case and docket numbers | Not read at the issuer. The US Courts page read states no format | https://www.uscourts.gov/court-records/find-a-case-pacer |
| NHS number: modulus 11 | Verified, with weights 10 to 2; 11 gives 0, 10 means invalid | https://www.datadictionary.nhs.uk/attributes/nhs_number.html |
| UTR: is the first digit a check digit? | Not read at the issuer. HMRC says 10 digits, and its design pattern says 10 or 13. No HMRC page names a check digit | https://www.gov.uk/find-utr-number and https://design.tax.service.gov.uk/hmrc-design-patterns/unique-taxpayer-reference |
| UK VAT number: modulus 97 | Not read at the issuer. HMRC states nine digits and names "modulus 97", but withholds the formula | https://www.gov.uk/hmrc-internal-manuals/enquiry-manual/em3058 and https://www.gov.uk/hmrc-internal-manuals/vat-agricultural-flat-rate-scheme/vatafrs2500 |
| Sort code and account number format | Verified: six-digit sorting code, eight-digit account number, in Vocalink's specification, version 9.20 of 4 Nov 2026 | https://www.vocalink.com/media/h3rou4er/validating-account-numbers-uk-modulus-checking-v920.pdf |
| Aadhaar and Aadhaar Virtual ID: Verhoeff | Not read at the issuer. The UIDAI pages read do not state it, and the UIDAI pages that search results name for it return "not found" | https://uidai.gov.in/en/aadhaar-online-services |
| PAN format and holder-type letter | Verified: 5 letters, 4 digits, 1 letter; the fourth letter is one of A, B, C, F, G, H, J, L, P, T; the last letter is a check letter whose method is not published | https://www.incometaxindia.gov.in/w/how-pan-is-formed-and-how-it-gets-its-unique-identity- |
| GSTIN: check character by modulus 36 | Not read at the issuer. Only third-party sources | none found |
| Indian passport number format | Not read at the issuer. The page tried returns "not found" | https://www.passportindia.gov.in/AppOnlineProject/online/faqServicesAvailable |
| Indian bank account number lengths | Not read at the issuer. RBI states no length | https://www.rbi.org.in/Scripts/FAQView.aspx?Id=60 |
| IFSC format | Verified: four letters for the bank, a 0, six characters for the branch | https://www.rbi.org.in/Scripts/FAQView.aspx?Id=60 |
| UPI ID format | Not read at the issuer. NPCI's pages list handles but do not state the form of an ID | https://www.npci.org.in/product/upi/all-members |
| TAN format | Verified: 4 letters, 5 digits, 1 letter; the first three letters are a jurisdiction code | https://www.incometaxindia.gov.in/w/tax-deduction-account-number |
| UAN format | Not read at the issuer. The EPFO portal does not state the length | https://unifiedportal-mem.epfindia.gov.in/memberinterface/ |
| ABHA number: format and check digit | Not read at the issuer. No ABDM page read states either. Third-party summaries of ABDM papers call it a random 14-digit number, with no check digit mentioned | https://abdm.gov.in/abha-number |
| Voter ID (EPIC): format and check digit | Not read at the issuer. The Election Commission's sites gave no text | https://eci.gov.in/ |
| Business Number: Luhn | Verified. CRA's worksheet applies the SIN formula to the first nine digits of a BN; the program account form is 9 digits, 2 letters, 4 digits | an archived CRA paper, https://bac-lac.wayback.archive-it.org/web/20061210041004/http:/www.cra-arc.gc.ca/eservices/magmedia/sin-e.pdf, and https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/business-registration/business-number-program-account/need-program-accounts.html |
| BC Personal Health Number: check | Not read at the issuer. The province's specifications exist, but `gov.bc.ca` dropped every connection | https://www2.gov.bc.ca/assets/gov/health/practitioner-pro/software-development-guidelines/conformance-standards/vol-4c-app-rules-pnet.pdf |
| ABN: modulus 89 | Verified, weights and steps as the workbook has them | https://abr.business.gov.au/Help/AbnFormat |
| ACN: check | Not read at the issuer. ASIC states nine digits; the page named "digit check" gives no method | https://asic.gov.au/for-business/registering-a-company/steps-to-register-a-company/australian-company-numbers/australian-company-number-digit-check |
| IBAN: modulus 97 | Verified: ISO 7064 MOD 97-10, first four characters moved to the end, remainder 1. Read in the 1997 edition's preview pages; SWIFT publishes the national formats | https://cdn.standards.iteh.ai/samples/21228/8c19005e318742e7ba49cd4fe544257c/ISO-13616-1997.pdf and https://www.swift.com/standards/data-standards/iban-international-bank-account-number |
| BIC format | Verified: 4 characters, ISO 3166 country code, 2 characters, optional 3-character branch | https://www.swift.com/standards/data-standards/bic-business-identifier-code |
| IMEI: Luhn | Verified: 8-digit TAC, 6-digit serial, a Luhn check digit (Annex B) | https://www.etsi.org/deliver/etsi_ts/123000_123099/123003/19.08.00_60/ts_123003v190800p.pdf |
| Crypto wallet address formats | Verified from the published specifications: Bech32 and Bech32m (BIP-173, BIP-350), Base58Check, and Ethereum's EIP-55. No body issues these | https://github.com/bitcoin/bips/blob/master/bip-0173.mediawiki, https://github.com/bitcoin/bips/blob/master/bip-0350.mediawiki, https://eips.ethereum.org/EIPS/eip-55 |
| LEI: modulus 97 | Verified: characters 19 and 20 are check digits by ISO 7064 MOD 97-10; valid when the remainder is 1 | https://cdn.standards.iteh.ai/samples/59771/b4526b6c9dc04897b014c659ed70ad27/ISO-17442-2012.pdf |
| ISIN check | Verified: country code, 9 characters, check digit by the modulus 10 "Double-Add-Double" formula | https://anna-web.org/identifiers/ |
| CUSIP check | Not read at the issuer. CUSIP Global Services states 9 characters with a check character, but not the method | https://www.cusip.com/identifiers.html |

The CRA worksheet is an archived copy, kept by Library and Archives Canada,
of a 2006 CRA paper. It is the government's own text, but not a current
page.

**The source each of the 65 rests on.** "Issuer" and "standard" are the
rows of the table above. Library sources are named by project: python-stdnum
(LGPL 2.1 or later; its documentation at
https://arthurdejong.org/python-stdnum/doc/ and its source at
https://github.com/arthurdejong/python-stdnum), Presidio (MIT;
https://presidio.dataprivacystack.org/supported_entities/ and its
recognizers in https://github.com/data-privacy-stack/presidio, under
`presidio-analyzer/presidio_analyzer/predefined_recognizers/country_specific/`),
stdnum-js (MIT; https://github.com/koblas/stdnum-js), validator.js (MIT;
https://github.com/validatorjs/validator.js), and Microsoft Purview's
definitions (https://learn.microsoft.com/en-us/purview/, page names below).
A check method marked "source" was read in that project's code, not only in
its documentation. The rules are written here from these statements; no
library becomes a runtime dependency, as the Non-Goals require.

| Identifier | Format and check, as the source states them | Source it rests on |
| --- | --- | --- |
| `payment-card` | 14 to 19 digits, Luhn | Purview `sit-defn-credit-card-number`; the Luhn steps also in the IMEI standard (ETSI TS 123 003, Annex B) |
| `iban` | Country code, 2 check digits, up to 30 characters; MOD 97-10 | Standard: ISO 13616 (1997 preview); SWIFT's registry for each country's length |
| `email` | Address form, RFC 822 validation | Presidio `EMAIL_ADDRESS`; validator.js `isEmail` |
| `phone` | Per country | Presidio `PHONE_NUMBER`; validator.js `isMobilePhone` (en-US, en-GB, en-IN, en-CA, en-AU) |
| `date-of-birth` | A date | Presidio `DATE_TIME`; validator.js `isDate`. No issuing body |
| `us-ssn` | Area not 000, 666 or 900s; group not 00; serial not 0000 | Issuer: SSA POMS RM 10201.035 |
| `us-itin` | Starts with 9; fourth and fifth digits 50 to 65, 70 to 88, 90 to 92, 94 to 99 | Issuer: IRS Publication 4757 (revised June 2026). Presidio's "7 or 8 as the fourth digit" disagrees; the issuer wins |
| `us-ein` | Two digits, optional hyphen, seven digits; prefix from the IRS list | Issuer for the prefixes; python-stdnum `us.ein` source for the form |
| `us-ptin` | P and 8 digits | Issuer: IRM 2.3.63.2 |
| `us-routing-number` | 9 digits; weights 3, 7, 1, sum divisible by 10 | Presidio `aba_routing_recognizer.py` source; python-stdnum `us.rtn` source (the same check, as weights 7, 3, 9); Purview `sit-defn-aba-routing` |
| `us-bank-account` | 6 to 17 digits (Purview), 8 to 17 (Presidio); no check | Purview `sit-defn-us-bank-account-number`; Presidio `US_BANK_NUMBER`. A label rule |
| `us-passport` | 9 digits, or a letter and 8 digits | Purview `sit-defn-us-uk-passport-number`; stdnum-js passport table; Presidio `US_PASSPORT` |
| `us-drivers-license` | Per state | Purview `sit-defn-us-drivers-license-number` (per-state patterns); Presidio `US_DRIVER_LICENSE` |
| `us-npi` | 10 digits starting 1 or 2; Luhn over "80840" and the 10 digits | Presidio `us_npi_recognizer.py` source |
| `us-dea-number` | Two letters and seven digits; the last is a check digit, method not stated | Purview `sit-defn-drug-enforcement-agency-number` |
| `us-mbi` | 11 characters; digits at 1, 4, 7, 10, 11; letters at 2, 5, 8, 9 (no S, L, O, I, B, Z); letter or digit at 3, 6 | Presidio `us_mbi_recognizer.py` source; Purview `sit-defn-medicare-beneficiary-identifier-card` |
| `uk-nino` | Two letters, six digits, A to D; barred letters and prefixes | Issuer: HMRC NIM39110 |
| `uk-nhs-number` | 10 digits; modulus 11, weights 10 to 2 | Issuer: NHS data dictionary |
| `uk-utr` | 10 digits; the first is a check digit from weights 6, 7, 8, 9, 10, 5, 4, 3, 2, modulus 11, mapped through "21987654321" | python-stdnum `gb.utr` source; HMRC for the length (10 or 13) |
| `uk-vat-number` | 9 digits (12 with a branch); weights 8 to 2, 10, 1, modulus 97; remainder 0, or 42 or 55 when the first three digits are 100 or more | python-stdnum `gb.vat` source; HMRC for the length |
| `uk-driving-licence` | 16 characters: 5 of surname, decade, month (plus 50), day, year, 2 initials, a digit, 2 letters; the DVLA check is not public | Presidio `uk_driving_licence_recognizer.py` source. Purview says 18 characters; Presidio's 16 matches the field layout |
| `uk-passport` | Sources disagree: 2 letters and 7 digits (Presidio, from 2015); 9 digits (stdnum-js); a letter or digit and 8 digits (Purview) | Presidio `uk_passport_recognizer.py`; stdnum-js; Purview `sit-defn-us-uk-passport-number`. PK chooses and records why |
| `uk-sort-code-account` | Six-digit sort code, eight-digit account | Operator: Vocalink specification 9.20 |
| `uk-vehicle-registration` | Two letters, two digits, three letters, since 2001 | Issuer's guidance: GOV.UK; Presidio `UK_VEHICLE_REGISTRATION` for older forms |
| `in-aadhaar` | 12 digits, not starting 0 or 1; Verhoeff | python-stdnum `in_.aadhaar` source; Purview `sit-defn-india-unique-identification-number` |
| `in-aadhaar-vid` | 16 digits, not starting 0 or 1; Verhoeff | python-stdnum `in_.vid` source |
| `in-pan` | 5 letters, 4 digits, 1 letter; fourth letter A, B, C, F, G, H, J, L, P or T | Issuer: Income Tax Department. Presidio's "12 characters" is wrong |
| `in-gstin` | 2-digit state code, PAN, a character, Z, a check character by Luhn modulus 36 | python-stdnum `in_.gstin` source; Presidio `IN_GSTIN` |
| `in-voter-id` | 3 letters, 7 digits; Luhn over the 7 digits | python-stdnum `in_.epic` source; Presidio `in_voter_recognizer.py`; Purview `sit-defn-india-voter-id-card` |
| `in-passport` | A letter and 7 digits; also 2 letters and 6 digits (ePassport) | Presidio `in_passport_recognizer.py`; stdnum-js passport table |
| `in-driving-licence` | 15 characters, letters and digits | Purview `sit-defn-india-drivers-license-number` |
| `in-vehicle-registration` | State code, district number, series letters, 4 digits; BH series; per-state district tables | Presidio `in_vehicle_registration_recognizer.py` source |
| `in-bank-account` | No fixed format; RBI states none | No source. A label rule (see below) |
| `in-ifsc` | 4 letters, a 0, 6 characters | Issuer: RBI |
| `in-upi-id` | A user part, `@`, a handle; letters, digits, dot and hyphen, varying by bank | Third-party page: Paytm, https://paytm.com/support/upi/upi-id-format-rules-valid-structure; handles from NPCI (item 8) |
| `in-tan` | 4 letters, 5 digits, 1 letter | Issuer: Income Tax Department |
| `in-uan` | 12 digits | Third-party page: DBS Bank, https://www.dbs.com/digibank/in/articles/save/what-is-uan-number |
| `in-abha-number` | A random 14-digit number; no check digit stated | Government: Press Information Bureau, https://pib.gov.in/PressReleasePage.aspx?PRID=2003068 |
| `ca-sin` | 9 digits, Luhn; not starting 0 or 8 | Issuer and CRA worksheet; python-stdnum `ca.sin` source |
| `ca-business-number` | 9 digits, Luhn; with a program, 2 letters and 4 digits | Issuer (CRA); python-stdnum `ca.bn` source |
| `ca-bc-phn` | 10 digits starting 9; weights 2, 4, 8, 5, 10, 9, 7, 3 on digits 2 to 9, each product modulo 11, check = (11 - sum) modulo 11 | python-stdnum `ca.bc_phn` source; stdnum-js `BC_BHN` |
| `ca-bank-account` | 7 or 12 digits | Purview `sit-defn-canada-bank-account-number`. A label rule |
| `ca-passport` | 2 letters and 6 digits | Purview `sit-defn-canada-passport-number`; stdnum-js passport table |
| `ca-drivers-licence` | Per province | Purview `sit-defn-canada-drivers-license-number` |
| `au-tfn` | 8 or 9 digits; weights 1, 4, 3, 7, 5, 8, 6, 9, 10, modulus 11; an 8-digit TFN uses the first eight weights | python-stdnum `au.tfn` source; Purview `sit-defn-australia-tax-file-number` |
| `au-abn` | 11 digits; modulus 89 | Issuer: ABR |
| `au-acn` | 9 digits; weights 8 to 1 on the first 8, check = (10 - sum modulo 10) modulo 10 | python-stdnum `au.acn` source; Presidio `AU_ACN`; ASIC for the length |
| `au-medicare-number` | 10 digits, first 2 to 6; weights 1, 3, 7, 9, 1, 3, 7, 9 on digits 1 to 8, sum modulo 10 = digit 9 | Presidio `au_medicare_recognizer.py` source; Purview `sit-defn-australia-medical-account-number` |
| `au-bank-account` | 6 to 10 digits, with or without a BSB | Purview `sit-defn-australia-bank-account-number`. A label rule |
| `au-passport` | A letter and 7 digits, or 2 letters and 7 digits | stdnum-js passport table; Purview `sit-defn-australia-passport-number` |
| `au-drivers-licence` | Per state | Purview `sit-defn-australia-drivers-license-number` |
| `bic` | 4 characters, country code, 2 characters, optional 3 | Issuer: SWIFT |
| `lei` | 20 characters; MOD 97-10 | Standard: ISO 17442 |
| `isin` | Country code, 9 characters, Double-Add-Double modulus 10 | Issuer body: ANNA; python-stdnum `isin` source |
| `cusip` | 9 characters; values doubled at even positions, digits summed, check = (10 - sum) modulo 10 | python-stdnum `cusip` source; CUSIP Global Services for the layout |
| `crypto-wallet-address` | Bech32, Bech32m, Base58Check, EIP-55 | Specifications: BIP-173, BIP-350, EIP-55 |
| `us-court-case-number` | Office, year, case type, number of 1 to 5 digits, as in 0:2010op00289; parts vary by court | Administrative Office of the US Courts, public user group notes of 11 May 2023, https://www.uscourts.gov/file/78483/download |
| `ip-address` | IPv4 and IPv6 | Presidio `IP_ADDRESS`; Purview `sit-defn-ip-address`; validator.js `isIP` |
| `url` | URL with a known top-level domain | Presidio `URL`; validator.js `isURL` |
| `mac-address` | Six octets in hexadecimal | Issuer: IEEE Registration Authority |
| `imei` | 8-digit TAC, 6-digit serial, Luhn | Standard: ETSI TS 123 003 |
| `us-provider-tax-id` | A TIN or EIN | Presidio `US_PROVIDER_TAX_ID`; the EIN row above. A label rule |
| `health-insurance-member-id` | No fixed format | Presidio `US_HEALTH_INSURANCE_MEMBER_ID`, found by context. A label rule |
| `insurance-claim-number` | No fixed format | Presidio `US_CLAIM_NUMBER`, found by context. A label rule |
| `prescription-number` | No fixed format | Presidio `US_PRESCRIPTION_NUMBER`, found by context. A label rule |

**What this does to the 23 validators.** 21 have a stated check-digit
method: the nine read at the issuer or its standard (IBAN, NHS number, SIN,
Business Number, ABN, LEI, ISIN, IMEI, and Luhn for the card), and, from
library source, the twelve others: routing number, NPI, UTR, UK VAT number,
Aadhaar, Aadhaar Virtual ID, GSTIN, BC PHN, TFN, ACN, Australian Medicare
number and CUSIP. The 22nd, the UK driving licence, has no public check
digit; its validator checks the date fields, as Presidio's does. No source
read states the DEA number's check method, so its validator is left out;
the rule finds it by format and label. The ABHA number has no check digit
in any source, so PI adds no ABHA validator. The voter ID has a Luhn check
in python-stdnum, which PI may add.

##### 8. Lists

| List | Source | Licence or terms | How often it changes |
| --- | --- | --- | --- |
| UPI handles | NPCI's "UPI 3rd Party Applications" table: each app, its bank and its handles, for example `@apl` and `@yapl` for Amazon Pay; it can be downloaded. https://www.npci.org.in/product/upi/all-members. A tab on the same page lists banks' own apps, which was not read | NPCI's terms grant no licence to copy, and forbid caching and framing; the site says "All rights reserved" (https://www.npci.org.in/terms-and-condition) | Rows have go-live months up to June 2026, so several times a year |
| Indian bank codes (the first four letters of an IFSC) | RBI, "List of NEFT enabled bank Branches (Bank-wise IFSC)", one Excel file per bank, "updated as on November 15, 2026". https://www.rbi.org.in/Scripts/bs_viewcontent.aspx?Id=2009 | RBI's copyright policy allows reproduction "accurately and without modification", with RBI acknowledged as the source (https://www.rbi.org.in/Scripts/Disclaimer.aspx) | Not stated; the date shows it is kept current |
| Microsoft Purview keyword lists | The pages list keywords, for example six for Aadhaar (https://learn.microsoft.com/en-us/purview/sit-defn-india-unique-identification-number) | Microsoft Learn's terms allow informational, non-commercial or personal use, without changes, with the copyright notice (https://learn.microsoft.com/en-us/legal/termsofuse). No public source repository with an open licence was found for these pages | not relevant |

**Decisions.** By the author's decision (28 Nov 2026), all three may be used:
"Anything that is publicly accessible but can't be copied just because of
licence shall be copied. We will handle the licensing part later when we have
some customers, say 100." Each list file records its `source` URL and, in
`licence`, what the terms above say, so that the author can settle the
licensing later. This does not change what the terms say: NPCI's and
Microsoft Learn's terms grant no right to ship a copy, and RBI's allow only
an unmodified reproduction with acknowledgement.

##### Rules left out

A rule is left out only when no source of any kind states its format, or,
for its validator, its check method. Rules with no fixed format are allowed
as label rules: the value is found next to its label, with `needs:
labelled`, and no validator. That covers the four bank account numbers, the
provider tax ID, and the health insurance member, claim and prescription
numbers. An identifier whose sources disagree (the UK passport number) is
written by its pack slice, which records the choice.

| Identifier | Reason | What would allow it later |
| --- | --- | --- |
| `us-dea-number` (validator only) | No source read states how its check digit is computed; the rule itself is written, by format and label | A DEA publication or a library that states the method |
| `in-bank-account` (format only) | No source states a format; the rule is written as a label rule | Nothing needed: it stays a label rule |
| `uk-sort-code-account` (validator only) | Vocalink's modulus checks need its weight table, a row of weights for each sort code range, which changes every few months; a validator looks nothing up, and the design names no list for it. The sort code and the account number are written as label rules, the account number with the sort code as its companion | A list of Vocalink's weight table, and a way for a check to read it |
| `uk-utr` (13-digit check only) | HMRC's design pattern allows 13 digits but no source says which ten carry the check; the 13-digit form is written as a label rule | A source that says where the 10-digit UTR sits in the 13 |
| `uk-vehicle-registration` (Northern Ireland and dateless forms) | Presidio gives the current, prefix and suffix forms only; the GOV.UK guidance on number plates (INF104) could not be read | A source that states those forms |

### 3. Target files, by slice

#### C0. Spikes and checks

No application code. It changes only this document.

| Work | What it settles |
| --- | --- |
| Write trial patterns for the 23 identifiers with a validator and run them, with their checks, over a 100-page text in a Chrome worker, on the production build and on the instrumented build | The production time against G4, and the limit of the speed test |
| Try label rules on `fixtures/form.pdf` and on a table whose labels sit in the same row as their values | Whether distance in reading order is enough to pair a label with its value. The author then decided against a rule by rows for this phase (Non-Goals) |
| Compare slow-pattern checkers on a known slow pattern and on the trial patterns | The tool the pack compiler uses, and whether "cannot judge" fails the build |
| Count identifiers broken across a line end in a generated statement and a form | Whether a separator may be followed by a line end |
| Measure approving a document with about 5,000 marks | If it takes longer than 5 seconds, a slice to speed it up is added before P0 |
| Run `pnpm exec fallow audit` on a branch with one unused file, one untested function and one tool entry | The exact `.fallowrc.json` keys of the audit exemption |
| Verify, against the issuing bodies, the check-digit facts the workbook marks "from memory", the ABHA check digit, and the UTR and voter ID disagreements | Which rules can be written |
| Find an official list of UPI handles and of Indian bank codes | The sources of two shipped lists |

**Done when** each row's result is written under "C0 results and rules left
out" and the author has read it.

#### C1. Contracts

Nothing the user sees changes. The 59 new types are not added here.

| File | Action | What changes and why |
| --- | --- | --- |
| `engine/model/findings.ts` | Create | The types of the Technical Plan, section 3: evidence, hit, place, candidate, finding, change |
| `engine/model/detection.ts` | Create | `Country`, `Industry`, `PackId`, `Profile`, `RunRecord`; a profile's pack ids; the pack order; the nine packs' names from section 6 |
| `engine/model/identifiers.ts` | Create | For each of the 65 identifier ids: its pack |
| `engine/model/project.ts` | Modify | `Project.profile`, optional; `ProjectDocument.rejected` |
| `engine/model/spread.test.ts` | Modify | Its documents gain `rejected` |
| `engine/api/facade.ts` | Modify | `Session.detection`, `Session.findings` and `Session.profile`, as typed in section 3 |
| `engine/api/state.ts` | Modify | `SessionState.detection`; the project's `profile`; `ApprovalPlan.unmarkedFindings`; the operation `marking` |
| `engine/api/errors.ts` | Modify | Shown: `detector-not-started`, `recognizer-failed`, `detector-failed`. Never shown: `busy-detecting`, `busy-marking`, `findings-open`, `no-findings`, `unknown-finding`, `no-profile`, `findings-dropped` |
| `engine/core/formats/project.ts` | Modify | Reads `profile` and `rejected`, filling the defaults when absent, in every version (D2); writes them |
| `engine/core/formats/project.test.ts` | Modify | An existing unit test file. New cases: a file without the fields reads with the defaults; a file with them reads them |
| `engine/core/stored/projects.ts` | Modify | New documents start with an empty `rejected` |
| `engine/core/session/changes.ts` | Modify | The twelve records named in section 3 |
| `engine/core/session/slices/detection.ts`, `findings.ts` | Create | The two new slices, each returning its state unchanged for now |
| `engine/core/session/slices/index.ts` | Modify | Registers both slices |
| `engine/core/session/slices/operation.ts` | Modify | The operation `marking`, begun by `findingsApplying`; `profileSet` and `findingsApplied` join the records that mark the project as saving |
| `engine/core/session/slices/marks.ts` | Modify | `profileSet` changes the project record. It is not an edit: no undo step, no review state changed |
| `engine/core/session/gate.ts` | Modify | The new commands and the refusals of the Technical Plan, section 7 |
| `engine/core/session/selectors.ts` | Modify | Publishes `detection` and `profile` |
| `engine/core/session/effects/detect.ts`, `findings.ts` | Create | `detectionOf` and `findingsOf`, built as `approvalOf` is: a function that takes `{ source, view, allowed, dispatch, change, client }` and returns the commands. For now every command refuses: `detector-not-started` and `no-findings` |
| `engine/core/session/effects/profile.ts` | Create | `profileOf`, with `profile.set` complete: behind the gate, it dispatches `profileSet` |
| `engine/core/session/effects/plan.ts` | Modify | The plan it builds gains `unmarkedFindings: 0` |
| `engine/core/session/facade.ts` | Modify | Builds the Session's three new parts from the three functions. `SessionHost` gains `detection`, the client |
| `engine/core/session/facade.test.ts` | Modify | Its documents gain `rejected`, its host the client, its plan literal `unmarkedFindings`. New case: `profile.set` stores the profile and makes no undo step |
| `engine/core/session/output.test.ts` | Modify | Its document gains `rejected` |
| `engine/core/detect-client/client.ts`, `README.md` | Create | The `DetectionClient` interface, and a client whose run ends as failed with `detector-not-started` |
| `engine/core/createEngine.ts` | Modify | Gives the Session that client until W1 |
| `engine/core/README.md`, `engine/core/stored/README.md`, `engine/core/session/README.md` | Modify | The new folder and parts |
| `app/errors.ts` | Modify | The three sentences from the wording table |
| `.fallowrc.json` | Modify | The audit exemption, for `engine/model/detection.ts`, `engine/model/identifiers.ts` and `engine/model/findings.ts` |
| `fixtures/golden/project/**`, `expected/**`, `expected-old/**` | Modify | Recorded again, because each stored document now carries `rejected`. `project/` is rewritten whole, so its diff shows new file names. `fixtures/golden/pre-phase-3/` is not touched |

**Done when** `pnpm test` passes with no browser test changed, and
`anchoring.spec.ts` and `golden.spec.ts` still open the storage from before
Phase 3.

#### M1. Spreading marks a covered value

Browser test first, in `tests/e2e/spreading.spec.ts`: document A marks an
account number; document B marks a longer text that contains it. Approving A
gives B a mark of the account number inside its longer mark. Approving B then
leaves the account number removed from A's download. The outside checker
judges both downloads.

| File | Action | What changes and why |
| --- | --- | --- |
| `tests/e2e/spreading.spec.ts` | Modify | The test above |
| `engine/model/spread.ts` | Modify | `placeMark` skips a place only where a mark of that same value already sits, where today it skips a place any text mark covers (D14). `approve` is not changed |
| `engine/model/spread.test.ts` | Modify | An existing unit test file: the same case beside its neighbours |

This slice makes overlapping marks in documents. It needs the writer's fix
only for the case where each mark's type is printed in its box; its own test
runs with that setting off, which is the default.

**Done when** `spreading.spec.ts` passes and `pnpm test` passes.

#### U1. Type picker in groups

Browser tests first, in `tests/e2e/marking.spec.ts`: the picker lists the 14
general types, then the 59 new identifiers under their pack's name; typing
filters across groups; a typed name equal to a built-in name cannot be added;
a typed name that is part of one is added through the "Add as a new type" row.

| File | Action | What changes and why |
| --- | --- | --- |
| `tests/e2e/marking.spec.ts` | Modify | The cases above. The existing arrow-key test reaches "Other" by name, not by counting 13 steps |
| `tests/e2e/folder.spec.ts` | Modify | Its custom type "Case number" is added through the new row |
| `dataset/ground-truth.schema.json` | Modify | The 59 new types; `IN` joins the country list (D3) |
| `dataset/README.md` | Modify | Says the type list now holds identifiers as well as kinds of data |
| `tools/dataset/tests/test_validate.py` | Modify | A case with an identifier type and with `IN` |
| `app/TypePicker.tsx` | Modify | Groups, worked out inside the picker from `engine/model/identifiers.ts`; the "Add as a new type" row; the refusal of an equal name. The picker already filters as the user types. Both places that show it, for a new mark and for changing a mark's type, get the groups. Its props do not change, so `useMarks.ts`, `PageList.tsx`, `MarksPanel.tsx` and `Workspace.tsx` do not change |

**Done when** `marking.spec.ts` and `folder.spec.ts` pass and `pnpm test`
passes.

#### F1. Profile chooser

Browser test first: `tests/e2e/profile.spec.ts`. A new project has no profile.
The chooser, opened from the top bar, starts with nothing selected and lists
under each choice what it adds. It can be submitted with nothing selected. The
stored answer survives a reload. Setting the profile puts no document back in
review.

| File | Action | What changes and why |
| --- | --- | --- |
| `tests/e2e/profile.spec.ts` | Create | The cases above |
| `tests/e2e/auto.ts` | Create | Page helpers for the new tests, starting with "choose a profile" |
| `app/ProfileChooser.tsx` | Create | Countries and industries, with "Adds: ..." under each. Two modes: for the project, and for one run, filled in with the project's profile |
| `app/AutoControls.tsx` | Create | The Auto mode controls. For now only the entry that opens the chooser |
| `app/TopBar.tsx` | Modify | Places `AutoControls` |
| `app/ProjectView.tsx` | Modify | Passes the project's profile and `session.profile.set` to `TopBar` |

**Done when** `profile.spec.ts` passes and `pnpm test` passes.

#### W1. Detection worker and first rule

The worker has no screen until V1. Its files join the audit exemption.

| File | Action | What changes and why |
| --- | --- | --- |
| `engine/detect-protocol/messages.ts`, `parse.ts`, `tsconfig.json`, `README.md` | Create | The five messages of section 3 and the parsers of the replies. The helpers `pdf-protocol/parse.ts` and this file would both need move to `engine/model/guards.ts` |
| `engine/model/textView.ts` | Create | The text view. It holds the loop that maps a string back to `chars` indexes |
| `engine/model/match.ts` | Modify | `normalise` uses that loop, so it exists once. `normalise` and the joiner class are exported, for R3 and P0. Matching is unchanged; the existing `match.test.ts` and the spreading tests show it |
| `engine/model/textView.test.ts` | Create | Unit test. Reason: a character stored as two UTF-16 units, or a ligature, before a value shifts string positions against `chars` indexes; this fault has happened here before |
| `engine/detect/tsconfig.json`, `tsconfig.worker.json`, `README.md` | Create | The zone, and the worker entry's own typecheck with the `WebWorker` library |
| `engine/detect/detectWorker.ts` | Create | The worker entry: the only file in the zone that knows it runs in a worker |
| `engine/detect/handler.ts` | Create | Handles `load` and `page`; answers `ready`, `hits` or `failed` |
| `engine/detect/messages.ts` | Create | Posting replies, as `engine/pdf/messages.ts` does |
| `engine/detect/recognizer.ts` | Create | The recognizer contract |
| `engine/detect/regexEngine.ts` | Create | The `RegexEngine` interface and its JavaScript implementation |
| `engine/detect/regexEngine.test.ts` | Create | Unit test. Reason: a match of length zero makes a `RegExp` loop repeat for ever unless the position is moved by hand, and a browser test would see that only as a timeout |
| `engine/detect/patternRecognizer.ts` | Create | Runs a pack's rules over the text view: match, value group, `notNextTo`, validator. It reads each hit's `text` with `rangeText`. It catches an error from a validator, counts it, and treats the value as not passed |
| `engine/detect/patternRecognizer.test.ts` | Create | Unit test. Reasons: the offset fault above, one step later; and a validator that throws must cost one value and not the page |
| `engine/detect/validators/shared.ts`, `universal.ts`, `index.ts` | Create | Luhn; the card check; the registry of validators by name |
| `engine/detect/packs/generated/universal.json`, `index.ts` | Create | One rule, the payment card, and the index that imports it. Placeholders written by hand; P0's compiler writes them from then on |
| `engine/core/detect-client/client.ts` | Fill | The real client: starts the worker through the host's function, sends `load` and one `page` at a time, hands back hits, ignores replies of an earlier run, ends the worker on stop, and ends the run with a code when the worker cannot start, cannot load or fails |
| `engine/core/detect-client/errors.ts` | Create | The client's error shape, as `engine/core/pdf-client/errors.ts` has, over the codes C1 added |
| `engine/core/createEngine.ts` | Modify | Takes `startDetectionWorker` and builds a client for each Session from it |
| `engine/host-browser/workerChannel.ts` | Modify | The shared part of starting a worker moves into `channelOf(worker)`. `startPdfWorker` and the new `startDetectionWorker` both use it. One more line with the exempt comment names `../detect/detectWorker.ts` |
| `engine/host-browser/createBrowserEngine.ts` | Modify | Passes the function in |
| `engine/README.md`, `README.md` | Modify | Both say today that one line is exempt and that one file uses worker APIs |
| `engine/tsconfig.test.json` | Modify | Includes `detect/**/*.test.ts` |
| `.fallowrc.json` | Modify | Zones `detect-protocol` and `detect` and their rules; `core` and `tests` may import `detect-protocol`; `tests` may import `detect`. W1's files join the audit exemption |
| `package.json` | Modify | The typecheck script, as section 2 lists |

**Done when** `pnpm test` passes and `pnpm build` writes
`assets/detectWorker-<hash>.js`.

#### E1. Run, hits and resolver in the Session

Tests: cases in the existing `engine/core/session/facade.test.ts`, with a
fake detection client, and the unit test `resolver.test.ts`. Its files join
the audit exemption.

| File | Action | What changes and why |
| --- | --- | --- |
| `engine/core/session/facade.test.ts` | Modify | A run on a document with stored text gives findings. A hit where the same value is already marked is dropped. A hit inside or around a mark of another value is kept. Two hits whose spans overlap give two findings; two hits on the same span give one finding with two candidates. A hit of a rejected value is dropped. A lost mark does not count as a mark. A second run is refused. Approval is refused during a run. A run without a profile is refused. A stopped run and a run whose worker failed both keep the hits of the pages searched. Closing the Session stops a run |
| `engine/model/resolver.ts` | Create | The resolver of section 3 |
| `engine/model/resolver.test.ts` | Create | Unit test. Reason: the resolver decides what is offered, and its rules have more cases than fixtures can carry. It also times the resolver on 5,000 marks and 5,000 hits and fails over 200 ms, since the resolver runs on the main thread |
| `engine/core/session/effects/detect.ts` | Fill | `run` and `stop` behind the gate. Reads the document's stored page texts with `readTexts`; if they are missing, starts the existing update and refuses with `busy-updating`. Drives the client page by page and dispatches `runStarted`, `pageSearched` and `runEnded`. It ends in one function, `ended(document, run)`, which hands the run to the findings effect |
| `engine/core/session/effects/findings.ts` | Modify | Runs the resolver at the moments section 3 lists and dispatches `findingsResolved`. Ends a findings review that has no findings left |
| `engine/core/session/slices/detection.ts` | Fill | The run state per document; the notices that are not stored |
| `engine/core/session/slices/findings.ts` | Fill | Holds an ended run's hits, the user's changes and the resolved findings |
| `engine/core/session/facade.ts` | Modify | `close` stops a run and ends the worker |
| `.fallowrc.json` | Modify | E1's files join the audit exemption |

**Done when** `pnpm test` passes.

#### V1. Findings panel, Run and Stop

Browser test first: `tests/e2e/auto-run.spec.ts`.

*   The first Run on a new project shows the chooser.
*   A run on `fixtures/auto-card.pdf` shows "Searching page 1 of 1", then the
    findings panel in the marks panel's place, with a row for the card number:
    its name, text, number of places and reason. The row is ticked. The
    near-miss has no row.
*   The finding is drawn on the page. Hand marking is off.
*   With a detection fake that never answers a page, Stop ends the run and
    the line "Stopped. Pages 1 to 1 were not searched." is shown.
*   A run "For this run only" leaves the project's profile as it was.
*   The detection worker loads from the app's origin and makes no request.

| File | Action | What changes and why |
| --- | --- | --- |
| `tests/e2e/auto-run.spec.ts` | Create | The cases above |
| `tests/e2e/auto.ts` | Modify | Helpers: run, stop, rows of the findings panel |
| `tests/e2e/fakes.ts` | Modify | One helper, `fakeDetection(page, script)`: it serves the given typed function, turned into a script as the existing fakes are, in place of `assets/detectWorker-*.js`, through a second route beside the PDF worker's, and joins the check that every fake acted |
| `tests/e2e/network.spec.ts` | Modify | The detection worker's script and traffic |
| `tests/oracle/make_fixtures.py` | Modify | Makes the four files below. The ligature and the two-unit character use the script's existing font with a `ToUnicode` map |
| `fixtures/auto-card.pdf` | Create | A page with a valid card number and a near-miss |
| `fixtures/auto-offset.pdf` | Create | A two-unit character and a ligature before a card number |
| `fixtures/auto-shapes.pdf` | Create | Card numbers that touch, that cross a line end, and 300 on one page |
| `fixtures/auto-pages.pdf` | Create | Twelve pages, with a card number on pages 1, 5 and 12 |
| `app/FindingsPanel.tsx` | Create | The panel: title, the instruction line, rows, the confirm and Close buttons (not active until R1) |
| `app/FindingRow.tsx` | Create | One finding: tick (not active until R1), name, exact text, places, reason. Each row exposes its text, identifier id and number of places to tests |
| `app/RunNotices.tsx` | Create | The lines about a run from the wording table. Shown in the panel and beside the Run control |
| `app/useFindings.ts` | Create | Reads `detection` from the state and wraps the Session's commands |
| `app/AutoControls.tsx` | Modify | Run, Stop, the page counter, "For this run only" |
| `app/Workspace.tsx` | Modify | Shows the findings panel in the marks panel's place while a findings review is open |
| `app/ProjectView.tsx` | Modify | Reads the findings through `useFindings` and passes them to `TopBar` and `Workspace` |
| `app/TopBar.tsx` | Modify | Disables the marking tools while a findings review is open |
| `app/PageList.tsx` | Modify | Passes each page's findings to `PageView`, which it alone renders |
| `app/PageView.tsx` | Modify | Draws the findings, apart from marks, working out their boxes from the page text |
| `.fallowrc.json` | Modify | The audit exemption is removed |

**Done when** `auto-run.spec.ts` and `network.spec.ts` pass and `pnpm test`
passes with the exemption gone.

#### R1. Confirm, marks, rejected values, undo, Close, approval warning

Browser test first: `tests/e2e/auto-review.spec.ts`.

*   Untick one finding and press confirm: the dialog shows both counts.
    Cancel leaves the panel open. Confirm makes a mark at every place of each
    ticked value, each with the identifier's name as its type.
*   A second run does not offer the unticked value.
*   A value that a hand mark overlaps in part is offered; accepting it adds
    its own mark beside the hand mark.
*   Two prepared hits that overlap are two rows. Confirming makes two marks
    that overlap, and the download passes the outside checker, with each
    mark's type printed in its box and without.
*   A value on the "Don't hide here" list is offered ticked; confirming marks
    it and removes it from that list.
*   Undo shows its dialog and removes every mark in one step; the rejected
    value stays rejected. Redo, then undo again, shows the dialog again.
*   Approving with the panel open shows the count, proceeds, and leaves the
    panel open; confirming afterwards puts the document back in review.
*   Approving another document that marks the only found value ends the
    findings review by itself.
*   Close shows its dialog and keeps nothing.
*   With a detection fake that answers with a prepared list of hits: hits
    with model evidence and edges inside words are listed, strongest evidence
    first, accepted and removed (G18, G8).
*   The downloads pass the outside checker, through `judge` in
    `tests/e2e/oracle.ts`: `auto-card.pdf`, `auto-offset.pdf` and
    `auto-shapes.pdf`.

| File | Action | What changes and why |
| --- | --- | --- |
| `tests/e2e/auto-review.spec.ts` | Create | The cases above. Its fake's function lives in the spec |
| `engine/core/session/facade.test.ts` | Modify | A document with a lost mark: confirming a finding with the same letters takes the lost mark's place, and apply is then allowed. A second confirm during the first is refused |
| `engine/model/findingMarks.ts` | Create | Accepted findings to marks: one mark per place, its target built with the existing `textTarget` |
| `engine/model/marks.ts` | Modify | `markedAgain` moves here unchanged from `engine/core/session/facade.ts`, so the hand-mark command and the findings effect both use it |
| `engine/core/session/facade.ts` | Modify | Imports `markedAgain` from its new place |
| `engine/core/session/effects/findings.ts` | Fill | `setTicked`, `confirm` and `close` behind the gate. Confirm follows the five steps of section 4 |
| `engine/core/session/slices/findings.ts` | Modify | Ticks; ends on `findingsApplied` and `findingsClosed` |
| `engine/core/session/slices/marks.ts` | Modify | `findingsApplied` adds the marks, removes the lost marks it replaces, and adds the rejected values. With marks it is an edit; with rejected values only it is not |
| `engine/core/session/slices/index.ts` | Modify | `isUndoable` returns the document and a tag; `findingsApplied` with marks is undoable, tagged with its counts |
| `engine/core/session/slices/history.ts` | Modify | The two lists of tags of section 3 |
| `engine/core/session/selectors.ts` | Modify | `nextUndo` from the newest tag |
| `engine/core/session/effects/plan.ts` | Modify | An approval counts the findings of the document's open findings review, and always shows its dialog when there are any |
| `app/FindingRow.tsx` | Modify | The tick calls `findings.setTicked` |
| `app/FindingsPanel.tsx` | Modify | The confirm button with its label, Close |
| `app/useFindings.ts` | Modify | `confirm` and `close` |
| `app/ConfirmFindingsDialog.tsx`, `CloseFindingsDialog.tsx`, `UndoFindingsDialog.tsx` | Create | The three dialogs |
| `app/ProjectView.tsx` | Modify | Undo is built here (`historyOf`); it opens the undo dialog when `nextUndo` is a findings review |
| `app/ApproveDialog.tsx` | Modify | The added line |

**Done when** `auto-review.spec.ts` passes and `pnpm test` passes.

#### W2. Runs that fail or end early

Browser test first: `tests/e2e/auto-failures.spec.ts`, on
`fixtures/auto-pages.pdf`, with detection fakes whose functions live in the
spec.

*   A worker that cannot start, and one that answers `failed` to `load`: the
    sentence for the code is shown beside the Run control, no panel opens, and
    the document can then be approved and run again.
*   A worker that fails on page 3: the panel opens with the finding of page 1
    and the line "The run ended early because of an error. Pages 3 to 12 were
    not searched."
*   A worker that answers 11 pages and then nothing: Stop opens the panel
    with the findings of pages 1 and 5 and the line "Stopped. Pages 12 to 12
    were not searched."

| File | Action | What changes and why |
| --- | --- | --- |
| `tests/e2e/auto-failures.spec.ts` | Create | The cases above |
| `engine/core/session/slices/detection.ts` | Modify | The notice `run-failed` with its code |
| `engine/core/session/effects/detect.ts` | Modify | The run's record: how it ended, its code, the pages not searched, the hits per rule, the number of errors |
| `app/RunNotices.tsx` | Modify | The "ended early" line, and the sentence from `app/errors.ts` for `detector-not-started`, `recognizer-failed` and `detector-failed` |

**Done when** `auto-failures.spec.ts` passes and `pnpm test` passes.

#### R2. Stored findings review, later runs, reader change

Browser test first: `tests/e2e/auto-stored.spec.ts`.

*   Reload with the panel open: the same findings and unticks, and no run.
*   Run again after a confirmed findings review: none of the marked or
    rejected values is offered. When nothing is new, the line says so.
*   After confirming, the run record is in the reader folder and holds no
    value from the page.
*   Reader change: with the project closed, move the reader folder to
    `pdf-2/`, then open the project. The document has no findings panel and
    shows the notice. Run in the notice starts a run; Dismiss removes the
    notice. Neither returns after a reload.
*   Rename the moved project before opening it: the notice is still there
    when the document is opened, and no run has started.
*   Duplicate a project with an open findings review: the copy shows the same
    findings.
*   Change one hit's text in the stored hits file: on reopening, the findings
    review is dropped with the `text-changed` notice.
*   Replace the stored hits file with text that is not JSON: the document has
    no findings review, and the file is still there.

| File | Action | What changes and why |
| --- | --- | --- |
| `tests/e2e/auto-stored.spec.ts` | Create | The cases above |
| `tests/e2e/app.ts` | Modify | A new helper beside `storedFiles`: it copies every file under `<folder>/.redactorator/pdf-3/` to `pdf-2/` and removes `pdf-3/`. Document ids are read before the move |
| `engine/core/formats/findings.ts` | Create | The three formats of section 5: names, version 1, parsers and writers |
| `engine/core/stored/projects.ts` | Modify | Exports `recordsIn`, so the findings paths are built from it. `migrateToTag` writes the `dropped` state for each document whose older folder holds a readable hits file |
| `engine/core/stored/findings.ts` | Create | Reads, writes and deletes a document's three files in the reader folder |
| `engine/core/session/effects/findings.ts` | Modify | When a run ends: writes the run record, and with hits the hits file and an empty state file. Queues the state file's writes. When the Session begins: tests each stored hit and drops a findings review whose text changed. Deletes in the orders of section 5 |
| `engine/core/session/effects/detect.ts` | Modify | `run` removes a stored notice |
| `engine/core/session/slices/findings.ts` | Modify | Opens from stored files without a run; holds the stored notice |
| `engine/core/session/slices/operation.ts` | Modify | The saving state covers the findings queue, so the tests' existing wait for "saved" covers it too |
| `engine/core/session/facade.ts` | Modify | Loads each document's findings files with its prepared files when the Session begins; `flush` and `close` wait for the queue |
| `app/FindingsDroppedNotice.tsx` | Create | The notice with Run and Dismiss |
| `app/Workspace.tsx` | Modify | Shows the notice on a document that has one |

**Done when** `auto-stored.spec.ts` passes and `pnpm test` passes.

#### R3. Candidates and edges

Browser test first: `tests/e2e/auto-edit.spec.ts`, with a detection fake that
answers with prepared hits, some of them two identifiers on one span.

*   Change a finding's identifier to another candidate: the mark carries the
    new name.
*   Lengthen an edge whose added text is present in 2 of the finding's 3
    places: after confirming, two places have a mark of the wider text and
    one a mark of the value as found, and the panel said "Wider in 2 of 3
    places."
*   Shorten an edge and see every place change. A second run offers the
    whole value again, ticked.
*   Make two findings equal and see one, ticked if either was.
*   The download passes the outside checker.

| File | Action | What changes and why |
| --- | --- | --- |
| `tests/e2e/auto-edit.spec.ts` | Create | The cases above |
| `engine/model/edges.ts` | Create | The new span's normalised text, and the search for it at each place through `normalise`'s map |
| `engine/model/resolver.ts` | Modify | Applies the chosen identifier and the edge; joins findings whose keys became equal |
| `engine/model/findingMarks.ts` | Modify | The span at each place: the edited one where it is found, the span as found elsewhere |
| `engine/core/session/effects/findings.ts` | Modify | `choose` and `setEdges` |
| `engine/core/session/slices/findings.ts` | Modify | Stores those changes |
| `app/FindingRow.tsx` | Modify | The identifier picker: candidates at least as strong as the default, then "Other possible types ({n})" |
| `app/PageList.tsx`, `app/PageView.tsx` | Modify | Edge handles on the selected finding; the wider span outlined |
| `app/FindingsPanel.tsx` | Modify | The "Wider in ..." line |

**Done when** `auto-edit.spec.ts` passes and `pnpm test` passes.

#### P0. Rule format, pack compiler, fixture generator

Browser tests first.

*   `tests/e2e/packs.spec.ts` runs Auto mode on each generated PDF under
    `fixtures/packs/`, with the profile set to the one choice that adds the
    pack (nothing chosen for `universal`), and matches as the Technical Plan,
    section 9, says.
*   P0 makes it pass for seven first rules, each in its final pack, which
    between them use every evidence kind and the giving-way mechanism: payment
    card (checksum) and email (a distinctive format) in `universal`; IFSC
    (list), Indian bank account (companion to an IFSC), Aadhaar (checksum) and
    UAN (labelled, with Aadhaar giving way to it) in `in`; US bank account
    (label) in `us`. The rule format is final when all seven work.
*   A project whose profile is the United States does not find the IFSC of
    the `in` fixture; a run "For this run only" with India finds it; the
    project's profile is unchanged.
*   `tests/e2e/bundle.spec.ts`: the main bundle of the build under test
    (`dist-coverage/` in the test run) holds no pack text.

| File | Action | What changes and why |
| --- | --- | --- |
| `tests/e2e/packs.spec.ts`, `bundle.spec.ts` | Create | The tests above |
| `tools/packs/compile.ts` | Create | The compiler of section 2: YAML to JSON; each pack's version; the index of packs and lists; `--check`; the field, schema, validator and list checks; `RegExp` compilation; the named pieces; the refusal of `format` alone for a digits-only pattern |
| `tools/packs/slow.ts` | Create | The slow-pattern check, built on `scslre`, with its negative control |
| `tools/packs/README.md` | Create | How to add a rule |
| `tools/tsconfig.json`, `tools/vite.config.ts` | Create | As written in section 2 |
| `tests/oracle/make_pack_fixtures.py` | Create | Reads the YAML with PyYAML; lays out each rule's examples as a PDF with labels, each number written in the seven ways, using `make_fixtures.py`'s PDF helpers; writes the truth file; `--check` |
| `tests/oracle/pyproject.toml`, `uv.lock` | Modify | PyYAML and python-stdnum, each pinned to one version |
| `tests/oracle/tests/test_make_pack_fixtures.py` | Create | The generator's tests |
| `tools/README.md`, `tests/oracle/README.md` | Modify | The new tools |
| `package.json`, `pnpm-lock.yaml` | Modify | `yaml` and `scslre` as development dependencies; the scripts of section 2 |
| `.gitignore` | Modify | `tools/.build/` |
| `.fallowrc.json` | Modify | Zone `tools` and its rule; `tools/**/*.ts` under `supportEntry` |
| `engine/detect/packs/src/universal.yaml`, `in.yaml`, `us.yaml` | Create | The seven first rules |
| `engine/detect/packs/src/uk.yaml`, `ca.yaml`, `au.yaml`, `finance.yaml`, `legal.yaml`, `medical.yaml` | Create | Placeholders with no rules, so the compiled index is complete from here on |
| `engine/detect/packs/lists/in-bank-codes.yaml` | Create | The list the IFSC rule needs |
| `engine/detect/packs/lists/us-ein-prefixes.yaml`, `in-upi-handles.yaml`, `in-vehicle-state-codes.yaml`, `top-level-domains.yaml`, `us-court-case-types.yaml` | Create | Placeholders with no entries, for the same reason |
| `engine/detect/packs/generated/**` | Fill | The compiler's output for the nine packs, the six lists and the index |
| `engine/detect/loadPacks.ts` | Create | Gives the recognizer the packs and lists a `load` message names |
| `engine/detect/handler.ts` | Modify | Uses `loadPacks.ts` |
| `engine/detect/patternRecognizer.ts` | Modify | Labels, list lookup, companion evidence, one rule giving way to another, the least evidence a rule needs |
| `engine/detect/validators/shared.ts` | Modify | Verhoeff, modulus 97 and the weighted-sum helper |
| `engine/detect/validators/in.ts` | Create | The Aadhaar check |
| `engine/detect/validators/us.ts`, `uk.ts`, `ca.ts`, `au.ts`, `finance.ts`, `legal.ts`, `medical.ts` | Create | Placeholders, one per pack |
| `engine/detect/validators/index.ts` | Modify | Imports all nine |
| `engine/model/detection.ts` | Modify | The rule's fields, final once the seven rules work |
| `fixtures/packs/universal.pdf`, `in.pdf`, `us.pdf`, and a `.truth.json` beside each | Create | Generated |

**Done when** `packs.spec.ts` and `bundle.spec.ts` pass and `pnpm test`
passes.

#### PU, PK, PI, PC, PA, PX. The packs

Six slices with the same shape. Each waits only for P0. Browser test first:
the slice adds its rules' examples, runs `pnpm packs`, and
`tests/e2e/packs.spec.ts` fails until the rules are written. A rule is written
only when its format and its check have a source (goal G2): the one C0's
results give for the identifier, or one the slice finds and records in the
rule's `source` and `verified` fields. A rule left out is listed under "C0
results and rules left out".

| Slice | Pack sources (Fill) | Validators (Fill) | Lists (Fill) |
| --- | --- | --- | --- |
| PU | `engine/detect/packs/src/us.yaml`, `medical.yaml` | `engine/detect/validators/us.ts`: bank routing number, NPI, DEA number | `engine/detect/packs/lists/us-ein-prefixes.yaml` |
| PK | `engine/detect/packs/src/uk.yaml` | `engine/detect/validators/uk.ts`: NHS number, UTR, VAT number, driving licence | none |
| PI | `engine/detect/packs/src/in.yaml` | `engine/detect/validators/in.ts`: Aadhaar Virtual ID, GSTIN, and the ABHA number if C0 confirms its check digit | `engine/detect/packs/lists/in-upi-handles.yaml`, `in-vehicle-state-codes.yaml` |
| PC | `engine/detect/packs/src/ca.yaml` | `engine/detect/validators/ca.ts`: SIN, Business Number, BC Personal Health Number | none |
| PA | `engine/detect/packs/src/au.yaml` | `engine/detect/validators/au.ts`: TFN, ABN, ACN, Medicare number | none |
| PX | `engine/detect/packs/src/universal.yaml`, `finance.yaml`, `legal.yaml` | `engine/detect/validators/universal.ts`: IBAN. `finance.ts`: LEI, ISIN, CUSIP. `legal.ts`: IMEI | `engine/detect/packs/lists/top-level-domains.yaml`, `us-court-case-types.yaml` |

Each slice also creates or regenerates, with `pnpm packs`: its packs' and
lists' files under `engine/detect/packs/generated/`, and
`fixtures/packs/<pack>.pdf` with its truth file. Each adds its rows to "C0
results and rules left out" in `docs/designs/auto-mode.md`.

Pack slices cannot break each other's tests: a near-miss is judged only
against rows whose identifier belongs to the pack under test, and no test
counts the rows of a panel.

**Done when** `pnpm test` passes, and every identifier of the slice's packs in
the identifier table is either a planted value in
`fixtures/packs/<pack>.truth.json` or a row under "C0 results and rules left
out".

#### Z1. Closing checks

| File | Action | What changes and why |
| --- | --- | --- |
| `tests/e2e/auto-speed.spec.ts` | Create | Every pack loaded on the 100-page generated file; fails over the limit C0 set for the instrumented build (G4) |
| `tests/oracle/make_pack_fixtures.py` | Modify | Also writes the 100-page file |
| `fixtures/packs/speed-100.pdf`, `speed-100.truth.json` | Create | Generated |
| `tests/e2e/review-cost.spec.ts` | Create | Tagged `@report`. For each generated PDF: actions from Run to an approved document (one action is one click or one key press on a control), findings in the panel, unticks needed, and the hand marks the same file needs. Writes `test-results/review-cost.json`. It has no pass mark (G20) |
| `playwright.config.ts` | Modify | The default run leaves out tests tagged `@report` |
| `package.json` | Modify | `report:review-cost` |
| `README.md`, `engine/README.md`, `app/README.md`, `engine/detect/README.md` | Modify | Auto mode in the product description; the final list of packs and of rules left out |
| `docs/designs/auto-mode.md` | Modify | What was measured, which rules were left out and why, and the changes proposed to `docs/Implementation-Plan.md` and `docs/HLD.md` |

**Done when** `pnpm test` passes, the speed test is within its limit, and the
author has `test-results/review-cost.json` and the list of proposed changes.

### Verification Plan

*   **Typecheck**: `pnpm typecheck`, extended as section 2 lists.
*   **Boundaries**: `pnpm exec fallow architecture --boundaries`, with the
    zones `detect-protocol`, `detect` and `tools`. Only `tools` and `tests`
    import `detect`.
*   **Unit tests**: `vitest run`. New files, each with its reason in its
    slice: the text view, the regex engine, the pattern recognizer, the
    resolver. Existing files extended: `formats/project.test.ts`,
    `session/facade.test.ts`, `model/spread.test.ts`. Changed only to
    typecheck: `session/output.test.ts`.
*   **Tools**: `pnpm test:tools`, extended as section 2 lists.
*   **Browser tests**: `pnpm test:coverage` (Playwright against the
    instrumented build, on `127.0.0.1:4173`, one run at a time across
    worktrees). New specs: `profile`, `auto-run`, `auto-review`,
    `auto-failures`, `auto-stored`, `auto-edit`, `packs`, `bundle`,
    `auto-speed`. Changed specs: `spreading`, `marking`, `folder`, `network`.
    `review-cost` runs from its own script. The golden files are recorded
    again in C1.
*   **The outside checker**: the downloads in `spreading`, `auto-review` and
    `auto-edit` are judged by `tests/oracle`.
*   **Audit**: `pnpm exec fallow audit` passes; between C1 and V1 with the
    stated exemption.

| Goal | Judged by |
| --- | --- |
| G1, G2, G3 | `packs`, and the pack compiler's checks |
| G4 | `auto-speed`; C0's measurement on the production build |
| G5 | `auto-run` (the page counter, Stop), `auto-failures` (a run that ends early keeps its findings), the slow-pattern check in `test:tools` |
| G7 | `profile` (no default, an empty profile), `auto-run` (the first run asks; "For this run only"), `packs` (a choice adds its pack) |
| G8, G18 | `auto-review`, with the prepared list of hits |
| G9, G11, G14, G15 | `auto-review` |
| G10 | `auto-edit` |
| G12 | `auto-stored` |
| G13 | `auto-review` (a rejected value, a value already marked), `auto-stored` (a later run) |
| G16 | `network`, `bundle` |
| G17 | `auto-review` and `auto-edit`, through the outside checker |
| G20 | `review-cost` |
| G22 | `auto-review` (values that overlap are two findings and two marks; a value under a hand mark is offered) |
| D14 | `spreading` |

--------------------------------------------------------------------------------

*Drafted with EGM*
