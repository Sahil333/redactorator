Status: resolved

# Goldfish Annotated Review Report

## Resolution (18 Nov 2026, interactive breakdown)

The plan was edited in `docs/Implementation-Plan.md` (106 lines added, 71 removed). The author changed the brief partway through, so most edits were applied in a lighter form than the proposals further down this report.

**How the author's decisions changed the brief:**
- **The plan is a bird's-eye view, and the MVP target is about a week.** No file lists. No per-phase plans that must be written before a phase starts.
- **No CI until the MVP.** Unit and integration tests run locally with one command. Leak failures are never skipped. No build goes outside the team without a green local run.
- **Recall and other scores inform but never block.**
- **Nothing from the POC is used in any form.** B3 was resolved this way: the outside checker is stand-alone; the PDF leak list is written fresh in phase 3; the dataset generator lives in `tools/dataset/`; there is no POC pre-labelling and no POC baseline.
- **PRD decisions (the author owns the PRD):**
  - PSE-9 and PSE-10 are v1.
  - The MVP image formats are PNG, JPEG and WebP. TIFF joins if MuPDF.js decodes it.
  - Telemetry is on by default and can be switched off.
- **Models and libraries may load from third-party hosts.** Each is pinned by revision and its hash checked. The network test allows only plain downloads from those hosts.
- **Spreading a mark across a working set is batched.** It runs no later than when the user leaves the document, and every pending spread is applied before any document is opened or exported.

**Counts:**
- 23 items were taken through the breakdown.
- 22 were accepted, 8 of them in a revised form.
- M14 needed no edit; earlier items had covered it.
- 4 Nits were declined: `style-1-6`, `style-1-10` (wording), `readiness-1-19` and `codebase-1-N1`.
- Nothing was contested.

**Follow-ups outside this target.** The plan now disagrees with the HLD and PRD in these places:
- **HLD:**
  - L96, and every place the HLD relies on the POC: the POC reference column, Path from the POC, and the risk table.
  - L204, the key wording.
  - L265-266, own-origin-only loading.
  - L324, the telemetry default.
  - The storage layout at L373-394.
- **PRD:**
  - L229, the telemetry wording.
  - The P0 priority of PSE-9, PSE-10 and DOC-7.

**Target:** `docs/Implementation-Plan.md` (lines 1-241)
**Findings source:** [implementation_readiness_report.md](implementation_readiness_report.md) (Stage 9, round 1)

## Summary of suggestions

| Suggestion | Count | Items |
| --- | --- | --- |
| ESCALATE | 1 | B3 |
| PROPOSE FIX | 25 | B1, B2, B4, B5, B6, M1-M15, and 5 nits |
| CONTEST | 0 | — |
| DECLINE | 5 | nits |

Edits are labelled E1-E21. Some edits fix more than one finding, so the count of edits is lower than the count of findings.

**Nothing is contested.** The reviewers read the plan correctly. The plan was written as a roadmap, and the readiness standard asks for an executable plan, so the gaps are real gaps against that standard.

## How these fixes are shaped

The fixes do not turn every phase into file-level detail. They do three things:

1. **Add a principle (E5).** Each phase begins with a short phase plan covering its files, types, pinned versions and open settings.
2. **Specify Phases 0-2 in full,** so the work can start.
3. **Collect every open decision into one table (E6),** with the phase it blocks and a proposed default where one exists.

This follows the Stage 8 finding that the review proposals as a whole over-build the design.

## Edits that also need an HLD change

Several fixes choose things the HLD leaves open or contradicts:

- the storage and key setup (E8);
- the coordinate convention (E5);
- normalised matching (E8);
- moving the network test to Phase 0 (E5, E19).

The HLD is outside this target's range. If these edits are applied, the HLD needs the matching changes from `critic_report.md` and `intermediate_zoom_out_report.md`, or the two documents will disagree again.

---

## 🔴 Blockers

### [Issue 1] [`egm-implementation-readiness`, `egm-codebase-details`] B3. The test checker is POC code that the HLD and a project hook both forbid - Severity: Blocker
*   **Affected Scope:** Lines 21, 66, 113, 131, 152, 197, 238 (Principles; Phase 1 "The outside checker"; Dataset track; Testing strategy)
*   **Discrepancy Description:**
    *   The plan makes the POC's `verify.py` the test checker "from day one" (L66), pre-labels documents with the POC (L131), and puts the dataset generator "beside the POC" (L113).
    *   HLD line 96 says not to use or read the POC code.
    *   The POC has no stated location, commit or pinned versions.
    *   Its checks do not cover everything the HLD verifier checks.
    *   Leak vector 10 means one thing in the plan (L73) and another in HLD L118.
*   **Rationale:** Implementers cannot follow both documents, and public CI has no stated way to reach a private POC.
*   ***AI Suggestion:*** ESCALATE
*   ***Justification:***
    *   The critique is valid, but the fix depends on a rule the reviewers could not see. `.claude/hooks/block-poc.sh` blocks every read, search or run inside `poc/`; it stopped this session's own check.
    *   Whether the POC may serve as a test checker is your policy decision, and changing the hook is your configuration change, not one I should make.
    *   Without the POC I also cannot check the vector numbering.
*   ***Your choice, then the plan edit that follows:***
    *   **(A) The POC may be used for tests only.**
        *   Change HLD L96 to: "POC code is not ported into the product; its `verify.py`, leak list and fixtures are the test checker and specification."
        *   Widen the hook to allow `poc/` for tests only. You would make this change yourself.
        *   In the plan, add this to Phase 0: "Copy `verify.py`, `LEAK_VECTORS.md` and the fixtures from POC commit `<sha>` into `tests/oracle/` and `fixtures/pdf/`. Pin the Python, PyMuPDF and pdfminer.six versions there. The wrapper `tests/oracle/check.py <file> <values.json>` prints one JSON line per check and exits non-zero on any hit. A leak is declared if either extractor finds a value."
        *   Then reconcile the vector numbers in the Phase 1 table against `LEAK_VECTORS.md`.
    *   **(B) Replace the POC.** Phase 0 builds a stand-alone checker in `tests/oracle/` on pdfminer.six plus a raw-object scan, written from a leak-vector list kept in this repository. Pre-labelling (L131) uses the app's own rules from Phase 4 on. The generator moves to `tools/dataset/`.

---

### [Issue 2] [`egm-implementation-readiness`, `egm-codebase-details`] B1. No file boundary, and no decision on the repository - Severity: Blocker
*   **Affected Scope:** Lines 17-23 (Principles); 47-51 (Phase 0); 236-241 (Open questions)
*   **Discrepancy Description:** The plan names five directories and no files. Tools have no home. L49 says "one repository" while L238 leaves the repository open.
*   **Rationale:** A list of files that may be written cannot be built from this plan.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Phase 0 needs a file list to start. Later phases can name their files in their own phase plans (E5), which is cheaper than inventing paths now for designs that are not settled.
*   ***Proposed Edit:*** E5 (principle 6 and the Phase 0 file list) and E6 (the repository row in the decisions table). E20 makes L49 point to the repository decision.

### [Issue 3] [`egm-implementation-readiness`, `egm-codebase-details`] B2. Contracts, `DocumentModel` and worker messages are not defined - Severity: Blocker
*   **Affected Scope:** Lines 23, 33, 47-62
*   **Discrepancy Description:** No TypeScript types, anchor or box convention, `Edit` shape, or worker message protocol.
*   **Rationale:** Every phase plugs into these types, starting with Phase 1.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** These belong in Phase 0, as a named file with named types and one coordinate convention.
    *   Field-level definitions are left to that file, not this document.
    *   The convention is stated as a choice, and the Phase 1 rotated-page test checks it.
    *   I have not checked how MuPDF.js reports coordinates on rotated pages, so the Phase 0 plan records that.
*   ***Proposed Edit:*** E5 (the Phase 0 contracts and messages bullets).

### [Issue 4] [`egm-codebase-details`, `egm-implementation-readiness`] B4. Dependency and platform choices are left open - Severity: Blocker
*   **Affected Scope:** Lines 49-50, 172, 184, 236-241
*   **Discrepancy Description:** Each of these blocks a phase and is not chosen:
    *   UI framework, CI provider, Node version and package manager, preview host;
    *   the MuPDF.js version and other library versions;
    *   the storage engine and the YAML loader;
    *   the Accounts API stack.
*   **Rationale:** The implementer would have to make these choices.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** I cannot choose your framework or CI provider for you. What the plan can do is make each choice a gate on the phase it blocks, with an owner and a proposed default where the reviews produced one.
*   ***Proposed Edit:*** E6 (the "Decisions each phase waits for" table) and E5 (pin exact versions in Phase 0).

### [Issue 5] [`egm-implementation-readiness`, `egm-codebase-details`] B5. The ground-truth schema is only prose - Severity: Blocker
*   **Affected Scope:** Lines 62, 86-93, 109
*   **Discrepancy Description:**
    *   No field names, list of entity types, version or schema file.
    *   Offsets depend on an extractor that is not named.
    *   The box convention is not stated.
    *   The labelling screen lacks a type picker and link ids.
    *   "Record every glyph's box as it is drawn" (L109) probably does not match how PyMuPDF works.
*   **Rationale:** Phase 1 has to write this schema.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:***
    *   Make boxes the authority and take offsets from MuPDF.js, so labels line up with the app's findings.
    *   Take the entity types from PRD DET-1 (L99).
    *   I have not checked whether PyMuPDF reports glyph boxes while drawing, so the wording becomes "extract after rendering", which works either way.
*   ***Proposed Edit:*** E9 (Dataset Step 1, Phase 1 step 6, and L109).

### [Issue 6] [`egm-implementation-readiness`, `egm-codebase-details`] B6. Phase 2 storage and encryption are not specified, and the HLD's key model fails - Severity: Blocker
*   **Affected Scope:** Line 172 (Phase 2)
*   **Discrepancy Description:**
    *   No store, encryption unit, nonce policy, key lifecycle, KDF, export format or purge behaviour.
    *   The HLD's non-extractable key cannot be wrapped.
    *   No test checks encryption at rest or purge.
*   **Rationale:** Phase 2 cannot start.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:***
    *   Use Stage 8's smallest form that works:
        *   IndexedDB records encrypted per record;
        *   OPFS for large files;
        *   one data key wrapped by a key derived from the passphrase;
        *   a re-encrypted export.
    *   The PBKDF2 iteration count and the export container format stay in the Phase 2 plan.
    *   The HLD must change to match (see above).
*   ***Proposed Edit:*** E8 (Phase 2 rewrite).

---

## 🟡 Majors

### [Issue 7] [`egm-style`, `egm-implementation-readiness`] M1. "Done when" conditions disagree between the table and the phase sections - Severity: Major
*   **Affected Scope:** Lines 11, 31-41, 80, 172-184
*   **Discrepancy Description:** The table says each phase ends with a CI browser test. The phase sections require manual checks, WebKit, weekly device runs and an undefined recall target.
*   **Rationale:** No one can tell which condition counts.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** The phase sections are more detailed, so they win and the table copies them.
*   ***Proposed Edit:*** E2.

### [Issue 8] [`egm-style`, `egm-codebase-details`, `egm-implementation-readiness`] M2. Phase 1 claims MuPDF.js parity is "answered" from 6 of the 27 vectors - Severity: Major
*   **Affected Scope:** Lines 60-61, 68-80, 216, 227
*   **Discrepancy Description:**
    *   Parity is overclaimed.
    *   No layout test.
    *   The fallback has no phase.
    *   PDF.js is not scheduled.
*   **Rationale:** The checkpoint at L216 would report something the tests do not show.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:***
    *   Make the wording match what the tests cover.
    *   Add Stage 8's glyph-position test (F7).
    *   Make the fallback a Phase 1b step.
    *   Put PDF.js in Phase 3, where the certificate is built.
    *   The exact MuPDF.js calls go in the Phase 1 plan (E5).
*   ***Proposed Edit:*** E3 and E10.

### [Issue 9] [`egm-implementation-readiness`, `egm-codebase-details`] M3. Spread matching contradicts the HLD, and edge cases are missing - Severity: Major
*   **Affected Scope:** Line 172
*   **Discrepancy Description:** The plan says "exact match", the HLD normalises. Not covered: word boundaries, line breaks, Unicode, a box with no text, and matching inside hidden carriers.
*   **Rationale:** The implementer would have to choose.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:***
    *   Normalised matching follows HLD Working sets step 2 and PRD SET-2.
    *   Word boundaries follow Stage 8 F11.
    *   Matching inside hidden carriers is Phase 3's job; E10 adds it there.
*   ***Proposed Edit:*** E8 and E10.

### [Issue 10] [`egm-implementation-readiness`, `egm-codebase-details`] M4. Many P0 requirements and HLD MVP controls belong to no phase - Severity: Major
*   **Affected Scope:** Lines 168-188 (the whole build track)
*   **Discrepancy Description:** DOC-4, DOC-5, REV-5/6/7/9/10/11, RED-6, SET-1, SET-3, PSE-3, PSE-10 (text formats), AUD-1, ACC-5, ACC-6, the P0 configuration rows, WCAG 2.2 AA, Edge, the service worker, the Content Security Policy, the D9 items, and pseudonymised PDF output.
*   **Rationale:** An item missing from the plan does not get built.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:***
    *   For an implementation plan, a coverage table is the right tool, even though Stage 8 judged one unnecessary for the HLD.
    *   The phase each item lands in is proposed from where its building blocks already appear. Change any row you disagree with.
    *   Pseudonymised PDF output is left open for the PRD owner.
*   ***Proposed Edit:*** E11.

### [Issue 11] [`egm-implementation-readiness`, `egm-codebase-details`] M5. PRD and HLD conflicts are inherited without being settled - Severity: Major
*   **Affected Scope:** Lines 178, 184, 188
*   **Discrepancy Description:**
    *   PSE-9 is P0 in the PRD but v1 here.
    *   PSE-10 asks for restore into DOCX, but DOCX is v1.
    *   The telemetry default conflicts between the PRD and the HLD.
*   **Rationale:** The implementer would pick a side.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** The plan cannot settle PRD priorities. What it can do is list them as gates, so they are not missed. TIFF (DOC-7) is added as well.
*   ***Proposed Edit:*** E11 (the "PRD conflicts to settle" list).

### [Issue 12] [`egm-implementation-readiness`, `egm-codebase-details`] M6. Phase 4 packs leave out the HLD's pack design - Severity: Major
*   **Affected Scope:** Line 176, line 239
*   **Discrepancy Description:** Phase 4 does not give:
    *   the identifier types per country;
    *   how packs are loaded;
    *   which validators are written;
    *   the thresholds;
    *   the regex sandbox;
    *   REV-5 and REV-10;
    *   the recall targets.
*   **Rationale:** "Done when" cannot be evaluated.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Name what the Phase 4 plan must contain, and fix the two design choices the reviews agree on:
    *   compile packs to JSON at build time (S5 N9);
    *   run user patterns in a worker that can be terminated (S5 N9, S7).

    The recall target defaults to the PRD's 99% for structured identifiers (PRD L253).
*   ***Proposed Edit:*** E12.

### [Issue 13] [`egm-implementation-readiness`, `egm-codebase-details`] M7. Phase 5's round-trip inputs and placeholder rules are undefined - Severity: Major
*   **Affected Scope:** Line 178
*   **Discrepancy Description:**
    *   No placeholder grammar.
    *   The HLD's tolerances (quotes, emphasis, possessive, line break) are not tested.
    *   Only synthetic replies are used, while PRD L256 measures against real model outputs.
*   **Rationale:** "Restore exactly" has no fixed input.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** HLD L185 and L192 already define the counter and the tolerances. The plan only has to test them.
*   ***Proposed Edit:*** E13.

### [Issue 14] [`egm-implementation-readiness`, `egm-codebase-details`] M8. Phase 6 model delivery breaks the network rules, and the device check has no thresholds - Severity: Major
*   **Affected Scope:** Line 39 (table), line 180
*   **Discrepancy Description:**
    *   Transformers.js fetches from its default hub (unverified).
    *   No thresholds, chunking rule, place to keep the user's level, or config file for the D10 results.
*   **Rationale:** The Phase 8 network test would fail. Moving it to Phase 0 catches this early.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:***
    *   Load models from our own origin only.
    *   Treat thresholds and limits as D10 outputs, recorded in a named file.
    *   The network test moves to Phase 0 (Stage 8 F8).
*   ***Proposed Edit:*** E14, plus E5 and E19 (network test in Phase 0).

### [Issue 15] [`egm-implementation-readiness`, `egm-codebase-details`] M9. Phase 7 leaves out the image leak list, TIFF and the HLD's OCR settings - Severity: Major
*   **Affected Scope:** Line 182
*   **Discrepancy Description:** Phase 7 lacks:
    *   an image leak-vector list;
    *   padding, dpi and deskew settings;
    *   merging an existing OCR layer;
    *   a test for PDFs that mix text and scans;
    *   TIFF.
*   **Rationale:** HLD L89-105 and L118 already specify these.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Carry the HLD's settings into the phase. TIFF goes to the PRD conflicts list (E11), per Stage 8 F5.
*   ***Proposed Edit:*** E15.

### [Issue 16] [`egm-implementation-readiness`, `egm-codebase-details`] M10. Phase 8 has no API, data or telemetry specification - Severity: Major
*   **Affected Scope:** Lines 41, 184
*   **Discrepancy Description:** No endpoints, ledger, Auth0 settings, telemetry schema or allowlist.
*   **Rationale:** The network test has nothing to check against.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:***
    *   Phase 8 is the furthest out, and its scope depends on Stage 8 W1 (whether the MVP needs metering at all).
    *   A required phase plan, reviewed before the phase starts, is the right level for now.
*   ***Proposed Edit:*** E16, plus E6 (the metering row).

### [Issue 17] [`egm-implementation-readiness`, `egm-codebase-details`] M11. Dataset tooling cannot be acted on yet - Severity: Major
*   **Affected Scope:** Lines 109-138
*   **Discrepancy Description:** Missing:
    *   where the generator lives, its dependencies and templates;
    *   the settings for simulated scans;
    *   the size of the smoke subset;
    *   how CI reaches the private documents;
    *   the split ratio.
*   **Rationale:** The dataset track cannot start.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:***
    *   Where the generator lives depends on B3.
    *   The rest is detail for a phase plan, under principle 6, which applies to tracks as well as phases.
    *   The smoke-subset size and the split ratio get proposed numbers, consistent with L84 ("counts below are proposals").
*   ***Proposed Edit:*** E17.

### [Issue 18] [`egm-codebase-details`, `egm-implementation-readiness`] M12. Test infrastructure is unspecified - Severity: Major
*   **Affected Scope:** Lines 146-152, 194-208
*   **Discrepancy Description:**
    *   No Playwright projects, shared helpers or metrics format.
    *   No way for CI to reach the private documents.
    *   "Any drop in recall fails" has no tolerance.
*   **Rationale:** Nightly runs would flake.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Phase 0 names the config and the helpers file (E5). The recall rule gets a tolerance and a way to set a new baseline.
*   ***Proposed Edit:*** E5 and E19.

### [Issue 19] [`egm-style`] M13. The number of spikes and when they start contradict each other - Severity: Major
*   **Affected Scope:** Lines 27, 29, 144
*   **Discrepancy Description:** The diagram shows 3 spikes and the text says 2. L29 says "week one", while L15 says the plan gives no durations.
*   **Rationale:** The reader cannot tell what runs when.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:***
    *   The PNG cannot be edited here, so the text explains what the diagram shows: two spikes, plus a parity check drawn on the spike track that runs inside Phase 1.
    *   The start of the spikes is tied to its dependency, not to a week.
*   ***Proposed Edit:*** E4.

### [Issue 20] [`egm-codebase-details`, `egm-implementation-readiness`] M14. "Waits for" leaves out a dependency, and open questions have no owners - Severity: Major
*   **Affected Scope:** Lines 39, 236-241
*   **Discrepancy Description:** Phase 6 does not list the 200 labelled documents. Four open questions block phases but have no owner.
*   **Rationale:** Blocking items go untracked.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Proposed Edit:*** E14 (the Phase 6 "waits for" cell) and E6.

### [Issue 21] [`egm-style`] M15. Some wording claims more than the evidence shows - Severity: Major
*   **Affected Scope:** Lines 78, 227, 228, 230, 231
*   **Discrepancy Description:** "Undermine the whole design"; the stated risk effect is too narrow; "longer than planned"; "US locales only"; "manual review stays strong".
*   **Rationale:** Each claim goes past what the evidence in the plan supports.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Proposed Edit:*** E3 (for L78) and E18.

---

## 🟢 Nits

| Finding | Suggestion | Edit |
| --- | --- | --- |
| `style-1-4`, `readiness-1-20`, `codebase-1-N3`: L7 wording and claude.ai links | PROPOSE FIX | E1 |
| `style-1-5`: "lead persona" and undefined level names | PROPOSE FIX. PRD L284 uses "lead user". | E21 |
| `style-1-7`: slogan rule headings | PROPOSE FIX | E19 |
| `style-1-8`: L192 restates principle 2 | PROPOSE FIX: delete the paragraph | E19 |
| `style-1-10` (L49 only): "One repository" vs L238 | PROPOSE FIX | E20 |
| `style-1-6`: vague bars ("cleans a real PDF", "published", "short") | DECLINE. E2, E14 and E19 fix the ones that gate a phase; the rest are for phase plans. | — |
| `style-1-10` (L23, L66, L220, L238 wording) | DECLINE. Cosmetic; E6 replaces L238. | — |
| `readiness-1-19`: L51 render assertion | DECLINE. A Phase 0 plan detail. | — |
| `readiness-1-18`: recall tolerance | Covered by M12 | E19 |
| `codebase-1-N1`: dataset sourcing | DECLINE. Access dates belong in the dataset manifest (L136). | — |

---

## Proposed edits

### E1 · L7 (Summary)

**Replace with:**

> This plan turns the [PRD](PRD.md) and [HLD](HLD.md) into an order of work. It is ordered so the earliest phases give end-to-end feedback: the first thing built is a browser app in which a person marks text in a PDF by hand and gets back a PDF with that text removed, tested end to end in a real browser. Detection comes later, one layer at a time, and each layer is scored against a dataset with ground truth.

### E2 · L11, the phase table (L31-41), L80, L172

- **L11:**
  > **Build track.** Nine phases to the MVP. Each phase ends with stated exit criteria, at least one of which is a browser test that runs in CI.
- **Table header:** `Done when (browser test in CI)` becomes `Done when`.
- **Table cells:**

  | Phase | New "Done when" cell |
  | --- | --- |
  | 1 | All six phase 1 tests pass in CI; a person outside the team cleans a real PDF with the preview build (manual checkpoint) |
  | 2 | The phase 2 tests pass in Chromium in CI and in WebKit nightly |
  | 4 | Each rule type reaches its recall target with no leak-suite regressions |
  | 5 | The round trip passes on the synthetic text split and the real-reply fixtures with no wrong restores |
  | 6 | Recall per level is recorded in the HLD; the banner shows on all three reference devices (weekly device run) |
  | 7 | Scanned and image leak fixtures pass; no ink left under any box; scanned and image splits meet their recall target |

- **L80:**
  > **Done when** all six tests pass in CI, and a person outside the team cleans a real PDF with the preview build (a manual checkpoint).
- **Phase 2 "Done when":** written into E8.

### E3 · L78, Phase 1 test table, L216

- **L78, replace with:**
  > **MuPDF.js parity: a first check here.** The HLD lists two unknowns: whether MuPDF.js exposes the image-pixel option, and whether it removes text as the POC's pinned PyMuPDF does. If either fails, image blanking or text removal needs a fallback. Phase 1's tests answer the image-pixel question and give a first parity signal on 6 of the 27 leak vectors; phase 3 settles full parity. If the image-pixel option is missing, phase 1b adds the fallback (decode the image, blank the pixels under each box, re-encode it), with its own run of the embedded-image test, before phase 2 starts.
- **Add a row to the Phase 1 test table:**
  > | Text near a mark | Glyphs outside every box keep their positions, compared before and after apply | none |
- **L216, "What we learn" cell:**
  > True removal works in a browser for the phase 1 cases; whether MuPDF.js has the image-pixel option is known

### E4 · L29

**Replace with:**

> The build track runs in order. The dataset track starts beside phase 0, and the two spikes start once the 500 synthetic PDFs exist. The MuPDF.js parity check, drawn on the spike track in the diagram, runs inside phase 1. The synthetic documents feed both spikes, and the phase 1 tool is also the labelling tool for the real documents.

### E5 · Principle 6 (after L23) and the Phase 0 section (L49-51)

- **New principle 6:**
  > 6. **Each phase starts with a phase plan.** Before a phase or track starts, a short phase plan names the files it creates or changes (repository-relative paths), the types it adds to `engine/contracts.ts`, the exact dependency versions it pins, and the settings this plan leaves to it. Phases 0 to 2 are specified here in enough detail to start.
- **Phase 0, new bullets after L50:**
  > - Files: `package.json` with exact versions (MuPDF.js among them, since a version change can shift text after redaction), `vite.config.ts`, `playwright.config.ts` (Chromium on every push; WebKit, Firefox and Edge nightly), the CI workflow file, `app/` entry, `engine/worker.ts`, `engine/contracts.ts`, `engine/messages.ts`, `tests/e2e/helpers.ts` (open a fixture, mark text, draw a box, capture the download, run the outside checker), `fixtures/pdf/`.
  > - `engine/contracts.ts` defines `DocumentModel`, `TextBlock`, `Anchor`, `Box`, `Finding`, `Decision`, `Edit`, `FormatAdapter`, `Detector` and `VerifyResult` as TypeScript interfaces. Boxes use one coordinate system, MuPDF's page space in points with a top-left origin; the phase 0 plan records how rotated pages and crop boxes map into it, and phase 1's rotated-page test checks it. An `Edit` is either a text range (start and end anchors) or a free box with no text behind it.
  > - `engine/messages.ts` defines the requests and responses between UI and worker (open, render page, character boxes, apply, verify, export), one error shape and progress events. File bytes move as transferable `ArrayBuffer`s.
  > - A Content Security Policy of `default-src 'self'`, and the network-allowlist test, start here: from phase 0 any request outside our own origin fails CI.
- **L51 stays.**

### E6 · Open questions (L234-241)

**Replace the list with:**

> **Decisions each phase waits for**
>
> | Decision | Needed before | Owner | Proposed default |
> | --- | --- | --- | --- |
> | Repository layout: one public AGPL app repository, with the POC kept private? | Phase 0 | To assign | Yes |
> | UI framework; CI provider; Node version and package manager | Phase 0 | To assign | — |
> | Preview host for the static app | Phase 0 | To assign | — |
> | The outside checker: POC `verify.py` for tests only, or a stand-alone checker | Phase 1 | To assign | — |
> | Storage engine and key setup (written into phase 2) | Phase 2 | To assign | IndexedDB records encrypted per record; OPFS for originals and `DocumentModel`s; one data key wrapped by a passphrase-derived key |
> | Recall targets per entity type | Phase 4 | To assign | 99% for structured identifiers (PRD success metrics) |
> | The three reference devices, and who owns them | Phase 6 | To assign | — |
> | Hosting and stack for the Accounts API and telemetry store; whether the MVP needs metering before a paid plan exists | Phase 8 | To assign | — |
>
> **Other open questions**
>
> - [ ] Team size and target dates, so phases can get durations.
> - [ ] Who labels the real documents, and who does the 20% second pass.

### E7 · Reserved

No separate edit. The test-checker change is set apart under ESCALATE and is applied only once you choose option A or B.

### E8 · Phase 2 (L172)

**Replace with:**

> **Phase 2: working sets.** The store: set records in IndexedDB, each encrypted with AES-GCM under one random data key with a fresh random nonce per write; originals and stored `DocumentModel`s as encrypted files in the origin-private file system. The data key is wrapped by a key derived from the vault passphrase (PBKDF2 in Web Crypto) or, with no passphrase set, kept as a non-extractable key in IndexedDB. Set export re-encrypts the set under a key derived from an export passphrase. Entities and the registry; manual marks spread to every match of the normalised value (HLD, Working sets, step 2) at word boundaries across the set's documents; a box with no text behind it stays in its own document; stale outputs rebuilt from the encrypted originals; set export and import; purge. A manual mark counts as approved, so it spreads at once; the approval gate for detections comes with phase 4. The phase 2 plan writes the normaliser as ordered steps (case, whitespace, number formatting, Unicode NFKC, line breaks and hyphens inside a value) with a table of test cases, and sets the PBKDF2 parameters and the export file format. *Tests:* mark a value in document A, and document B comes out redacted; add document C later, and it comes out redacted too; a value that differs only in case or spacing, or breaks across a line, is matched, and a value inside a longer word is not; a box with no text stays in document A; the stored files contain no marked value as plaintext; export a set, clear storage, import it, and get the same results; a wrong export passphrase fails with a clear message; purge removes the set's records, files and wrapped key. *Done when* those pass in Chromium in CI and in WebKit nightly.

### E9 · Dataset Step 1 (L86-93), Phase 1 step 6 (L62), L109

- **L86-93, replace with:**
  > **Step 1: one ground-truth schema.** One JSON file per document, validated against `fixtures/schema/ground-truth.schema.json`, with a `schema_version` field:
  >
  > - `source`, `licence`, `country`, `format` (`pdf-born-digital`, `pdf-scanned`, `image`, `text`), `split` (`dev`, `test`);
  > - `entities[]`: `id`, `type` (one of the PRD's DET-1 types: person, address, email, phone, date of birth, government ID, financial account, payment card, IP address, credential, URL), `value`, and `link_id` when two spellings are the same person or thing;
  > - `occurrences[]`: `entity_id`, `page`, `boxes[]` and `offsets` (start, end);
  > - `hidden[]`: `entity_id`, `carrier` (metadata, annotation, form field, hidden layer and so on) and `location`, for the leak suite.
  >
  > Boxes are the authority: PDF points in the page space defined in `engine/contracts.ts`, or pixels from the top-left corner for images. Offsets index the text MuPDF.js extracts at the pinned version, so they line up with the app's findings; a tool using another extractor derives its own offsets from the boxes. A table beside the schema maps Nemotron, Gretel and TAB labels to these types. A validator checks every file. The phase 1 labelling mode writes the same schema.
- **L62, replace with:**
  > In labelling mode, the same screen gives each mark a type and an optional link id, and exports the marks as ground truth in the dataset schema. This is the tool used to label the 200 real documents.
- **L109, replace with:**
  > Render with PyMuPDF, then extract each span's glyph boxes from the rendered page, so each span's boxes are exact.

### E10 · Phase 3 (L174)

**Add after "Each export gets a certificate.":**

> The in-app verifier adds PDF.js as a second extractor. A value is matched in each hidden carrier with the phase 2 normaliser, after decoding the carrier's string encoding.

### E11 · New section "Requirement coverage", after "After the MVP" (L188)

**Insert:**

> ## Requirement coverage
>
> P0 requirements and HLD controls that the phase descriptions above do not name, and the phase that builds and tests each one:
>
> | Requirement | Phase |
> | --- | --- |
> | CSP, network-allowlist test, pipeline run with the network blocked | 0 |
> | RED-6 box colour or `[TYPE]` label; REV-6 preview before export; DOC-4 refuse encrypted or unknown files | 1 |
> | DOC-5 multi-file and folder import; REV-7 undo, redo and autosave; SET-1 manage sets; SET-3 entity view; vault lock with passphrase and auto-lock | 2 |
> | AUD-1 run report, beside the certificate; hidden-content options | 3 |
> | REV-5 never-hide list; REV-9 export blocked while findings need review; REV-10 search and mark; REV-11 keyboard review; thresholds and review-strictness settings | 4 |
> | PSE-3 copy or download; PSE-10 restore into `.txt` and `.md` | 5 |
> | Detection-depth setting, as the level override | 6 |
> | DOC-4 for pages OCR cannot read | 7 |
> | Service worker and offline use; D9 (reproducible builds, signed release hash in a public log, hash shown in the app); ACC-5 plans page; ACC-6 account deletion | 8 |
> | WCAG 2.2 AA and keyboard operation | Every phase with UI; an audit before the MVP gate |
> | Pseudonymised PDF output (HLD, Format adapters) | Open: phase 5 or v1, for the PRD owner |
>
> **PRD conflicts to settle before the phase that needs them**
>
> - [ ] PSE-9 realistic surrogates: P0 in the PRD, v1 here and in the HLD (before phase 5).
> - [ ] PSE-10 restore into DOCX: P0, but DOCX is v1 (before phase 5).
> - [ ] DOC-7 TIFF: P0, but phase 7 covers PNG and JPEG (before phase 7).
> - [ ] Telemetry: off by default with consent (PRD non-functional requirements) or switch-off (ACC-11, HLD) (before phase 8).

### E12 · Phase 4 (L176)

**Add after "...stays in its own document.":**

> The phase 4 plan lists, per country, each identifier type with its rule source, validator, context words and default thresholds. Packs are compiled from YAML to JSON at build time. Custom patterns run in a worker that is terminated when it passes a time limit.

**Add to Tests:**

> a pattern that backtracks without end is stopped within the time limit.

### E13 · Phase 5 (L178)

**Replace with:**

> **Phase 5: pseudonyms and restore.** Text adapter, placeholder surrogates (one counter per type per working set, as in the HLD; a redacted entity gets no placeholder), the vault and the restorer, with unknown placeholders flagged. *Tests:* paste text, pseudonymise, feed back an AI-style reply with changed case, brackets, quotes, markdown emphasis, a trailing possessive, a line break inside a placeholder and an invented `PERSON_9`, and restore exactly; `PERSON_1` is not matched inside `PERSON_10`; a fixed set of real replies from Claude and ChatGPT is kept as fixtures and restores with no wrong restores. *Done when* the round trip passes on the synthetic text split and the real-reply fixtures with no wrong restores.

### E14 · Phase 6 (L180), and the L39 "waits for" cell

- **Phase 6, add after "...on the certificate.":**
  > Models are served from our own origin under hashed names, and Transformers.js is set to load only from there; the network-allowlist test catches any other fetch. D10's outputs (the model in each level, thresholds per type, and the device-check limits) are recorded in a config file named in the phase 6 plan.
- **Phase 6, "Done when":**
  > *Done when* each level's recall on the real-document test split is recorded in the HLD and the banner shows on all three reference devices.
- **L39, "Waits for" cell:**
  > Phase 5; D10; the 200 labelled real documents

### E15 · Phase 7 (L182)

**Replace with:**

> **Phase 7: OCR and images.** The phase starts by writing the image leak-vector list (EXIF, XMP, embedded thumbnails, bytes after the image end marker) and its fixtures. The OCR engine D6 chose; scanned PDFs, PDFs mixing text pages and scans, PNG and JPEG; the HLD's coordinate mapping, with pages rendered at 300 dpi, deskew before OCR and box padding starting at 10% of line height, minimum 2 px; an existing invisible OCR layer merged with our own OCR. *Tests:* scanned and image leak fixtures pass; a pixel check finds no ink left under any padded box; a mixed PDF is handled page by page. *Done when* those pass and the scanned and image splits meet their recall target with no leaks.

### E16 · Phase 8 (L184), and the L41 "waits for" cell

- **Phase 8, add:**
  > The phase 8 plan, reviewed before the phase starts, covers the Accounts API endpoints, the ledger schema, the Auth0 settings and the telemetry schema.
- **L41, "Waits for" cell:**
  > Phase 7; the phase 8 plan

### E17 · L113, L138

- **L113:**
  > The generator is a Python tool. Where it lives depends on the outside-checker decision (see Decisions each phase waits for). Tools need not share the product's language.
- **L138:**
  > **Splits.** A development split for tuning and a held-out test split nobody tunes on, about 70/30. A smoke subset of about 50 development documents runs on every pull request; the full set runs nightly. The dataset track's plan (principle 6) records the generator's templates and scan settings, and how nightly CI reads the private documents.

### E18 · Risk table (L227-231)

| Row | Column | New text |
| --- | --- | --- |
| L227 | Effect | Pixels under boxes on embedded images and scans stay in the file |
| L227 | Mitigation | Found in phase 1; phase 1b re-encodes the image |
| L228 | Risk | Labelling 200 documents is not finished before phase 6 starts |
| L230 | Risk | Synthetic data names the US as the only launch-country locale |
| L231 | Mitigation | The spike's budgets per level; the banner tells them; manual marking and the working-set matcher work at every level |

### E19 · Testing strategy (L192, L199, L203-207)

- **L192:** delete the paragraph.
- **L199, "When" cell:**
  > Every pull request from phase 0
- **L203:**
  > CI rules:
- **L206:**
  > **Leak failures are never retried or quarantined.** Any leak failure blocks the merge and gets a fixture before it is fixed.
- **L207:**
  > **Recall may not drop.** Dataset scores are stored per commit; a recall drop beyond a set tolerance on any type fails the nightly run. A label correction that lowers a score sets a new baseline in the same pull request.

### E20 · L49

> - One repository (see Decisions each phase waits for): `app/` (UI), `engine/` (the Web Worker), `tests/e2e/` (Playwright), `tests/oracle/` (the outside checker), `fixtures/`.

### E21 · L159, L186, L220

- **L159:**
  > **Done when** the Full and Standard detection levels (HLD, Detection stack) have their models and D10 is recorded in the HLD. Must finish before phase 6.
- **L186:**
  > pilot users from the PRD's lead user (the AI-assisted professional) finish an AI round trip unaided.
- **L220:**
  > Whether pilot users finish paste, pseudonymise and restore unaided
