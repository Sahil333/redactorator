# Stage 6: Comprehension Test

**Targets:**
- Design: `docs/HLD.md`, lines 1-488.
- Implementation: `docs/Implementation-Plan.md`, lines 1-241.

**Reviewer:** `egm-comprehension` (completed). It read only these two documents and the images they embed (`images/hld-architecture.png`, `images/plan-tracks.png`), with no background files and no document standard. The test is whether a fresh reader can follow the design from these two documents alone.

**Result:** 0 Blocker, 7 Major, 4 Nit. The reviewer could paraphrase every section. Findings 2, 3 and 4, though, leave the core of the design (how findings become decisions, and where they are stored) open to more than one reading.

**What to check first:** compare the paraphrase below with what you meant to say. A wrong paraphrase is itself a finding. The second paragraph is partly the reviewer's guess, because neither document describes how the POC works.

---

## What this proposes

Redactorator is a single-page web app that we host. Inside the user's browser it does one of two things to personal data in PDFs, images and text, with DOCX coming later:

- It **redacts** the data, which removes it for good.
- It **pseudonymises** the data, which swaps each value for a placeholder that can be reversed later.

The engine is a pipeline of six stages, each behind a contract that does not depend on any programming language:

1. Read the file into a shared model of text plus anchors.
2. Detect candidates with rule packs, term lists, NER models and a working-set matcher.
3. Resolve them into decisions for each entity.
4. Transform the decisions into edits.
5. Write the file in the same format, with hidden carriers scrubbed.
6. Verify by re-reading the output. An output that fails verification is not released.

Decisions attach to entities in an encrypted registry for each "working set". Every output is rebuilt from the encrypted stored originals, so a decision made in one document applies to all of them. Pseudonymised text is copied to a cloud AI, and the reply is restored by looking each placeholder up in the vault.

Our servers only deliver code, models and packs. They also run Auth0 sign-in, Stripe billing, a quota of credits per document, and telemetry limited to a fixed schema.

The plan builds all this in nine phases. Phase 1 is a "walking skeleton" for manual redaction, checked by an outside test checker. A dataset track and spikes for D10 (NER models) and D6 (OCR engine) run alongside the phases.

## How the existing system works, per this document

The existing system is a Python proof of concept (POC). It uses:

- PyMuPDF and pdfminer for PDF.
- Regex rules with validators and context words (`needs_context`).
- Two NER models: GLiNER2-PII and the OpenAI Privacy Filter.
- Logic for merging, filtering and spreading repeats (`merge.py`, `pipeline.py`).
- A verifier (`verify.py`).

It is backed by a list of 27 leak vectors, 90 fast tests, fixtures and evaluation results. The documents treat it only as a specification, a baseline and a test checker, never as code that ships.

Neither document says how the POC is used end to end: what it takes in, what it gives back, or how a user runs it. The reviewer pieced its shape together from module names, so this paragraph is partly a guess.

---

## Findings

### 1. Contradictory instruction on whether the POC may be used - Severity: Major
- **Scope:** HLD.md L96. Contradicted by HLD.md L29, L177, L352 and L405-416, and by Implementation-Plan.md L66, L131, L152 and L197.
- **Gap:**
  - L96 says "Do not use or read anything from that POC code."
  - The rest of the HLD names POC modules as the specification for merging, verification and rules, and ports its fixtures.
  - The plan makes the POC's `verify.py` the outside checker for every leak test, uses the POC to pre-label real documents, and takes the POC's numbers as the spike baseline.

  A new reader cannot tell whether the POC is off-limits or central. The sentence after L96 ("In the browser the build according to HLD steps use the same engines...") is garbled and adds to the confusion.
- **Recommendation:** Rewrite or delete L96, stating the actual rule. For example: "POC code is not ported into the product, but its tests, fixtures, leak list and `verify.py` are used as the specification and the test checker."
- **Stage 5 overlap:** M5.

### 2. Confidence bands, thresholds, "auto mode" and "policy" are never defined - Severity: Major
- **Scope:** HLD.md L15, L35, L82, L137, L217, L226, L374, L392. Implementation-Plan.md L176.
- **Gap:** Several terms are used without a definition:
  - The Resolver returns a "confidence band", and image pages "default to the review band".
  - Principle 3 mentions an "auto mode".
  - The plan names two bands, "auto" and "needs review".
  - "Policy" is defined only as "the keys of the POC's config.yaml" (L377), and those keys are never listed.

  Neither document says how many bands exist, how a score maps to a band, what each band does (auto-redact, queue for review, ignore), or what auto mode is. This decide step is at the centre of the design, and a reader cannot follow how a finding becomes an action.
- **Recommendation:** Add a short subsection to the HLD, under "Detection stack" or "Working sets", covering:
  - the bands, and how thresholds place a finding in a band;
  - the default action for each band;
  - what auto mode changes;
  - the fields a policy contains.
- **Stage 5 overlap:** new.

### 3. The rules for spreading decisions across a working set disagree with each other - Severity: Major
- **Scope:** HLD.md L212-228. Implementation-Plan.md L172, L176.
- **Gap:**
  - **Matching:** Step 2 links findings by normalised value, ignoring case, spacing and number format. But L225 says "Automatic exact-match linking is in the MVP", and L227 says an approved value spreads "to every exact match". It is unclear whether matching is exact or normalised.
  - **Policy decisions:** Step 3 lets "the policy" set a decision, but nothing says whether a decision set by policy counts as approval and spreads.
  - **Default action:** L226 says an unapproved detection is "redacted there by default". That seems to conflict with step 2, where a new entity gets "the policy's default action".
  - **Heading:** "Two limits" introduces four bullets, and two of those (L227, L228) are rules, not limits.
- **Recommendation:** Replace L223-228 with one table of spread rules, and fix the heading.
  - **Rows**, one per decision source: manual mark, approved detection, unapproved detection, decision set by policy, box with no text behind it.
  - **Columns:** applies in this document; spreads to repeats in this document; spreads across the set; matching rule used (exact or normalised).
- **Stage 5 overlap:** extends N7 and the "Two limits" item in N9.

### 4. "Vault" is never defined, and principle 5 conflicts with D3 - Severity: Major
- **Scope:** HLD.md L17, L57, L179-208, L346, L373-389, L444.
- **Gap:**
  - Principle 5 says "A redacted value never reaches the vault." D3 (L208, L444) stores normalised redacted values in the same encrypted set store, and L389 says the surrogate map is simply the `entity` table, with "no separate vault store". Read that way, redacted values do reach the vault.
  - "Vault", "entity registry", "encrypted store", "set.db" and the diagram's "set database" all seem to name the same thing.
  - Storage is described three ways: "one encrypted store" (L203), "one encrypted folder" (L373), and "origin-private file system and IndexedDB" (L346).
  - "Exporting a vault" (L205) and "working-set export" (L403) may be the same operation.
- **Recommendation:**
  - Define "vault" once, near the top of the Pseudonymisation section: either the whole set store, or only its surrogate columns.
  - Restate principle 5 so it holds under D3. If this is the intended meaning, say that a redacted entity never gets a surrogate and is never written into an output.
  - Name the one storage mechanism behind `set.db`.
- **Stage 5 overlap:** M6 and M10, here seen from the reader's side.

### 5. Who the product is for, and what a "working set" is, are assumed rather than introduced - Severity: Major
- **Scope:** HLD.md L5-7, L25, L181-187, L203, L212. Implementation-Plan.md L186, L220.
- **Gap:**
  - The HLD never says who the user is or what workflow it serves. The two uses, redacting a document to share it and the pseudonymise, send to AI, restore round trip, appear only in a diagram caption (L25) and a pivot table.
  - "Working set" first appears at L181-187 and is only explained by how it works, at L212. It is never described from the user's side: is it a matter, a project, a folder?
  - The HLD defers to the PRD without linking it.
  - The plan's MVP gate depends on "the lead persona" (L186, L220), which neither document defines.
- **Recommendation:**
  - Add a three-to-four-sentence paragraph after the summary on what the product does and for whom. Define a working set in user terms and describe the two core flows.
  - Link the PRD and name the lead persona, or define the persona in the plan itself.
- **Stage 5 overlap:** new.

### 6. The superseded HLD build order is still cited as current - Severity: Major
- **Scope:** HLD.md L137, L362, L418-433, L457, L461. Implementation-Plan.md L31-41.
- **Gap:** L420 says the Implementation Plan replaces the build order, yet the HLD still cites the old steps, and they do not match the plan's phases:

  | HLD line | Cites | Says | Plan says |
  | --- | --- | --- | --- |
  | L457 | build step 2 | Port the 27 leak tests first | Leak suite is phase 3, after working sets |
  | L461 | build step 10 | DOCX adapter | DOCX is after the MVP |
  | L362 | build step 1 | The spike "settles D1" | D1 is already decided (HLD L336, L451) |

  The two documents also link each other only by external artifact URLs (HLD L420, plan L7), so a reader cannot confirm the linked HLD is this file.
- **Recommendation:**
  - Remove the old list, or mark it clearly as history.
  - Point the HLD's step references at plan phases instead, for example "plan phase 3" and "v1".
  - Fix L362 to agree with D1.
  - Link the two files to each other by relative path.
- **Stage 5 overlap:** M7 and M1.

### 7. The formatting requirement conflicts with "approximate" pseudonyms - Severity: Major
- **Scope:** HLD.md L74, L83, L247.
- **Gap:**
  - L74 says removal "shall not change the formatting of the document, eg. sentence line number changes".
  - L83 says pseudonyms in PDFs and images "are approximate", then in the next sentence that replacement "shall not change the format".

  A reader cannot tell what is guaranteed when a surrogate is longer or shorter than the original: does text reflow, does the font shrink, does it clip? It is also unclear what "line number changes" means.
- **Recommendation:** State the guarantee concretely, and say what happens when a surrogate cannot fit. For example: "glyph positions outside edited boxes are unchanged; a surrogate is scaled to fit its box and never shifts other text".
- **Stage 5 overlap:** M3.

### 8. Restoring and pasted text are not connected to working sets - Severity: Nit
- **Scope:** HLD.md L57, L190-199, L310, L326. Implementation-Plan.md L178.
- **Gap:** Restore uses "the vault as the only detector". Neither document says how the user chooses which working set's vault to restore against, or whether pasted text must belong to a working set. The user-facing restore flow is never described.
- **Recommendation:** Add one sentence saying that pasted text and AI replies are handled inside a chosen working set, or describe what does happen.
- **Stage 5 overlap:** new.

### 9. The count of open decisions is wrong - Severity: Nit
- **Scope:** HLD.md L437.
- **Gap:** The text says "Nine decisions are open", but only D10 and D6 are open; the rest are under Decided. D1 is cited from L41 onward but explained only at L451.
- **Recommendation:** Change the count to "Two decisions are open". Optionally, add a pointer to the decision log the first time each D-number appears.
- **Stage 5 overlap:** M1.

### 10. Identifiers from outside these documents are not explained - Severity: Nit
- **Scope:** HLD.md L118, L393. Implementation-Plan.md L72-75, L131.
- **Gap:**
  - "SET-6" (L393) is a PRD requirement id.
  - Leak vector numbers (3, 10, 1, 9, 11, 12, 23) refer to a POC list the documents never give.
  - "Both models" (plan L131) can only be guessed to mean the POC's two NER models.
- **Recommendation:** Explain each one where it appears, for example "SET-6 (stale-export warning)" or "leak vector 10 (image under text)", and name the two models.
- **Stage 5 overlap:** new.

### 11. The two documents list different image formats - Severity: Nit
- **Scope:** HLD.md L46. Implementation-Plan.md L40, L182.
- **Gap:** The HLD's image adapter handles "png, jpg, tiff", but plan phase 7 covers only PNG and JPEG. Neither document says whether TIFF was dropped or deferred.
- **Recommendation:** Say where TIFF lands.
- **Stage 5 overlap:** new.

---

## New compared with Stage 5

Five findings were not raised in Stage 5:

- **2:** bands, auto mode and policy are not defined.
- **3:** the spread rules contradict each other.
- **5:** no statement of who the product is for, and no user-side definition of a working set.
- **8:** restore is not tied to working sets.
- **11:** the documents list different image formats.

Findings 2 and 3 matter most, because together they describe how a detection becomes an action, the central flow of the design.
