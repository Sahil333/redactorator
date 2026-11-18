# Stage 9: Implementation Readiness Test (round 1)

**Target:** `docs/Implementation-Plan.md` (lines 1-241). This is the implementation range for `docs/HLD.md`.
**Background files given to reviewers:** `docs/HLD.md`, `docs/PRD.md`, `docs/images/plan-tracks.png` and `docs/images/hld-architecture.png`. The plan's two claude.ai links are covered by the local PRD and HLD. Its three dataset web links were left out, per the "local files only" choice.
**Standard:** `implementation-readiness-standard.md`, applied by the implementation-readiness and codebase-details reviewers. The style reviewer used its persona rules only.

## Reviewer status

| Reviewer | Status | Raw findings |
| --- | --- | --- |
| `egm-implementation-readiness` | completed | 6 Blocker, 11 Major, 5 Nit |
| `egm-codebase-details` | completed | 4 Blocker, 12 Major, 4 Nit |
| `egm-style` | completed | 0 Blocker, 3 Major, 7 Nit |

**After merging overlaps: 6 Blockers, 15 Majors, 10 Nits.** The implementation-readiness and codebase-details reviewers each reached the verdict **not ready**.

## What the verdict means

The plan works as a **roadmap**. It gives a good order of work, a clear testing approach, an exit condition for every phase, and a dataset track and a spike track running alongside the build.

The standard under test asks for something else: an **executable plan**. That means:

- exact file paths for each phase;
- defined types and data contracts;
- pinned dependencies;
- no design decisions left to whoever builds it.

The plan does not aim for that level, so most Blockers below are about missing detail, not wrong design. Two ways to respond:

- **Add the detail to this document.** This works for Phases 0-2.
- **Keep this as a roadmap, and require a short detailed plan before each phase starts.** For Phases 3-8 this is cheaper, and it fits the plan's own "waits for" structure.

## A finding the reviewers could not see

The main context confirmed `.gitignore` lists `poc/`. Then it tried to check whether the POC exists in the main checkout, and a project hook (`.claude/hooks/block-poc.sh`) blocked the attempt with: "poc/ is off limits. Do not read, search, run or edit anything in it."

This matters for **B3**:

- HLD line 96 ("Do not use or read anything from that POC code") is not a stray sentence. It matches a rule enforced in the tooling.
- The plan, however, makes the POC's `verify.py` the test checker "from day one" (plan L66). It also pre-labels documents with the POC (L131) and places the dataset generator "beside the POC" (L113).
- If agents will build this, the plan as written requires them to run code they are blocked from touching.

So B3 is a real conflict in how the project is set up, not only a wording issue.

**Limits.** No reviewer could see the POC. So none of these could be checked:

- the 27 leak vectors and their numbering;
- what `verify.py` checks;
- the fixtures;
- the PyMuPDF version that is "pinned";
- the baseline numbers.

Claims about library behaviour that the reviewers made from their own knowledge are marked *[unverified]*.

**Plan lines the main context spot-checked:**

| Line | What it says |
| --- | --- |
| L11 | "Each phase ends with a browser test that runs in CI" |
| L29 | The spike track starts "in week one", although L15 says no durations are given |
| L49 | "One repository", although L238 leaves the repository question open |
| L66 | `verify.py` is the test checker |
| L73 | Leak vector 10 is "box over part of an embedded image", although HLD L118 calls vectors 3 and 10 scans that already have an OCR layer |
| L78 | "Phase 1's tests answer both" questions about MuPDF.js parity |
| L144 | "Both spikes", although the diagram shows three |
| L172 | Marks spread to "every exact match", although HLD L217 uses a normalised value |
| L182 | Phase 7 has a "recall target" that is never defined |
| L207 | "A drop in recall on any type fails" the build, with no tolerance |
| L236-241 | Open questions: hosting, repository, recall targets, devices, labellers |

---

## 🔴 Blockers

### B1. No file boundary, and no decision on which repository the work goes into
- **Ids:** `readiness-1-1`, `codebase-1-B1`
- **Scope:** L49-50, L113, L146, L237-238, and every phase section
- **Problem:**
  - The plan names five directories and not a single file.
  - These have no home at all:
    - the dataset generator, ground-truth validator, benchmark page and comparison script;
    - the CI workflow;
    - the Vite and Playwright configs;
    - the worker entry point;
    - the contracts module.
  - L49 says "one repository", but L238 asks whether to open a new public AGPL repository and keep the POC private.
  - This repository holds only the docs.
- **Recommendation:**
  - Settle L238 first.
  - Then add a file list per phase, marked Create, Modify or Delete, naming which repository each file goes in.
  - Use globs only for generated output.
  - At minimum, do this for Phases 0-2.

### B2. The stage contracts, the `DocumentModel` and the worker messages are never defined
- **Ids:** `readiness-1-2`, `codebase-1-B3`
- **Scope:** L23, L33, L49-62, L172-184; HLD L31-53
- **Problem:**
  - Every phase plugs in behind "the HLD's contracts", but the HLD gives only names and language-neutral sketches of them.
  - Phase 1 already needs concrete versions of:
    - a `DocumentModel` with a box for each character;
    - a mark or `Edit` type that covers both text ranges and free boxes;
    - a way to hand the removed values to the verifier;
    - the messages between the UI and the worker, including error and progress messages.
  - The coordinate convention is not stated. The rotated and cropped test (L74) depends on it.
- **Recommendation:**
  - Put exact TypeScript interfaces in the plan, or in a named file such as `engine/contracts.ts`, covering `DocumentModel`, `TextBlock`, `Anchor`, `Box` (with its origin and space), `Finding`, `Decision`, `Edit`, `FormatAdapter`, `Detector` and `VerifyResult`.
  - Add the union type for worker messages.
  - Say which of these Phase 1 implements.
  - This also covers Stage 8 W2: write the contracts as TypeScript, not in neutral notation.

### B3. The test checker is POC code that the HLD and the project's tooling both forbid using
- **Ids:** `readiness-1-3`, `codebase-1-B2`, `codebase-1-M1`, plus the main context's hook finding
- **Scope:** L21, L36, L66, L70-78, L113, L131, L152, L197, L238; HLD L96, L118
- **Problem:**
  - **It is forbidden.** HLD L96 and the `block-poc.sh` hook both put the POC off limits. The plan never acknowledges this.
  - **It is unlocated.** No path, commit, Python version or pinned PyMuPDF and pdfminer.six versions are given.
  - **Public CI cannot reach it.** If the POC stays private (L238), the public CI has no stated way to get `verify.py`.
  - **Its interface is undefined.** The command-line wrapper has no arguments, input or output format, exit codes, or setup in CI.
  - **It does not cover the HLD's verifier.** The checker searches text, raw streams, metadata and annotations. The HLD verifier also needs:
    - no text under any box;
    - links, form fields and bookmarks;
    - scripts, attachments and thumbnails;
    - a pixel check;
    - a single-revision check.
  - **It is not independent.** PyMuPDF and MuPDF.js share the MuPDF core, so only pdfminer.six is truly separate from the app.
  - **The vector numbers disagree.** Vector 10 is "box over an embedded image" in the plan (L73) but "scan with an existing OCR layer" in HLD L118.
- **Recommendation:** Decide which way it goes.
  - **Option A: allow the checker.** Allow `verify.py` as a test checker only, and change both HLD L96 and the hook's scope to match. Then:
    - copy the parts used into a named path, such as `tests/oracle/`, with a pinned commit;
    - specify the wrapper's command line;
    - say how CI provides Python;
    - declare a leak if either extractor finds the value.
  - **Option B: replace the checker.** Build a checker that does not depend on the POC, such as pdfminer.six with a raw-object scanner, written from a leak-vector list that is copied into this repository.

  Either way, write out the 27-vector table (ID, carrier, fixture, assertion) in the repository, and fix the numbering.

### B4. Dependency and platform choices are left to whoever builds it
- **Ids:** `codebase-1-B4`, `readiness-1-4`
- **Scope:** L50, L172, L184, L237; HLD L348 and L351
- **Problem:** Each of these blocks the phase that first needs it:

  | Missing choice | Needed by |
  | --- | --- |
  | UI framework (HLD: "the team's choice") | Phase 0 |
  | CI provider | Phase 0 |
  | Package manager and Node version | Phase 0 |
  | Static host for preview builds (L50 says Phase 0, L237 says open) | Phase 0 |
  | Exact MuPDF.js version (the HLD's mitigation for the 1.28 text-shift risk is "pin the version") | Phase 1 |
  | Playwright, PDF.js, Tesseract.js and Transformers.js versions | Phase 1 onward |
  | Storage engine | Phase 2 |
  | YAML parser for rule packs | Phase 4 |
  | Accounts API language, database and host | Phase 8 |
  | Where the closed Accounts API code lives | Phase 8 |

- **Recommendation:** Add a table of pinned dependencies (package, exact version, purpose, phase). Fill in the CI provider, host and storage engine. Turn anything that cannot be decided now into a gate on its phase, with a named owner.

### B5. The ground-truth schema is a sketch in prose, but Phase 1 must produce it
- **Ids:** `readiness-1-5`, `codebase-1-M6` (raised to Blocker because Phase 1 depends on it)
- **Scope:** L62, L76, L86-93, L109-111, L140
- **Problem:**
  - The schema has no field names, types, list of entity types, version field or validator.
  - Character offsets are taken "in the extracted text", but three different extractors are in play, and they can disagree on reading order, whitespace and ligatures. So the labels will not line up with the app's findings:
    - the generator uses PyMuPDF;
    - the app uses MuPDF.js;
    - the pre-labeller uses the POC.
  - The box origin and how rotation is handled are not stated.
  - The Phase 1 labelling screen needs an entity-type picker, link ids and hidden occurrences, and none of these is among Phase 1's steps.
  - *[unverified]* PyMuPDF does not report glyph boxes as it draws text. "Record every glyph's box as it is drawn" (L109) probably means re-extracting the text afterwards.
- **Recommendation:**
  - Put a JSON Schema at a named path, such as `fixtures/schema/ground-truth.schema.json`.
  - Fix the list of entity types, taken from PRD DET-1, and add a mapping table from the Nemotron, Gretel and TAB labels.
  - Name the one extractor whose offsets are authoritative, or make boxes the authority.
  - State the coordinate convention.
  - Add the labelling-screen elements to Phase 1.

### B6. Phase 2 storage and encryption are unspecified, and the key model the HLD describes cannot work
- **Ids:** `readiness-1-6`, `codebase-1-M3` *(Stages 5, 7 and 8: S5 M2/M10, S7 B2/M7, S8 F2/F3)*
- **Scope:** L172; HLD L204, L381-394
- **Problem:**
  - **The store is undefined.** Phase 2 does not say:
    - what `set.db` is;
    - what gets encrypted, and in what units;
    - how AES-GCM nonces are chosen;
    - where the key lives between sessions;
    - which key-derivation function the passphrase uses;
    - the export format;
    - what purge removes.
  - **The key model fails.** Export needs a key that can leave the browser, but HLD L204's non-extractable key cannot be wrapped by Web Crypto's `wrapKey`.
  - **WebKit may not cope.** *[unverified]* WebKit has had limited support for OPFS writes, and Phase 2's exit condition requires WebKit.
  - **Key properties are untested.** Nothing checks that data at rest is encrypted, that purge works, or what happens with a wrong passphrase.
- **Recommendation:**
  - Use Stage 8's smallest form:
    - records in IndexedDB, encrypted per record;
    - originals and `DocumentModel`s in OPFS;
    - one data key, wrapped by a key derived from the passphrase with PBKDF2, or stored as a non-extractable key when no passphrase is set;
    - export re-encrypted under a key derived from an export passphrase.
  - Add a record schema for the HLD tables.
  - Add these tests:
    - scan the raw files for a known plaintext value and expect none;
    - purge, then confirm both the store and the key are gone;
    - a wrong passphrase fails cleanly.

---

## 🟡 Majors

### M1. The "done when" conditions disagree between the phase table and the phase sections
- **Ids:** `style-1-1`, `readiness-1-N21`
- **Scope:** L11, L31-41, L80, L172-184, L200, L205
- **Problem:** The table header and L11 say every phase ends with a browser test in CI. The phase sections set other bars:

  | Phase | Table | Phase section |
  | --- | --- | --- |
  | 1 | browser test in CI | needs a person outside the team (L80) |
  | 2 | one test | three tests, passing in Chromium and WebKit; pull-request CI runs Chromium only (L205) |
  | 5 | "restore exactly" | "no wrong restores" (L178) |
  | 6 | "scored and shown" | published numbers plus a banner on three physical devices, which run weekly, not in CI (L200) |
  | 7 | "no ink left under any box" | a recall target defined nowhere (L182) |

- **Recommendation:**
  - Give each phase one "done when" and copy it into the table word for word.
  - Retitle the column "Done when".
  - Mark manual checkpoints as manual.
  - Define the Phase 7 target, or add it to the open questions.

### M2. Phase 1 claims MuPDF.js parity is "answered", but its tests cover 6 of the 27 vectors
- **Ids:** `style-1-2`, `codebase-1-M2`, `readiness-1-8`
- **Scope:** L60-61, L78, L216, L227
- **Problem:**
  - L78 and L216 say Phase 1 settles parity. Phase 1 tests vectors 1, 9, 10, 11, 12 and 23. Full parity comes only in Phase 3 (L174).
  - Step 4 gives no MuPDF.js calls, options or save flags.
  - Step 5's "no text left under any box" has no algorithm: no extractor named, no box tolerance.
  - The HLD's PDF.js cross-check is not scheduled in any phase.
  - The image re-encode fallback is a "follow-up" with no phase and no design.
  - Box colour is hard-coded black, though RED-6 (P0) makes it configurable.
  - Nothing tests that untouched text keeps its position, despite the MuPDF 1.28 text-shift risk.
  - *[unverified]* The pinned version's typings may already answer whether MuPDF.js has the image-pixel option, before any code is written.
- **Recommendation:**
  - Reword L78 and L216: "a first parity signal on 6 of 27 vectors; full parity in Phase 3."
  - Name the exact MuPDF.js calls and options for the pinned version.
  - Define the verify algorithm and what the user sees on failure.
  - Schedule PDF.js.
  - Make the fallback a conditional Phase 1b task with its own tests.
  - Add a glyph-position test, which is Stage 8 F7's layout test.

### M3. The matching rule for spreading a mark contradicts the HLD, and edge cases are left out
- **Ids:** `readiness-1-9`, `codebase-1-M4` *(S6 #3, S7 M19, S8 F11)*
- **Scope:** L172-176; HLD L217, L227-228
- **Problem:**
  - The plan spreads a mark to every "exact match". The HLD links by a normalised value, by rules taken from the POC, which cannot be seen.
  - These cases are not decided:
    - word boundaries ("Ann" inside "Annual");
    - line breaks and hyphenation;
    - Unicode normalisation (NFC or NFKC) and ligatures;
    - whether a box drawn over text creates a text entity;
    - how Phase 3 matches a value inside metadata and encoded PDF strings.
  - The HLD rule that a box with no text behind it applies only to its own document has no test.
- **Recommendation:**
  - Write the normaliser as ordered steps, with a table of test cases.
  - State the word-boundary rule and the rule for a box drawn over text.
  - Specify how each hidden carrier is matched in Phase 3.
  - Add tests for a box with no text, a match across a line break, and matches that differ only in case or spacing.

### M4. Many P0 requirements and HLD MVP controls belong to no phase
- **Ids:** `readiness-1-10`, `codebase-1-M5`
- **Scope:** the whole build track, checked against the PRD and HLD
- **Problem:** No phase builds or tests these:

  | Area | Unscheduled items |
  | --- | --- |
  | Import | DOC-4 (encrypted or unknown files); DOC-5 (multi-file and folder import); TIFF from DOC-7 |
  | Review | REV-5, REV-6, REV-7 (undo, redo and autosave: "a crash loses no work"), REV-9, REV-10, REV-11 |
  | Redaction | RED-6 |
  | Working sets | SET-1, SET-3 |
  | Pseudonymisation | PSE-3; PSE-10 restore into `.txt` and `.md`; pseudonymised PDF output (HLD L74: fit the surrogate into the box) |
  | Records | AUD-1 |
  | Accounts | ACC-5, ACC-6 |
  | Configuration (P0 rows) | thresholds, strictness, detection depth, vault lock with auto-lock, hidden-content options |
  | Platform | WCAG 2.2 AA; Edge support |
  | Security controls | service worker and offline use; the CSP; the D9 MVP items (reproducible builds, a signed hash per release, the in-app hash); the HLD's "pipeline tested with the network blocked" |

- **Recommendation:** Add a table mapping each P0 requirement and HLD MVP control to a phase and a test. Mark the rest out of the MVP, with the PRD owner's agreement.
- **Stage 8 note:** For the HLD itself, Stage 8 judged a full trace table unnecessary (F10). For an implementation plan it is the right tool, because an item missing here does not get built.

### M5. The plan inherits PRD and HLD conflicts without settling them
- **Ids:** `readiness-1-11`, `codebase-1-N4` *(S5 M4, S7 M1/M10, S8 F9/F10)*
- **Scope:** L178, L184, L188
- **Problem:** Three conflicts are open:
  - PSE-9 (realistic surrogates) is P0 in the PRD but v1 here.
  - PSE-10 (restore into DOCX) is P0, but DOCX is v1.
  - Telemetry is "off by default" in PRD L229, but opt-out in HLD L324 and Phase 8.
- **Recommendation:** Record the decisions once the PRD owner settles them (Stage 8, "Where to start", item 1).

### M6. Phase 4's rule packs leave out the HLD's pack design
- **Ids:** `readiness-1-12`, `codebase-1-M8`
- **Scope:** L176, L239
- **Problem:** Phase 4 does not say:
  - which identifier types each of the six countries has, or where each rule comes from;
  - how YAML packs are loaded in TypeScript;
  - which validators are written, and where;
  - the default band thresholds (the POC config cannot be seen);
  - how the regex time limit works;
  - the recall targets, which L239 defers to "the start of phase 4", so "done when" cannot be evaluated.

  Also missing: the never-hide list (REV-5) and the review screen beyond approve and reject.
- **Recommendation:**
  - Add a table per country: type, rule source, validator, context words, thresholds.
  - Compile packs to JSON at build time (S5 N9).
  - Run user regexes in a worker that can be terminated, with a set timeout.
  - Put placeholder targets in now, such as the PRD's 99% recall on structured identifiers.
  - *[unverified]* python-stdnum may not cover the UK National Insurance and NHS numbers. Check this before relying on it for UK packs.

### M7. Phase 5's round-trip inputs and placeholder rules are not defined
- **Ids:** `readiness-1-13`, `codebase-1-M9`
- **Scope:** L178; HLD L192-193; PSE-5
- **Problem:**
  - The "AI-style reply" has no generator.
  - Placeholder prefixes for each type, the scope of the counters, and whether redacted entities use up a counter number are all undefined.
  - The tests cover case, brackets and an invented `PERSON_9`. They skip the HLD's quotes, markdown emphasis, possessives and line breaks inside a token.
  - The tests use only synthetic replies, while the PRD's metric uses real model outputs.
- **Recommendation:**
  - Define the placeholder grammar with test cases, and include a word-boundary rule so `PERSON_1` does not match inside `PERSON_10`.
  - Add one test for each HLD tolerance.
  - Add a small fixed set of real Claude and ChatGPT replies as fixtures.

### M8. Phase 6 model delivery breaks the HLD's network rules, and the device check has no thresholds
- **Ids:** `readiness-1-14`, `codebase-1-M10` *(S7 M2, S8 F8)*
- **Scope:** L146-159, L180
- **Problem:**
  - *[unverified]* Transformers.js loads models from the Hugging Face Hub by default. That breaks the CSP rule and the network allowlist unless the library is configured to load only from our origin.
  - Phase 6 has no:
    - thresholds for the device check (WebGPU limits, memory, the timed run);
    - fallback for browsers that do not report memory (`navigator.deviceMemory` is Chromium-only);
    - rule for splitting long text into chunks for the model;
    - place to store the user's chosen level;
    - file recording the D10 results.
  - The test harness has no metrics format, and nothing says how Playwright reaches the three physical devices.
- **Recommendation:**
  - Specify where models are hosted and how Transformers.js is configured.
  - Move the network-allowlist test to Phase 0 (Stage 8 F8).
  - Make the thresholds and the config file outputs of D10, recorded before Phase 6 starts.

### M9. Phase 7 leaves out the image leak list, TIFF and the HLD's OCR settings
- **Ids:** `readiness-1-15`, `codebase-1-M11` *(S7 M8, S8 F5)*
- **Scope:** L182, L197; HLD L89-105
- **Problem:**
  - TIFF is P0 (DOC-7) but missing.
  - No phase writes the image leak-vector list.
  - These HLD settings are left out:
    - box padding of 10% of line height, minimum 2 px;
    - rendering at 300 dpi;
    - deskewing before OCR;
    - merging an existing OCR layer with our own OCR;
    - the image verifier's checks;
    - *[unverified]* the Tesseract.js setting that turns on word and box output.
  - Nothing tests a PDF that mixes text pages and scans.
- **Recommendation:**
  - Add the image leak-vector table, the format list, the settings above and the image verifier checks as test assertions.
  - Decide TIFF with the PRD owner (Stage 8 F5).

### M10. Phase 8 has no API, data or telemetry specification
- **Ids:** `readiness-1-16`, `codebase-1-M12`
- **Scope:** L41, L184, L237
- **Problem:** Phase 8 has no:
  - Accounts API endpoints, request and response shapes, idempotency key or credit batch size;
  - ledger schema or database;
  - repository;
  - Auth0 settings;
  - telemetry schema or analytics store;
  - network allowlist for the test to check against.
- **Recommendation:** Require Phase 8 to have its own detailed plan, reviewed before the phase starts, and list it in "Waits for". Settle Stage 8 W1 first, which asks whether the MVP needs metering at all. The answer could shrink this phase a lot.

### M11. The dataset and generator tooling cannot be acted on yet
- **Ids:** `readiness-1-17`, `codebase-1-N1`
- **Scope:** L95-138
- **Problem:** None of these is given:
  - the generator's location, language version and dependencies;
  - the templates;
  - how glyph boxes are captured;
  - the settings for simulated scans;
  - the mix of the 500 synthetic PDFs;
  - the size of the smoke subset and how it is chosen;
  - the private storage system, and how nightly CI signs in to it;
  - the split between development and test documents;
  - access dates and licence links for the datasets.
- **Recommendation:** Specify each, with paths and parameters. Also say where the generator lives, given that the POC is off limits (see B3).

### M12. Test infrastructure is unspecified
- **Ids:** `codebase-1-M7`, `readiness-1-N18`
- **Scope:** L146-152, L194-208
- **Problem:** None of these is given:
  - the Playwright projects;
  - shared test helpers (open a fixture, mark, draw, capture the download, call the checker);
  - how "the engine runs headless" (L208) works;
  - the metrics format and where scores are kept for each commit;
  - how CI reaches the private real documents if the app repository is public.

  Also, "any drop in recall fails" (L207) has no tolerance, so it will flake on small test splits, and it has no way to set a new baseline after labels are corrected.
- **Recommendation:**
  - Give each helper a path and signature.
  - Define the metrics schema and where scores are stored.
  - Set a regression tolerance and a rebaseline procedure.
  - Specify how CI accesses the private documents.

### M13. The number of spikes and when they start contradict each other
- **Ids:** `style-1-3`
- **Scope:** L13, L27, L29, L144; the diagram
- **Problem:**
  - The diagram and its alt text show 3 spikes, with MuPDF.js parity as one of them. The text says "both spikes", with parity inside Phase 1.
  - L29 says the spikes start in "week one". L144 says they start once the 500 synthetic PDFs exist. L15 says the plan gives no durations at all.
- **Recommendation:** Choose one model and use it everywhere. Replace "week one" with the dependency.

### M14. "Waits for" leaves out a dependency, and the open questions have no owners
- **Ids:** `codebase-1-N2`, `readiness-1-4` (gate part)
- **Scope:** L39, L140, L236-241
- **Problem:**
  - Phase 6 needs the 200 labelled real documents, but its "Waits for" cell lists only Phase 5 and D10.
  - None of the six open questions has an owner or a deadline, and four of them block a phase:

  | Open question | Blocks |
  | --- | --- |
  | Hosting | Phase 0 |
  | Repository | Phase 0 |
  | Recall targets | Phase 4 |
  | Reference devices | Phase 6 |

- **Recommendation:** Add the dependency to Phase 6. Give each open question an owner and the phase it must close before.

### M15. "Undermine the whole design" and similar wording claim more than the evidence shows
- **Ids:** `style-1-2` (wording part), `style-1-9`
- **Scope:** L78, L227, L228, L230, L231
- **Problem and fix:**

  | Line | Problem | Fix |
  | --- | --- | --- |
  | L78 | "Would undermine the whole design" | "Would force a fallback for image blanking or text removal" |
  | L227 | The stated effect is narrower than the real one | "Pixels under boxes on embedded images and scans stay in the file" |
  | L228 | "Longer than planned" assumes durations, which the plan does not give | "Not finished before Phase 6 starts" |
  | L230 | "US locales only" conflicts with L99-100 | Reword to match L99-100 |
  | L231 | "Manual review stays strong" | Name the concrete fallback: manual marking and the working-set matcher work at every level |

---

## 🟢 Nits

| Id | Scope | Issue | Fix |
| --- | --- | --- | --- |
| `style-1-4`, `readiness-1-20`, `codebase-1-N3` | L7 | "marks pdf by hand"; "truly gone"; "fastest feedback"; links point to claude.ai | Reword, and link `PRD.md` and `HLD.md` by relative path |
| `style-1-5` | L39, L159, L186, L220, L231 | "Full and Standard slots" and "Basic detection" are not defined in the plan. "Lead persona" appears in neither document; the PRD says "first user" | Define the levels at first use, and use the PRD's term with a count of pilot users |
| `style-1-6` | L80, L133, L138, L180, L186, L205 | Vague success bars: "cleans a real PDF", "agreement is reported", "small smoke subset", "published", "runs stay short" | Name the metric, size, place or limit |
| `style-1-7` | L203-207 | Headings that are slogans: "keep this fast", "never a flaky test", "go up, not sideways" | Use plain rule statements under the heading "CI rules" |
| `style-1-8` | L192 | Restates principle 2 | Drop it |
| `style-1-10` | L23, L49, L66, L220, L238 | "Stay cheap"; "One repository" against L238; filler such as "small" and "from day one"; "the core promise"; "Recommended." with no reason | Fix each |
| `readiness-1-19` | L51 | "Sees page 1 rendered" has no assertion | Say how it is checked: canvas not blank, or a screenshot diff with a tolerance. Name the fixture |
| `readiness-1-18` | L207 | The recall-drop rule has no tolerance | Covered in M12 |
| `codebase-1-N1` | L99-104 | Dataset facts have no sources | Covered in M11 |
| `readiness-1-22` | L27 | The diagram matches the phase table | No issue |

---

## Where Stages 5-9 agree

These issues were raised independently in three or more stages:

| Issue | Stages | Item here |
| --- | --- | --- |
| Using the POC vs HLD line 96 (now also enforced by a hook) | 5, 6, 7, 9 | B3 |
| Key model and storage engine | 5, 7, 8, 9 | B6 |
| Spread and matching rules | 5, 6, 7, 8, 9 | M3 |
| Telemetry default and the PSE-9, PSE-10 and TIFF conflicts with the PRD | 5, 7, 8, 9 | M5 |
| Network rules for model and OCR assets | 7, 8, 9 | M8 |

## Round status

- **Round 1 is not clean.** 6 Blockers and 15 Majors are open.
- **Convergence needs two clean rounds in a row**, with a limit of 5 rounds.
- **Resolution would run `egm-resolve` on this range.** It decides, for each finding, whether to propose a fix or contest it, and applies the approved edits to `docs/Implementation-Plan.md`.

## Where to start

1. **Settle B3 first**, because it decides the test checker for every phase. Either allow `verify.py` as a test-only checker, updating HLD L96 and the hook to match, or replace it.
2. **Decide what kind of document this is.** Either add the detail to make it an executable plan (B1, B2, B4, B5 and B6 for Phases 0-2), or keep it a roadmap and require a short detailed plan before each phase. The second fits Phases 3-8 better.
3. **Resolve the PRD conflicts** (M5, and Stage 8 item 1), then add the traceability table (M4).
4. **Make the mechanical edits:** M1 (one "done when" per phase), M13 (spike count), M15 and the Nits.
