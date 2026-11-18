# Stage 8: Intermediate Zoom Out Review

**Target:** `docs/HLD.md`, lines 1-488. The HLD is unchanged since Stages 5-7.

**What this stage reviewed:** the HLD, plus the fixes proposed in [zoom_out_report.md](zoom_out_report.md), [comprehension_report.md](comprehension_report.md) and [critic_report.md](critic_report.md). The question was which proposals the MVP needs and which add scope it does not need.

**Background files:** `docs/PRD.md`, `docs/images/hld-architecture.png`, `docs/Implementation-Plan.md`.

**Standard:** `zoom-out-standard.md`.

| Reviewer | Status |
| --- | --- |
| `egm-zoom-out` | completed |

**Result:** 1 Blocker, 9 Major, 9 Nit. Seven of the Majors are about the earlier proposals. Two are new problems with the whole design.

## Verdict

**Revise before approval, but with far less work than Stages 5-7 imply.**

The HLD's real problems are few:

- a handful of contradictions;
- two choices it never makes: how keys work, and which storage engine to use.

Stages 5-7 turned those into a long list of additions:

- a split vault with two export formats;
- WebAuthn PRF;
- specifications for the key-derivation function and nonces;
- re-anchoring migrations;
- sync between browser tabs;
- WebAssembly image codecs;
- a detector for canvas noise;
- a service-worker release gate;
- local telemetry aggregation;
- a verifier that repairs its own failures;
- a DOCX allowlist;
- detection of "unread ink";
- a limits table, a cost model, a P0 trace table and an alternatives table.

Most of these should be cut, deferred, or shrunk to one sentence. About eight are needed, and most of those are sentences, not new machinery.

### PRD lines the reviewer relied on, checked by the main context

These lines exist and say what the reviewer claims:

- **L286 (Decided list):** "Redacted values: the working set stores them, encrypted". This supports D3 and contradicts RED-5 (L136).
- **L288:** colleagues share a working set through SET-8 export.
- **DET-5:** defines three confidence bands: auto, needs review, dropped.
- **REV-8:** auto mode, rated P2.
- **RED-6:** `[TYPE]` label appearance.
- **RED-7:** images are re-encoded.
- **SET-2:** an approved decision applies to every document in the set.

### Limits on this review

- The repository has no code, and the POC source is not in it.
- Several claims rest on the reviewer's own knowledge and were not checked:
  - that MuPDF can decode PNG, JPEG and multi-page TIFF into pixmaps, and whether it can encode TIFF;
  - library behaviour in general.

---

## Triage of the earlier proposals

### Needed: keep, but small

| Proposal | Smallest form that fixes it |
| --- | --- |
| S7 B2 / S5 M2: key design | Two sentences of envelope encryption (F2) |
| S7 M7 / S5 M10: storage engine | Name the store: IndexedDB, plus OPFS for large files (F3) |
| S5 M9 / S7 M6: stored text model | Store each document's `DocumentModel` (F4) |
| S7 M2: Content Security Policy | `default-src 'self'`, and self-host library assets (F8) |
| S7 M1: account deletion and consent | One paragraph on ACC-6; settle consent (F9) |
| S6 #2 and #3: bands and spread rules | A three-row band table that links DET-5; the spread-rules table |
| S5 M5 / S7 B3: line 96 | A one-line rule about the POC |
| S5 M1, M7 / S7 M15-M17: stale text | Mechanical edits |

### Needed, but a cheaper option exists

| Proposal | Cheaper option |
| --- | --- |
| S7 B1 / S5 M6: split vault | Change the wording only, keep one store (F1) |
| S7 M8: WebAssembly image codecs | Use MuPDF pixmaps, which the design already ships (F5) |
| S7 M5 / S5 M11: verifier | Make the check decision-aware, with no automatic fix (F6) |
| S7 M9 / S5 M3: layout check | A conformance test, not a gate on every export (F7) |
| S7 M10: P0 trace table | A short list of PRD conflicts (F10) |

### Defer or reject

| Proposal | Why |
| --- | --- |
| S5 M2: WebAuthn PRF | Speculative; support differs across browsers; no requirement asks for it |
| S7 B2: KDF settings, nonce scheme, export format | Detail for the LLD |
| S5 M9: re-anchoring migration | The stored model keeps native locations (F4) |
| S7 M7: BroadcastChannel refresh, versioned export format | One lock is enough (F3) |
| S7 M8: canvas-noise test | Unneeded once canvas is out of the trust path (F5) |
| S7 M2: service-worker release gate, dependency-review policy | The gate is weak, and the policy belongs in a contributing guide (F8) |
| S5 M4: local aggregation into buckets | Choose no telemetry, or telemetry not linked to the account (F9) |
| S5 M11: automatic fix and re-verify loop | It puts a repair path inside the code that must be trusted (F6) |
| S5 M12: DOCX allowlist | DOCX is v1 (F10) |
| S5 M13: unread-ink detection | No measured miss rate (F10) |
| S7 M6: limits table | The D10 spike already sets the budgets (F4) |
| S7 M20: cost model | Premature before pilots (F10) |
| S7 M14: alternatives for every decision | Limit it to decisions that are costly to reverse (F10) |
| S5 N6: pool of fakes | Realistic fakes are v1 |
| S5 N7: send matches in other documents to review | Conflicts with SET-2 (F11) |
| S7 M4: separate key for the global policy | Covered by the key design in F2 |

---

## Findings on the earlier proposals

### F1. Splitting the vault into two stores is more than B1 needs - Severity: Major
- **Disagrees with:** S7 B1 (rated Blocker). **Concerns:** S5 M6, S6 #4; HLD L17, L203-208, L244, L389, L444.
- **Problem:**
  - D3 matches the PRD's own Decided list (L286). Only principle 5, L244 and the wording of RED-5 disagree, so this is a wording conflict, not a design flaw.
  - Splitting the store would add a second store, a second key, a second purge path and a second export format.
  - No P0 requirement drives that split:
    - The restore-only export is PSE-11, which is P1.
    - The P0 export is SET-8, and PRD L288 already decides that colleagues share through SET-8.
- **Recommendation:**
  - Keep one store.
  - Define "vault" as the surrogate-to-original columns of the `entity` table.
  - Restate principle 5: "A redacted entity never gets a surrogate and never appears in an output, report, log or certificate. Its normalised value stays in the encrypted registry (D3)."
  - Ask the PRD owner to bring RED-5 into line with L286.
  - In v1, PSE-11 can be a filtered export (only entities with a surrogate), not a separate store.
- **Counter-point from the main context:** under L288, sharing a set with a colleague hands over every redacted value and every original. That is a product decision, not a flaw in the design. The HLD should still say it plainly where it describes SET-8, so no one shares a set expecting it to be partial.

### F2. Key design: fix the contradiction in two sentences and leave the rest out - Severity: Blocker (the contradiction only)
- **Concerns:** S7 B2, S5 M2, S7 M4; HLD L204-205, L347, L373-377.
- **Problem:** "Non-extractable, and a passphrase can wrap it" cannot work, so a fix is required. The fixes proposed so far go past HLD level:
  - WebAuthn PRF is speculative.
  - KDF settings, the nonce scheme, the export format and a threat model with four attackers are LLD content.
- **Recommendation:** Two sentences, with the rest pushed to the LLD.
  1. "A random profile data key is stored only wrapped by a passphrase-derived key (PBKDF2). When no passphrase is set, it is a non-extractable CryptoKey in IndexedDB. It encrypts the global policy and each set's records. Export re-encrypts the set under a key derived from an export passphrase."
  2. "Without a passphrase, encryption protects against other sites and casual inspection of the disk, not against someone with the unlocked browser profile."
- **Effects:**
  - The PRD's Vault lock setting then needs no new design.
  - Per-set keys are needed only for crypto-erase on purge. Deleting the OPFS files already meets SET-5, so say which approach you choose.

### F3. Name one storage engine, and keep the consistency rules to one line - Severity: Major
- **Agrees** that the store must be named; **disagrees** with the scope of S7 M7. **Concerns:** S5 M10, S5 N8; HLD L346, L371-394.
- **Problem:** A working set is small, from hundreds to a few thousand entities and occurrences. The MVP does not need per-record encrypted indexes, transaction design, migration machinery or BroadcastChannel.
- **Recommendation:**
  - Keep records in IndexedDB, encrypted per record. IndexedDB gives transactions for free, which covers "a crash loses no work", and it can hold the CryptoKey.
  - On unlock, decrypt the whole set into the engine worker's memory and query it there.
  - Put large files in OPFS: originals and stored `DocumentModel`s.
  - Take one Web Locks lock per set. A second tab shows "open in another tab".
  - Add one schema-version field.
  - Drop BroadcastChannel and the versioned export format from the HLD.

### F4. Store the `DocumentModel`, and skip re-anchoring, a limits table and rebuild bounds - Severity: Major
- **Concerns:** S5 M9, S7 M6; HLD L16, L218-221, L379-384, L393.
- **Needed:**
  - Store each `DocumentModel`, with OCR words and boxes, encrypted beside its original. Without it, every approval re-parses the whole set and runs OCR on its scans again.
  - Add one column to `export` for the engine, model and pack versions. DET-12 needs the detection level recorded anyway.
  - Add one line on COOP/COEP (cross-origin isolation). It is a real platform constraint for multi-threaded onnxruntime and Tesseract.
- **Rejected:**
  - **Re-anchoring migration.** The stored model keeps native locations. If an incompatible change ships, the whole design is one sentence: re-read the document and send unmatched occurrences to review.
  - **Limits table.** The D10 spike already sets a budget for each level (Implementation-Plan L158). Point to it.
  - **Bounds on rebuild cost.** L219 already rebuilds only when a document is viewed or exported.
- **Also drop `outputs/` (L383).** Outputs are derived (principle 4), so storing them adds a cache to encrypt, purge and export for no stated need. Keep only the hash and certificate in `export`, and regenerate the file on download.

### F5. For images, use MuPDF, which the design already ships, instead of new codecs - Severity: Major
- **Agrees** with S7 M8's problem; **disagrees** with its fix. **Concerns:** S6 #11; HLD L45, L75, L94, L237, L345.
- **Problem:** Both the WebAssembly codecs and the canvas-noise test exist only because the HLD sends pixels through canvas.
- **Recommendation:**
  - Decode images and blank pixels through MuPDF.js pixmaps, and keep canvas out of the trust path.
  - TIFF output may need an encoder MuPDF lacks (not verified). PRD DOC-7 marks TIFF P0, while plan phase 7 has only PNG and JPEG. Send that conflict to the PRD owner instead of adding a codec now.
  - Accept lossy JPEG re-encoding. RED-7 already implies it.

### F6. Make the verifier aware of decisions, and reject the automatic fix loop - Severity: Major
- **Concerns:** S5 M11, S7 M5; HLD L234-247.
- **Problem:** S5's loop (turn a leftover value into a new edit, rewrite, verify again) puts a repair path inside the component that must be trusted, and could hide writer bugs.
- **Recommendation:**
  - Search only for values of entities set to Redact or Pseudonymise, at word boundaries, excluding spans the user chose to keep.
  - Turn "pattern detectors find nothing" from a release gate into new findings for review.
  - On failure, show where the hit is and send the user back to review.
  - No automatic fix.

### F7. Make the layout rule a test, not a gate on every export - Severity: Nit
- The contradiction itself is already covered by S5 M3 and S7 M9. **Concerns:** HLD L74, L83, L458.
- **Problem:** A per-export check under principle 6 (fail closed) would block a correct, private output over a cosmetic shift. Layout drift is not a privacy failure.
- **Recommendation:**
  - Make "glyphs outside edited boxes do not move" a test in the leak suite. It also catches the MuPDF 1.28 text-shift risk.
  - For PDF pseudonyms, use the PRD's rule: redact, then draw the placeholder in the box, shrunk to fit, falling back to a `[TYPE]` label (RED-6).
  - Give full-length surrogates in the AI-facing text taken from the `DocumentModel`.

### F8. On the privacy boundary, keep the two changes that matter and drop the release gate - Severity: Major
- Narrows S7 M2. **Concerns:** S5 N2; HLD L262-271.
- **Needed:**
  - Use a Content Security Policy of `default-src 'self'`.
  - Self-host the assets that Transformers.js, onnxruntime-web and Tesseract.js fetch from CDNs by default. As things stand they break L266.
  - Move the plan's network-allowlist test from phase 8 to phase 0, because these libraries arrive in phase 0.
- **Rejected:**
  - **The service-worker release gate.** Our own server delivers the service worker, so the gate adds little, and it duplicates the v1 extension.
  - **A dependency-review policy.** It belongs in a contributing guide, not the HLD.

### F9. Telemetry and account deletion: choose the cheapest form that meets the rules - Severity: Major
- **Concerns:** S5 M4, S7 M1; HLD L322-324; PRD L229 against ACC-11; PRD ACC-6.
- **Problem:** Telemetry is the only part of the MVP that needs its own server store, schema, test, consent screen and deletion path.
- **Recommendation:** The PRD owner picks one of two options.
  - **(a) No telemetry in the MVP.** Credit spends and asset downloads already show usage.
  - **(b) Opt-in telemetry** with a fixed schema and a random install id not linked to the account. With no account link, it needs no deletion path.

  Either way, add one paragraph on ACC-6 (P0): deletion removes the Auth0 user and the Accounts API rows, plus the Stripe customer in v1. Local data goes with the user's purge.
- **Counter-point from the main context:** option (a) contradicts ACC-11, which is P0 as written. Choosing it means changing the PRD, not just the HLD.

### F10. Defer the v1 and speculative machinery the reviews proposed - Severity: Nit each
- **Disagrees** with S5's Major rating on M12 and M13.

| Proposal | Recommendation |
| --- | --- |
| S5 M12: DOCX allowlist | DOCX is v1. List "evaluate an allowlist rebuild" as an input to the DOCX leak-vector list. |
| S5 M13: unread-ink detection | Image pages already default to review. Revisit only if the 50 real scanned documents show misses that reviewers do not catch. |
| S5 N6: pool of fakes | Realistic fakes are v1. |
| S7 M20: cost model | One line: "model download size is a D10 budget". |
| S7 M14: alternatives table | Limit it to decisions that are costly to reverse: hosted vs installed, D1, D2, D3, D4, D9. D8 is cheap to reverse (L448). |
| S7 M10: P0 trace table | Replace it with a "PRD conflicts to resolve" list (below). |

**PRD conflicts to resolve:**

| Requirement | Conflict |
| --- | --- |
| PSE-9 | P0 in the PRD, v1 in the HLD |
| PSE-10, restore into DOCX | P0, but DOCX is v1 |
| DOC-7, TIFF | P0, but the plan has only PNG and JPEG |
| RED-5 | Contradicts the PRD's Decided list (F1) |
| Telemetry | L229 contradicts ACC-11 (F9) |
| "Detection depth" setting | Does not match DET-12's three levels |

### F11. Sending matches in other documents to review would break SET-2 - Severity: Nit
- **Concerns:** S5 N7, S6 #3; HLD L218, L226-227.
- **Problem:** SET-2 (P0) says an approved decision applies to every document. A review step in other documents breaks that.
- **Recommendation:**
  - Spread approved values by normalised match at word boundaries, so "Bill" does not hit "billing".
  - State the case rule (whether "Bill" matches "bill") in S6 #3's spread-rules table.

### F12. Define the bands by linking the PRD, not with a new subsection - Severity: Nit
- **Concerns:** S6 #2; HLD L15, L35, L82.
- **Recommendation:**
  - Add a three-row band table that links DET-5.
  - Mark auto mode as P2 (REV-8) in principle 3.

---

## Findings on the whole design, not raised before

### W1. The MVP builds a quota with nothing to upgrade to - Severity: Major
- **Concerns:** HLD L283-326, L429, L432; plan phase 8; PRD release phases (L244); ACC-2, -4, -5, -10, -12.
- **Problem:**
  - Billing and the paid plan are v1.
  - The MVP still builds:
    - a credit ledger;
    - a credit spend that is safe to retry;
    - offline credit batches;
    - a meter for pasted characters;
    - a trial counter in the browser;
    - a plans page.
  - With no paid plan, the quota earns nothing, caps pilot users and produces no signal about who would upgrade. Under the AGPL, anyone can bypass it.
  - S5 M14 questioned how the offline batch works. The bigger question is whether the MVP needs any metering at all.
- **Recommendation:**
  - Ask the PRD owner whether the MVP needs sign-in only, or nothing at all. Credits, both meters and the trial counter would then move to v1, beside Stripe.
  - If metering stays in the MVP, the smallest form is a balance counter on the server plus one idempotency key per document.

### W2. Language neutrality is still a design goal after D1 settled the language - Severity: Nit
- **Concerns:** extends S5 M1, N3 and N5; HLD L5, L19, L41, L55, L59-66, L354-362.
- **Problem:**
  - PRD Goal 7 asks for separable formats, detectors and front ends, not language independence.
  - Keeping language neutrality pushes toward one Web Worker per stage, which means copying a `DocumentModel`, anchored character by character, between workers.
- **Recommendation:**
  - Write the contracts as TypeScript interfaces.
  - Run the whole pipeline in one engine worker.
  - Drop "the language can change" from L5 and principle 7.
  - Keep "data in, data out", which still lets a stage move out later.

### W3. v1 features are described at MVP depth, which draws v1 design into review - Severity: Nit
- **Concerns:** HLD L76, L81, L186-199, L141-153, L108-116.
- **Problem:** The MVP HLD carries full designs for v1 features: the DOCX carrier list, the restore rules for realistic fakes, seven rule sources, and a table of OCR box formats.
- **Recommendation:**
  - Cut each one to the constraint the MVP must respect. For example: "DOCX side channels flow through `DocumentModel` side channels; the leak list comes first."
  - Move the detail into v1 design notes.

### W4. Models and packs are cached in two places - Severity: Nit
- **Concerns:** HLD L255, L378-379.
- **Recommendation:**
  - Cache every static asset in the service worker's Cache Storage.
  - Remove `models/` and `packs/` from the OPFS layout.

### W5. Drop the hash whose salt is discarded - Severity: Nit
- **Concerns:** HLD L244.
- **Recommendation:** Reports and certificates carry nothing derived from the removed values. That meets RED-5 with no extra mechanism.

---

## Severity disagreements with earlier stages

| Earlier finding | Earlier severity | Stage 8 view | Reason |
| --- | --- | --- | --- |
| S7 B1: redacted values in the vault | Blocker | Major | A wording conflict; the PRD's L286 supports D3 (F1) |
| S7 B3: line 96 about the POC | Blocker | Major | A one-line fix with clear intent |
| S7 B2: key design | Blocker | Blocker | Holds for the impossible mechanism only; the fix is two sentences (F2) |
| S5 M12: DOCX allowlist, and S5 M13: unread-ink detection | Major | Nit, deferred | F10 |
| S7 M20: cost model | Major | Nit | F10 |
| S7 M14: alternatives table | Major | Nit, narrower | F10 |
| S5 M11: verifier's automatic fix | — | Reject the fix | F6 |
| S5 N7: send matches to review | — | Reject | Conflicts with SET-2 (F11) |

---

## Where to start

1. **Settle with the PRD owner the conflicts behind most of the proposals:**
   - RED-5 against L286 (F1);
   - telemetry, L229 against ACC-11 (F9);
   - whether the MVP needs metering at all (W1);
   - PSE-9, PSE-10 and TIFF (F10, F5).
2. **Make the three choices the HLD leaves open, at one sentence each:**
   - the key setup (F2);
   - the store (F3);
   - storing each document's `DocumentModel` (F4).
3. **Apply the mechanical edits from Stages 5-7:**
   - the line 96 POC rule;
   - stale decisions;
   - the superseded build order;
   - the wrong counts.
4. **Close the items in the "Defer or reject" table as "not in the MVP"**, so the next review round does not reopen them.
