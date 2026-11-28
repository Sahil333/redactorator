# Phase 4: Auto mode

*   **Author:** Sahil Chaddha
*   **Status:** Proposed. Revised twice on 2026-11-28, after each of two
    design reviews; what changed is listed under "Changes after the design
    reviews".
*   **Date:** 2026-11-28

This document can be read without any other. Its source is the brainstorm's
brief, kept beside it as `docs/designs/auto-mode-brief.md`. "Brief S24" or
"brief A8" in brackets points to that brief's decision register, to show where
a decision came from. Where the two differ, this document takes precedence.

--------------------------------------------------------------------------------

## Overview

Auto mode finds personal data in a PDF for the user. The user starts a run on
one document. Recognizers search its text and propose findings. The user goes
through the findings in a side panel, unticks or changes the wrong ones, and
confirms. Each confirmed finding then becomes an ordinary mark.

What happens after a mark exists comes from phases 1 to 3: approving the
document, spreading a value to the other documents of a project, writing the
output file, and the leak checks on that file. One rule of approval changes
(decision D14). Nothing else does, and how the output file is written does
not change at all.

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
| Candidate | One reading of a piece of text: a span, an identifier and its evidence |
| Finding | What the user decides on: one value in one document, with all its places and its candidates. The panel calls findings "found values" |
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
benchmark and the synthetic dataset are separate work (brief S4). Ids G6 and
G21 belonged to goals removed after the first design review and are not
reused. The table that maps each goal to its test is in the Verification Plan.

**Finding**

*   **G1.** A run on one document finds every planted identifier in one
    generated PDF per pack. A browser test fails on any planted value that is
    missed or any planted near-miss that is found, and lists the other
    findings.
*   **G2.** Every rule has positive examples and near-misses, records the
    source of its format, and is written only once that format is verified
    against the body that issues the identifier.
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
*   **G13.** A later run never offers a value that an existing mark overlaps,
    or a rejected value (brief S26).
*   **G14.** Approving a document and confirming its findings are separate
    acts. Approving a document whose findings review is open shows a warning
    with the number of found values not yet marked, and lets the user proceed.
    The findings review stays open (brief S28).
*   **G15.** A mark made from a finding carries the specific identifier's
    name, such as SSN or IFSC, never a general name for a group of identifiers
    (brief S34).
*   **G22.** Auto mode never makes a mark that overlaps another mark. Each
    place of an accepted finding gets exactly one mark, and a found value that
    an existing mark overlaps is not offered.

**Keeping the product's rules**

*   **G16.** No request carries document bytes, text or findings. Packs and
    lists ship with the app. The existing same-origin test covers the new
    worker.
*   **G17.** How the output file is written does not change. A downloaded file
    made from accepted findings passes the outside checker, including a
    fixture with a character stored as two UTF-16 units in front of an
    identifier, and a fixture with marks that touch, cross a line end, and
    number in the hundreds on a page (brief A2, A12).

**Preparing for what comes next**

*   **G18.** Hits that no regular expression made pass through the same
    worker messages, the same resolver, the same panel and the same step that
    makes marks. A test shows it with a prepared list of hits that carry model
    evidence and edges inside words (brief S12).
*   **G19.** Detection runs from the command line under Node, without the
    app, on a document's stored page text. It writes each hit's page,
    character range, text and identifier. It shows that the engine's detection
    needs no browser, and gives a quick way to try a rule change.
*   **G20.** The cost of a findings review is counted on the generated files:
    actions from Run to an approved document, findings in the panel, and
    unticks needed, against the hand marks the same document needs.

## Non-Goals

*   **People's names, addresses and other free text.** Recognizers that use
    named-entity recognition (NER) or a large language model are later phases.
*   **Marks that overlap** (author, 28 Nov 2026). Overlap has too many edge
    cases for this phase and for the later pseudonymisation phase.
*   **Patterns a user writes** (author, 28 Nov 2026). A later addition.
*   **Search and mark** (item REV-10 of `docs/Implementation-Plan.md`; author,
    28 Nov 2026). A later addition.
*   **A time limit on a rule, a page or a run** (author, 28 Nov 2026). The
    user stops a run that takes too long.
*   **Labels that are column headers of a table** (author, 28 Nov 2026). A
    value under a header such as "Account No" is found only if a rule does
    not need the label. How to read table columns is a separate discussion.
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

The design decisions are in the Technical Plan, section 10. These points are
still open. The first three are settled by measurement in slice C0; the last
two wait for the author.

*   **Labels on the same row.** A spike on a flattened form, and on a table
    whose labels sit in the same row as their values, decides whether "label
    within N characters" is enough, or a rule also needs "label on the same
    row", worked out from the characters' boxes. If it does, the rule gains a
    field and the `page` message carries boxes.
*   **The slow-pattern checker.** C0 compares the available tools and decides
    whether a pattern the tool cannot judge fails the pack build.
*   **A line end inside an identifier.** C0 measures how often an identifier
    is broken across lines and decides whether a separator may be followed by
    a line end.
*   **IMEI's pack.** It is in `legal`, as the author approved with the first
    draft. The first design review proposed moving it to `universal`. It
    stays in `legal` unless the author moves it before slice PX starts.
*   **The unit tests before the panel exists.** Slices C1, W1 and E1 add four
    unit test files, because no screen exists yet to test through. Each is an
    exception to "browser tests first"; they are written as listed unless the
    author strikes one.

Slice C0 also takes these measurements and checks, whose results are written
into "C0 results and rules left out": the 100-page run on both builds (G4);
approving a document with about 5,000 marks; the check-digit facts the
author's workbook marks "from memory"; whether the ABHA number has a check
digit; the disagreements between sources on the UTR and the voter ID; an
official list of UPI handles; whether the keyword lists of Microsoft Purview
may be copied.

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
    finding to another of its candidates, picks "Remove more" on a third, and
    shortens the edge of a fourth.
*   **Then**: on confirm, the unticked value becomes a rejected value: it
    stays in the file and is not offered again in this document. The user
    never has to choose an identifier: each finding has a default, which stays
    unless the user picks another. A shortened edge applies in every place of
    the value. "Remove more" and a lengthened edge mark the wider text in each
    place where it is present, and the value as found in the other places.
    Every place gets one mark.

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
    the hand mark covers in part is not offered either, and one line says: "1
    found value overlaps a mark already made and was not offered." If nothing
    is new, no panel opens and one line says so.

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

*   **Given**: a new identifier whose format is verified against the body
    that issues it.
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
| `tools` (new) | `tools/**/*.ts` | `model`, `detect-protocol`, `detect`, `core` | The pack compiler and the command-line detector |
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
| to the worker | `page` | `run`, `page`, `chars`. If slice C0 finds that a rule needs "label on the same row", also each character's box |
| from the worker | `ready` | `run`, each loaded pack's id and version |
| from the worker | `hits` | `run`, `page`, `hits`, `errors` (how many values met an error in a check) |
| from the worker | `failed` | `run`, `code` (`recognizer-failed` when the packs could not be loaded) |

A reply whose `run` is not the current one is ignored. A worker that stops
answering through an error of its own is seen through the channel's error
event, with the code `detector-failed`.

**Finding** (made by the resolver, never stored). `key`, `text` (as written
at the first place), `places`, `candidates`, `chosen` (which candidate),
`edge` (section 4), `level` (the chosen candidate's), `reasons` (its evidence,
for the panel's sentence), `ticked`. A candidate is the same across places
when it has the same identifier and the same key.

**Resolver** (`engine/model`, pure). Input: the hits of one ended run, the
document's marks without its lost marks, its rejected values, and the changes
the user made in the open findings review. It needs no page text, because each
hit carries its own. Output: the findings, and the number of places left out
in step 1. In order:

1.  Drop a hit that any text mark overlaps, even in part (decision D11). This
    is what makes a later run skip accepted values and hand marks, and what
    keeps Auto mode from ever making an overlapping mark. A mark that is lost,
    meaning it could not be placed after a reader change, is not counted: its
    stored positions point at other characters.
2.  Drop a hit whose key is one of the document's rejected values.
3.  At each place, join overlapping hits into one set of candidates. The
    default candidate is the one with the strongest evidence; a longer
    candidate is the default only if its evidence is at least as strong (brief
    S27). Between two identifiers for the same span, the stronger evidence
    wins, then the order of the packs (section 6), then the order of the rules
    in the pack (brief S39).
4.  Join places whose default candidates share a key into one finding (brief
    S10, S36). A finding has one identifier: the one with the strongest
    evidence at any of its places.
5.  Apply the user's stored changes by key, and drop a change whose finding
    no longer exists. If two findings now have the same key, they become one;
    the merged finding is ticked if either was.
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
| `findings.choose` | `document`, `key`, `candidate` (its index) | Picks another candidate: another identifier for the same span, a wider span ("Remove more") or a narrower one ("Remove less") |
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
interface Candidate { identifier: MarkType; key: string; level: EvidenceLevel; reasons: Evidence[]; places: number }
interface Finding {
  key: string; text: string; places: FindingPlace[];
  candidates: Candidate[]; chosen: number; edge?: string;
  level: EvidenceLevel; reasons: Evidence[]; ticked: boolean;
}
/** What the user changed in an open findings review, by finding key. */
interface FindingChange { ticked?: boolean; candidate?: { identifier: MarkType; key: string }; edge?: string }

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
  findings?: { findings: Finding[]; notSearched: PageIndex[]; leftOut: number };
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
   |<-------------+ could not start or load       | every finding now overlaps
   |              | (a line gives the error)      |   a mark: ends by itself
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
*   If marks spread in from another document's approval come to overlap every
    finding of an open findings review, it ends by itself, and its stored
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

**What an accepted finding marks: one mark per place** (decision D11, author,
28 Nov 2026). Auto mode never makes two marks that overlap.

*   At each place the mark covers the chosen candidate's span, where that
    candidate exists at the place, and the default candidate's span elsewhere.
*   The mark carries the chosen candidate's identifier as its type.
*   A wider span is not used at a place where it would overlap an existing
    mark or another finding. The default span is used there.
*   So a finding whose wider choice is present in 12 of its 15 places makes 12
    marks of the wider text and 3 of the value as found. These are two values
    in the marks panel and for spreading. The findings panel says: "Wider in
    12 of 15 places."

The cost is stated under Risks: where a wider mark covers an identifier, that
identifier has no mark of its own in that place.

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
*   If a shorter span makes a finding's key equal to another finding's key,
    the two become one (resolver, step 5).

A finding never splits in the panel, and it is accepted or rejected for all
its places (brief S36).

**A found value that overlaps an existing mark is not offered** (decision D11,
author, 28 Nov 2026). A hand mark on `45-6789` means the SSN `123-45-6789`
around it is left out, and the panel or the Run control says: "1 place
overlaps a mark already made and was left out." The user widens their own
mark if the rest should go. The same rule keeps a finding the user narrowed
from being offered again: the full value overlaps the mark that was kept.

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
    deletes, the findings review reopens, the resolver finds that every hit
    overlaps a mark or is rejected, and it ends by itself.
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
*   **Lists** are committed snapshots with a source and a date (bank codes,
    UPI handles, court case-type codes). A list raises a hit to `checked`; a
    value missing from the list keeps its other evidence.
*   **Loading.** The compiled packs and lists are part of the worker's
    script. The worker uses the packs the `load` message names. Nothing is
    fetched because of a matched value, since that fetch would signal a
    finding.
*   **The pack build** runs in `pnpm test:tools`. It checks every pattern for
    slow shapes after the named pieces are expanded, and has a negative
    control: a known slow pattern must fail. Whether a pattern the checker
    cannot judge fails the build is settled in slice C0.
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
*   **Shapes for the writer.** Marks that touch, marks that cross a line end,
    and hundreds on a page, each judged by the outside checker (G17, brief
    A12).
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
*   **The command-line detector** (G19) is checked in `pnpm test:tools`: it
    runs on a committed, synthetic stored page-text file and must give a
    committed list of hits.

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
| D11 | Marks that overlap | Auto mode makes none. One mark per place. A found value that an existing mark overlaps is not offered | 28 Nov 2026, after the second design review. The author first chose two marks |
| D12 | Ending a findings review | Confirm and Close each ask in a dialog | 28 Nov 2026 |
| D13 | Does undo restore rejected values | No. Undo covers marks only | 28 Nov 2026 |
| D14 | A value that lies inside a wider mark, at approval | Approval counts it as marked in that document | 28 Nov 2026 |
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
*   The compiled JSON is committed, and `pnpm test:tools` runs the compiler
    with `--check`, which fails when the JSON is out of date, as
    `tools/arlington/generate.py --check` already does.
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
    lines. Slice C0 measures how often this happens in statements and forms
    and decides whether a separator may be followed by a line end (Risks).

**What follows from D14**

*   Today, approving a document stops hiding any project value that the
    document's text contains but that the document neither marks nor lists
    under "Don't hide here" (`engine/model/spread.ts`). A value that lies
    inside a wider mark, such as an account number inside a marked "sort code
    and account number", is such a value: approval concludes the user
    un-marked it and removes its marks from every document.
*   The change: a place that one of the approving document's own text marks
    covers counts as marked there.
*   This is a change to approval from Phase 3. It does not touch the writer.
    It comes with a browser test in `tests/e2e/spreading.spec.ts` whose
    downloads the outside checker judges: the inner value is still removed
    from the other document after the approval.

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
    review, for that cost. Since the second design review a found value that
    overlaps a mark is not offered at all (D11).

#### 23. A longer edge that fits only some places splits the finding in two (D11)

*   **Pros**: Each finding has exactly one text.
*   **Cons**: The wider text becomes the value where it fits, so the
    identifier inside it has no mark of its own there and stops spreading. The
    split also needs a notice and rules for the two halves.
*   **Reason for Rejection**: Rejected by author, who had first approved it.
    After the first design review it gave way to two marks (alternative 54).
    After the second, each place gets one mark, wider where the wider text is
    present, and the finding stays one row in the panel (D11).

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
    proposed it: one slice builds the tool (G19).

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
    review: overlap has too many edge cases, in this phase and for the later
    pseudonymisation phase. One mark per place.

#### 55. Joining overlapping marks into one before the writer sees them (D11)

*   **Pros**: Overlapping marks could exist, and the writer would still
    receive ranges that do not overlap.
*   **Cons**: It changes what the write path is given, so it needs a new leak
    fixture judged by the outside checker, and a rule for which label a joined
    range prints.
*   **Reason for Rejection**: Rejected by author with alternative 54.

#### 56. Offering a found value that overlaps an existing mark, locked and unticked (D11)

*   **Pros**: The user sees exactly which values were held back.
*   **Cons**: Rows that cannot be ticked are one more kind of row to build and
    test.
*   **Reason for Rejection**: Rejected by author: such values are left out,
    and one line gives their number.

#### 57. Leaving approval as it is and recording the risk (D14)

*   **Pros**: No change to approval code that works today.
*   **Cons**: Approving a document that marks a combined value can remove
    another document's marks for a value inside it, without saying so.
*   **Reason for Rejection**: Rejected by author: it leaves a value in another
    file. Approval is changed.

#### 58. Removing "Remove more" and outward edge moves (D14)

*   **Pros**: Auto mode would never mark wider than what a rule found.
*   **Cons**: Rules that find a combined value, such as a sort code with an
    account number, and hand marks would still cover a shorter value.
*   **Reason for Rejection**: Rejected by author: it reduces the case without
    removing it.

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

## Risks and Mitigations

Each line gives the risk and either what reduces it or that its cost is
accepted. A missed value is the worst error, so those come first.

| Risk | What reduces it, or the accepted cost |
| --- | --- |
| A rule misses a way of writing an identifier | Every fixture plants each number written in seven ways; the pack test fails on a miss (G1). Rules and keys share one set of separators |
| An identifier broken across a line end is not found | Measured and decided in slice C0. Until then: accepted |
| A value under a table's column header is missed, because its rule needs a label and the header is far away in reading order | Accepted for this phase (Non-Goals). C0's spike covers labels beside a value and in the same row |
| The user leaves a country or industry out of the profile, and its identifiers are not searched | A new project has no profile; the first run asks, and the chooser lists what each choice adds. A wrong choice still misses: accepted |
| A found value overlaps a mark already made and is not offered, so the rest of that value stays in the file | One line gives the number of places left out. The user widens their own mark. Accepted by the author |
| Found values stay in the file because the user closed the panel, approved with the panel open, or downloaded during a findings review | Close and the approval dialog state the number of found values that stay. The panel says that found values are removed only once confirmed. Accepted by the author |
| A pattern runs for minutes on one page | The pack build fails on slow shapes, with a negative control. The run shows its page; Stop keeps the findings of earlier pages and says which pages were not searched. Those pages stay unsearched until the rule is fixed: accepted |
| A check function fails with an error on a value that is in fact valid | The value is not offered. The error is counted in the run record, and a pack's browser test would catch a rule that fails on its own examples. Accepted |
| The user unticks a value by mistake and confirms | It is not offered again in that document. The user marks it by hand. A view of rejected values is a future improvement |
| Confirming marks a value the user had chosen "Don't hide here" for | It is the user's choice to reverse it (D15). Accepted by the author |
| Where the user chose a wider span, the identifier inside it has no mark of its own in that place | The identifier is still marked where the wider text is absent, and D14 keeps approval from un-hiding it. If every place is wider, the bare identifier is not spread from this document: accepted |
| One value written two ways, in letters and digits, is two findings | Each is ticked by default, so both are removed unless the user unticks one. Hand marks split the same way today: accepted |
| A reader change, or a replaced original file, drops an open findings review with its unticks and edits | A stored notice tells the user why and offers a run. Accepted by the author |
| An older build opens a project and saves it | Its parser keeps only the fields it knows, so the profile and the rejected values are dropped and nothing tells the user. Accepted while the author is the only user (D2) |
| The four medical rules and the court case rule have United States formats, yet run for any country when their industry is chosen | A few extra findings on a non-US file, all needing a label. Accepted until those packs gain other countries' rules |
| An identifier's format cannot be verified against the body that issues it | The rule is left out and listed under "C0 results and rules left out" |
| The type list grows from 14 names to 73 | The picker groups them and filters as the user types (slice U1). The benchmark work must accept the longer list |
| The undo of a findings review is lost on reload, on approval, and when another document's approval spreads marks in | It is how every undo step works today. Stated in CUJ 6 |

**A fault that exists today and is outside this phase.** Two hand marks can
overlap. When the user has chosen to print each mark's type in its box, the
writer's check then fails and Preview and Download are refused for that
document. Nothing leaks, since the writer refuses. The second design review
found this while examining overlapping marks. It is reported to the author as
its own piece of work and is not fixed here.

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

*   `docs/designs/auto-mode-brief.md`: the brainstorm's brief, with its
    decision register.
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
to read this document: the workbook the 65 identifiers were chosen from, and
the reports of the two design reviews.

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
| A merged finding can offer wider alternatives beside the default | It can, and each place still gets one mark | D11 |
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
| Two marks for one finding failed the writer's check with labels on | One mark per place; no overlapping marks (D11) |
| A wider mark could make approval stop hiding the value inside it | Approval counts a covered value as marked (D14) |
| A lost mark could turn a confirmed finding into a leak | The new marks take the place of lost marks with the same letters |
| The reader-change notice was deleted by the cleanup rule | The notice is its own kind of state file; the state file is tied to its run |
| An error on one page discarded every finding | An error costs one value; a worker failure ends the run early (D17) |
| Nothing said where the resolver runs, or what closing a project does to a run | Section 3, "Where the resolver runs"; the worker belongs to the Session |
| The first slices could not pass the tests or the audit | The schema change moves to the picker's slice; a stated exemption covers code not yet used or reached by a browser test |
| Several slices left out files they must edit, and the tools' build was not written down | The file lists and the build config are in the Detailed Implementation Plan |

### Future Improvements

*   **Model recognizers:** a new recognizer, the second stage with its state
    and storage, and one undo covering both stages.
*   **Patterns a user writes,** on their own design.
*   **Search and mark.**
*   **Labels that are column headers.**
*   **Marks that overlap,** if pseudonymisation needs them.
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
 +--> M1 approval counts a covered value
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
             +--> T1 detection from the command line

Z1 closing checks: waits for every slice above
```

| Id | Slice | Waits for |
| --- | --- | --- |
| C0 | Spikes and checks | none |
| C1 | Contracts | C0 |
| M1 | Approval counts a covered value | C1 |
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
| T1 | Detection from the command line | P0 |
| Z1 | Closing checks | all |

After C1, the slices M1, U1, W1 and E1 run at once. After V1, the slices R1,
W2 and P0 run at once. After P0, the six pack slices and T1 run beside R2 and
R3. There are 21 slices.

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
test. T1 is a tool and is checked in `pnpm test:tools`. No test is added in a
skipped or expected-to-fail state.

**The audit exemption** (author, 28 Nov 2026). `pnpm exec fallow audit` fails
a change that adds a file or an export nothing uses, and it scores each
function against the coverage of the browser tests. A hook blocks a commit on
that verdict. The slices before V1 add code that nothing uses yet and that no
browser test reaches, on purpose. So:

*   `.fallowrc.json` gains a block, marked with a comment naming this
    section: `ignoreExports` entries for the listed files, and an `overrides`
    entry that lowers the health findings of the listed files to a warning.
*   C1, W1 and E1 each add their own files to that block. The files are named
    in each slice's table.
*   V1 removes the block. From V1 on every file is imported by the app and
    reached by `auto-run.spec.ts`.
*   The tool entries are different: nothing imports them, ever, because they
    are run from the command line. P0 lists them under `entry`, to stay.
*   Slice C0 confirms these keys by running the audit on a branch with one
    unused file, one untested function and one tool entry.

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
    pattern: '([A-Z]{4}0[A-Z0-9]{6})'
    value: 1                      # which group is the value
    needs: checked                # checked | labelled | format
    labels: ["IFSC", "IFSC Code"]
    labelSide: before             # before | after | either
    distance: 40
    notNextTo: letter-or-digit    # letter | digit | letter-or-digit
    validator: null
    list: { name: in-bank-codes, part: [0, 4] }
    companion: null               # or { rule: in-ifsc, distance: 200 }
    yieldsTo: []
    source: "https://..."
    licence: "public specification"
    verified: { date: 2026-12-01, at: "https://..." }
    examples: ["HDFC0001234"]
    nearMisses: ["HDFC1001234"]
```

*   **Named pieces.** A pattern may use `{sep}` for one separator and `{sep?}`
    for one optional separator. The compiler expands both from the matcher's
    joiner class. No other piece exists in this phase.
*   **How a label matches.** A label is compared with the page text after
    both pass through `normalise`, so case and spacing do not matter. It must
    lie on the stated side of the value, within `distance` characters of the
    text view, and in the same block. If slice C0 finds that "same row" is
    needed, the rule gains `labelRow: true`.
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
| Places left out | "{n} places overlap marks already made and were left out." | R1 |
| Stopped | "Stopped. Pages {a} to {b} were not searched." | V1 |
| Ended early | "The run ended early because of an error. Pages {a} to {b} were not searched." | W2 |
| `detector-not-started` | "Auto mode could not start. Try again." | C1 |
| `recognizer-failed` | "Auto mode could not load its rules. Try again." | C1 |
| `detector-failed` | "Auto mode stopped because of an error." | C1 |
| Wider span | "Wider in {a} of {b} places." | R3 |
| Candidate picker | "Remove more", "Remove less", "Other possible types ({n})" | R3 |
| Notice, `reader-changed` | "The found values of this document were dropped, because an update changed how the app reads PDFs. Your unticks and edits were not kept. Run Auto mode to find them again." | R2 |
| Notice, `text-changed` | "The found values of this document were dropped, because its text changed. Run Auto mode to find them again." | R2 |
| Type picker | "Add '{name}' as a new type" | U1 |

The other new error codes are refusals the app never shows, and join that
group in `engine/api/errors.ts`.

#### The tools' build

The two TypeScript tools import engine sources, whose imports carry no file
extensions, so Node cannot load them as they are. No runner is added. Vite
builds each tool into one file for Node. This config was tried on 28 Nov 2026
with a tool that imports `engine/model/match.ts`; it wrote `compile.mjs` and
`detect.mjs`, and both ran under Node 24.

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
      input: { compile: "tools/packs/compile.ts" }, // T1 adds: detect: "tools/detect/run.ts"
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
| `test:tools` | gains `pnpm build:tools && node tools/.build/compile.mjs --check && uv run --project tests/oracle python tests/oracle/make_pack_fixtures.py --check` | P0 |
| `test:tools` | gains `node tools/.build/detect.mjs tools/detect/fixtures/card.text.json --expect tools/detect/fixtures/card.hits.jsonl` | T1 |
| `report:review-cost` | `playwright test --grep @report` | Z1 |

`--check` on the compiler fails when the committed JSON differs from what it
would write. `--check` on the fixture generator fails when a committed PDF or
truth file differs from what it would write, and when a positive example fails
python-stdnum's check or a near-miss passes it. The generator's own tests run
with the existing `uv run --project tests/oracle python -m pytest tests/oracle
-q`. The golden files are recorded with `GOLDEN_UPDATE=1 pnpm exec playwright
test golden`.

#### C0 results and rules left out

Empty until slice C0 writes its results here. Each pack slice adds the rules
it left out, with the reason.

### 3. Target files, by slice

#### C0. Spikes and checks

No application code. It changes only this document.

| Work | What it settles |
| --- | --- |
| Write trial patterns for the 23 identifiers with a validator and run them, with their checks, over a 100-page text in a Chrome worker, on the production build and on the instrumented build | The production time against G4, and the limit of the speed test |
| Try label rules on `fixtures/form.pdf` and on a table whose labels sit in the same row as their values | Whether a rule needs `labelRow`, and so whether the `page` message carries boxes. C1 and P0 follow the answer |
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

#### M1. Approval counts a covered value

Browser test first, in `tests/e2e/spreading.spec.ts`: document A marks an
account number; document B marks a longer text that contains it; approving B
leaves the account number removed from A's download, judged by the outside
checker.

| File | Action | What changes and why |
| --- | --- | --- |
| `tests/e2e/spreading.spec.ts` | Modify | The test above |
| `engine/model/spread.ts` | Modify | In `approve`, a place that one of the approving document's own text marks covers is not counted as "found here without a mark" (D14) |
| `engine/model/spread.test.ts` | Modify | An existing unit test file: the same case beside its neighbours |

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
| `engine/core/session/facade.test.ts` | Modify | A run on a document with stored text gives findings. A hit that a mark overlaps is dropped and counted. A hit of a rejected value is dropped. A lost mark does not count as overlapping. A second run is refused. Approval is refused during a run. A run without a profile is refused. A stopped run and a run whose worker failed both keep the hits of the pages searched. Closing the Session stops a run |
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
*   A value that a hand mark overlaps in part is not offered, and the line
    with the number of places left out is shown.
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
| `app/FindingsPanel.tsx` | Modify | The confirm button with its label, Close, the line of places left out |
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
answers with prepared hits, some overlapping.

*   Change a finding's identifier to another candidate: the mark carries the
    new name.
*   Pick "Remove more" on a finding whose wider candidate is present in 2 of
    its 3 places: after confirming, each place has one mark, two of the wider
    text and one of the value as found, and the panel said "Wider in 2 of 3
    places."
*   Shorten an edge and see every place change.
*   Lengthen an edge whose added text is present in some places: the same
    result as "Remove more".
*   A wider span that would overlap a hand mark is not used at that place.
*   Make two findings equal and see one, ticked if either was.
*   The download passes the outside checker.

| File | Action | What changes and why |
| --- | --- | --- |
| `tests/e2e/auto-edit.spec.ts` | Create | The cases above |
| `engine/model/edges.ts` | Create | The new span's normalised text, and the search for it at each place through `normalise`'s map |
| `engine/model/resolver.ts` | Modify | Applies the chosen candidate and the edge; joins findings whose keys became equal |
| `engine/model/findingMarks.ts` | Modify | The span at each place: the chosen one where present and overlapping nothing, the default elsewhere |
| `engine/core/session/effects/findings.ts` | Modify | `choose` and `setEdges` |
| `engine/core/session/slices/findings.ts` | Modify | Stores those changes |
| `app/FindingRow.tsx` | Modify | The candidate picker: candidates at least as strong as the default, then "Other possible types ({n})"; "Remove more" and "Remove less" |
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
| `tools/packs/slow.ts` | Create | The slow-pattern check chosen in C0, with its negative control |
| `tools/packs/README.md` | Create | How to add a rule |
| `tools/tsconfig.json`, `tools/vite.config.ts` | Create | As written in section 2 |
| `tests/oracle/make_pack_fixtures.py` | Create | Reads the YAML with PyYAML; lays out each rule's examples as a PDF with labels, each number written in the seven ways, using `make_fixtures.py`'s PDF helpers; writes the truth file; `--check` |
| `tests/oracle/pyproject.toml`, `uv.lock` | Modify | PyYAML and python-stdnum, each pinned to one version |
| `tests/oracle/tests/test_make_pack_fixtures.py` | Create | The generator's tests |
| `tools/README.md`, `tests/oracle/README.md` | Modify | The new tools |
| `package.json`, `pnpm-lock.yaml` | Modify | `yaml` and the slow-pattern checker as development dependencies; the scripts of section 2 |
| `.gitignore` | Modify | `tools/.build/` |
| `.fallowrc.json` | Modify | Zone `tools` and its rule; `tools/packs/compile.ts` under `entry` |
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
only when its format is verified against the body that issues the identifier,
by C0 for the facts C0 lists and otherwise in the slice, and recorded in the
rule's `verified` field. A rule left out is listed under "C0 results and rules
left out".

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

#### T1. Detection from the command line

```text
node tools/.build/detect.mjs <stored page-text file> [--profile us,finance] [--expect <file>]
```

Without `--profile` the run uses `universal` only. The output is one JSON
object per line:

```json
{"page":0,"start":12,"end":31,"text":"...","identifier":"payment-card"}
```

With `--expect` the tool compares its output with the file and exits with an
error on a difference.

| File | Action | What changes and why |
| --- | --- | --- |
| `tools/detect/run.ts` | Create | Reads the stored page-text file with the app's own parser, taking the number of pages from the file. Sends `load` and each `page` to the worker's own handler, `engine/detect/handler.ts`, and prints the hits. It therefore runs the same code the worker runs, without a worker or a browser (G19) |
| `tools/detect/README.md` | Create | How to run it on a project's stored text |
| `tools/detect/fixtures/card.text.json`, `card.hits.jsonl` | Create | The stored page text of `fixtures/auto-card.pdf`, which is synthetic, and the one hit expected. If slice PX adds a rule that finds more on that page, PX regenerates the second file |
| `tools/vite.config.ts` | Modify | The entry `detect`, built from `tools/detect/run.ts` to `tools/.build/detect.mjs` |
| `.fallowrc.json` | Modify | `tools/detect/run.ts` under `entry` |
| `package.json` | Modify | `test:tools`, as section 2 lists |

The tool writes hits, not findings: it does not run the resolver and has no
marks to compare with. It does not write the dataset's ground-truth format,
which needs boxes and document fields it does not have; that belongs to the
benchmark work. It is never pointed at a real project in a test run.

**Done when** `pnpm test:tools` passes.

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
| G13 | `auto-review` (a rejected value, an overlapped value), `auto-stored` (a later run) |
| G16 | `network`, `bundle` |
| G17 | `auto-review` and `auto-edit`, through the outside checker |
| G19 | `test:tools` |
| G20 | `review-cost` |
| G22 | `auto-review` (an overlapped value is not offered), `auto-edit` (one mark per place) |
| D14 | `spreading` |

--------------------------------------------------------------------------------

*Drafted with EGM*
