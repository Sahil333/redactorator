# Stage 7: Critic Review (round 1)

**Target:** `docs/HLD.md` (lines 1-488, the feature range)
**Background files given to reviewers:** `docs/PRD.md`, `docs/images/hld-architecture.png`, `docs/Implementation-Plan.md`
**Standards:** `feature-spec-standard.md` for the design and structural reviewers. The style reviewer used its persona rules only.

## Reviewer status

| Reviewer | Status | Raw findings |
| --- | --- | --- |
| `egm-design` | completed | 2 Blocker, 11 Major, 12 Nit |
| `egm-structural` | completed | 0 Blocker, 9 Major, 7 Nit |
| `egm-style` | completed | 1 Blocker, 12 Major, 13 Nit |

**After merging overlaps: 3 Blocker, 21 Major, 21 Nit.** The design reviewer's verdict is "not ready to approve". The structural reviewer's is "revise".

**Severity rule.** When reviewers gave one issue different severities, it is listed at the highest one, and the lower ratings are noted.

**Finding ids.** Each finding has an id in the form `<reviewer>-1-<n>`, where 1 is the round.

**PRD claims checked by the main context.** Each PRD requirement the reviewers cite says what they claim it says:

| Requirement | Priority | What it says |
| --- | --- | --- |
| RED-5 (L136) | P0 | Redacted values are never written to the vault. |
| PSE-10 (L154) | P0 | Restore into `.txt`, `.md` and DOCX files. |
| ACC-6 (L189) | P0 | Delete the account and all account data. |
| DOC-7 (L92) | P0 | Lists TIFF among the supported formats. |
| Vault lock (L212) | P0 | Passphrase and auto-lock timeout. |
| Safety NFR (L233) | — | "A crash loses no work." |
| Performance NFR (L234) | — | 2 s per page. |

**Repeated from earlier stages.** Findings already raised in Stages 5 or 6 are marked *(seen in S5/S6)*. That three separate stages raised them is evidence they are real, not reviewer noise.

---

## 🔴 Blockers

### B1. Redacted values are written to the vault, which breaks principle 5, line 244 and PRD RED-5 (P0)
- **Ids:** `design-1-B1` *(seen in S5 M6, S6 #4)*
- **Scope:** L17, L203, L205, L208 (D3), L244, L389, L444
- **Problem:**
  - Principle 5 and RED-5 say a redacted value never reaches the vault. L244 says removed values are held in memory only.
  - D3 instead keeps the normalised redacted value in the registry. L389 says the registry *is* the vault ("there is no separate vault store").
  - So the vault export a user shares with a colleague so they can restore (L205, PSE-11) hands over every value the user chose to destroy. If that export is the whole set (SET-8), it hands over the encrypted originals too.
- **Recommendation:** Pick one of two routes.
  - **Split the store:** a restore vault holding surrogate-to-original pairs for pseudonymised entities only, and a separate matching registry holding redacted values and originals. Each gets its own export path.
  - **Keep one store:** rewrite principle 5 and L244, and ask the PRD owner to change RED-5.

  Either way, state exactly what each export contains: vault export, set export and policy export.

### B2. The encryption key design cannot work as written, and without a passphrase it protects little
- **Ids:** `design-1-B2` *(seen in S5 M2)*
- **Scope:** L203-206, L258, L347, L460; PRD Vault lock (P0) and the PRD risk "The working set is itself sensitive"
- **Problem:**
  - **The wrap cannot happen.** Web Crypto's `wrapKey` refuses a non-extractable key, so "kept non-extractable. A passphrase can wrap it" fails as written.
  - **No passphrase means weak protection.** The passphrase is optional here, though the PRD's Vault lock is P0. Without it, the key sits in the same origin storage as the encrypted data. That does not stop:
    - someone with a copy of the disk or browser profile;
    - anyone using an unlocked browser;
    - any script running on our origin.
  - **Details left out:**
    - the key-derivation function and its settings (Web Crypto offers only PBKDF2);
    - how auto-lock works;
    - how AES-GCM nonces (unique per-encryption values) are chosen;
    - the export file format and its version;
    - what happens to an export when the user forgets the passphrase.
- **Recommendation:**
  - Add a short threat model naming the attackers this defends against: a stolen disk or profile, a shared computer, a malicious script on our origin, an export file in transit.
  - Use envelope encryption:
    1. A random data key is stored only in wrapped form.
    2. It is wrapped by a key derived from the passphrase.
    3. On unlock, it is unwrapped into a non-extractable key held in memory.
  - Make the passphrase mandatory, or state plainly what a set without one does not protect against.
  - Specify the key-derivation function and its settings, the nonce scheme, the auto-lock timeout and the export format.

### B3. Line 96 forbids reading the POC, while the rest of the HLD makes the POC the specification
- **Ids:** `style-1-B1`, `structural-1-9`, `design-1-M9` *(seen in S5 M5, S6 #1)*
- **Severity note:** the style reviewer rated this Blocker; the structural and design reviewers rated it Major. It is a one-line fix, but four separate reviewers stumbled on it, and an implementer cannot follow both instructions.
- **Scope:** L96, against L5, L29, L177, L405-416 and L471, and the Implementation Plan's use of `verify.py` as the test checker
- **Problem:**
  - "Do not use or read anything from that POC code" contradicts every place that names POC modules as the specification.
  - The next sentence is ungrammatical: "the build according to HLD steps use".
  - The POC repository is never linked or given a path, so a new reader cannot find it.
- **Recommendation:**
  - Replace L96 with the actual rule, for example: "POC code is not ported. Its fixtures, leak list and `verify.py` are the specification and test checker."
  - Rewrite the next sentence as: "The browser build uses the same engines compiled to WebAssembly: …"
  - Give the POC's location once, in Path from the POC or in Sources.

---

## 🟡 Major: security and the privacy boundary

### M1. Telemetry is on by default, against the PRD, and no account-deletion flow is designed
- **Ids:** `design-1-M1`, `style-1-M7` *(seen in S5 M4)*
- **Scope:** L275, L322, L324; PRD Telemetry NFR (L229), ACC-6 (P0)
- **Problem:**
  - "Users can switch telemetry off" means it is on by default. The PRD's non-functional requirement says off by default, with consent. (PRD ACC-11 contradicts that requirement, so the PRD needs fixing too.)
  - Events tagged with the account id are personal data, yet no retention period or legal basis is given.
  - ACC-6 (P0, delete the account and all its data) does not appear in the HLD. Nothing covers deleting from Auth0, Stripe, the credit ledger or the telemetry store.
- **Recommendation:**
  - Make telemetry opt-in, with a consent screen.
  - Set a retention period, and consider an id for telemetry that is not linked to the account.
  - Design account deletion across every store.

### M2. The data-in controls miss leaks through dependencies and requests other than `fetch`; the in-app hash proves nothing
- **Ids:** `design-1-M2` *(the hash point was seen in S5 N2)*
- **Scope:** L262-271, L450, L456
- **Problem:**
  - **The policy is too narrow.** The Content Security Policy only limits `connect-src`. A compromised npm package bundled into our build counts as "our origin". It could send data out through:
    - image loads (`img-src`);
    - form posts;
    - frame or top-level navigation;
    - `window.open`;
    - WebRTC, which the Content Security Policy does not cover.
  - **Libraries fetch from outside hosts by default.** All of these break L266 unless they are self-hosted:
    - Transformers.js fetches models from the Hugging Face hub;
    - onnxruntime-web fetches its WebAssembly from a CDN;
    - Tesseract.js fetches its core and language data from jsDelivr.
  - **The hash checks itself.** The MVP's in-app release hash is reported by the same code it is meant to vouch for.
- **Recommendation:**
  - Specify the full Content Security Policy: `default-src 'self'`, `img-src`, `form-action`, `frame-src`, `worker-src`, `script-src 'wasm-unsafe-eval'` and `base-uri`.
  - Add dependency controls: a pinned lockfile, a review policy for updates, and a check of the build against the reproducible build.
  - Name the settings that self-host the model, onnxruntime and Tesseract.js assets, and add tests that fail if the app contacts those CDNs.
  - Either state that the MVP has no client-side check of the code it is served, or add a service-worker rule that refuses releases missing from the signed log.

### M3. "Nothing else runs server-side" leaves out the telemetry service
- **Ids:** `style-1-M6`
- **Scope:** L25, L277, against L275 and L324; the diagram at L23
- **Problem:** L277 says only the accounts API runs server-side. L324 describes a telemetry endpoint and an analytics store. L25 and the diagram show two flows, but L275 lists three.
- **Recommendation:**
  - Name both server-side pieces at L277.
  - Add telemetry at L25.
  - Label the diagram arrow "app in; account data and telemetry out".

### M4. The global policy is said to hold no user data and is not encrypted
- **Ids:** `style-1-M8`
- **Scope:** L373, L377
- **Problem:** The PRD's global always-hide and never-hide lists hold client names, codenames and addresses. Yet `policy.json` is not marked as encrypted, unlike `set.db`, `originals/` and `outputs/`.
- **Recommendation:** Encrypt the global policy the same way as set data, or keep term lists out of `policy.json` and say where they live.

---

## 🟡 Major: data flow, storage and verification

### M5. The verifier would block legitimate exports and offers no way forward
- **Ids:** `design-1-M3`, `style-1-M12` *(seen in S5 M11)*
- **Scope:** L234-247, L38
- **Problem:**
  - "Pattern detectors find nothing" fails any document in which the user chose Keep for an ID, phone number or email.
  - Searching raw bytes for removed values also fails on short or common values. For example, redacting "Jane" while keeping "Jane Street" would fail.
  - Under fail-closed, these false failures leave the user stuck.
- **Recommendation:**
  - Check only entities with the Redact action, using the matcher's own normalisation and word-boundary rules.
  - Exclude spans that belong to kept entities.
  - Define what the user can do when a check fails: find the hit, re-mark it, run the check again.

### M6. No capacity limits or performance budget, and every approval re-scans the whole set
- **Ids:** `design-1-M4`, `style-1-M10` *(seen in S5 M9)*
- **Scope:** L216-221, L386-394, L459; PRD Performance NFR (2 s per page)
- **Problem:**
  - **Every approval re-runs the matcher over every document.** No `DocumentModel` or OCR result is stored, so each re-scan may parse every PDF and run OCR again on scanned pages. For scale, the POC took about 6 minutes for 210 pages on a CPU.
  - **No limits are set** for file size, pages, documents per set or entities per set.
  - **Page-at-a-time processing helps less than it seems.** MuPDF.js keeps the whole document in a WebAssembly heap of at most 4 GB, so it helps only with detection, not with write and verify.
  - **No in-browser estimate** is given against the 2 s per page target.
  - **Threading needs extra headers.** Multi-threaded onnxruntime and Tesseract need cross-origin isolation (COOP/COEP headers), and the HLD never mentions it.
  - **"Needs no propagation code" (L221)** contradicts the re-scan described at L218.
- **Recommendation:**
  - Add a table of limits and budgets for each detection level.
  - Store each document's `DocumentModel` and OCR output, encrypted, so a re-check is a text search.
  - Bound the cost of rebuilding stale outputs.
  - Decide on COOP/COEP and test it with the Auth0 redirect.
  - Restate L221 so it does not deny the re-scan.

### M7. The storage engine and its consistency rules are not specified
- **Ids:** `design-1-M5`, `structural-1-N15`, `style-1-N12` *(seen in S5 M10 and N8, S6 #4)*
- **Scope:** L203, L346, L371-396
- **Problem:**
  - **No engine is named** for `set.db`.
  - **Queries may need full decryption.** If each record is encrypted separately, the `alias` table cannot be indexed without decrypting the whole set.
  - **Several behaviours are missing:**
    - two tabs on one set (OPFS sync handles are exclusive);
    - atomic writes, which the PRD's "a crash loses no work" needs;
    - schema migration after an update;
    - an export format with a version.
  - **Storage is named three ways:** origin-private storage, OPFS, and OPFS plus IndexedDB.
- **Recommendation:**
  - Name the store and the level at which data is encrypted.
  - Allow one writer per set, using Web Locks, with BroadcastChannel to tell other tabs to refresh.
  - Define transactional writes, a schema version and a versioned export format.
  - Use one storage term throughout.

### M8. The canvas-based image path does not work as specified
- **Ids:** `design-1-M6` *(TIFF mismatch seen in S6 #11)*
- **Scope:** L45, L75, L94, L237, L345
- **Problem:**
  - **TIFF is not supported.** Chrome and Firefox canvas cannot decode TIFF, yet PRD DOC-7 (P0) requires it. Multi-page TIFF is not covered at all.
  - **Anti-fingerprinting breaks canvas readback.** Brave, Firefox's resistFingerprinting and Safari's private browsing add noise to what canvas returns. Then either the "redacted regions are uniform" check fails, or the noise goes unnoticed in the rest of the image.
  - **Re-encoding is lossy.** JPEG passed through canvas loses quality and drops colour (ICC) profiles.
- **Recommendation:**
  - Decode and encode with WebAssembly codecs, or with MuPDF's own image handling, instead of canvas.
  - Say whether TIFF is in the MVP. The plan's phase 7 lists only PNG and JPEG.
  - Add a test that detects altered canvas readback.

### M9. The layout rules for PDFs and images contradict each other and cannot be checked
- **Ids:** `design-1-M8`, `structural-1-7`, `style-1-M1` *(seen in S5 M3, S6 #7)*
- **Scope:** L74, L83, L458
- **Problem:** L83 says pseudonyms are "approximate", and then that replacement "shall not change the format". `PERSON_12` cannot fit the box of "Al". The verifier never checks layout, even though MuPDF 1.28 is known to shift text after redactions. "eg." is malformed.
- **Recommendation:**
  - Replace "shall not" with a rule that can be measured: glyphs outside the edited boxes keep their positions within a set tolerance, checked by comparing the layout before and after.
  - Define the fitting rule for a surrogate that is too long: shrink it to a minimum size, then truncate it with a marker, then fall back to a `[TYPE]` box.
  - Move any hard requirement to the PRD.

### M10. The HLD does not trace to several P0 requirements and never flags the gaps
- **Ids:** `design-1-M7` (with the structural reviewer's note outside its lane) *(partly seen in S5 N1 and N6)*
- **Scope:** L57, L185-186, L129-137, L425-433
- **Problem:**
  - PSE-10 (P0) needs restore into DOCX, but the DOCX adapter comes after the MVP, and restore depends on an adapter (L57).
  - PSE-9 is P0 in the PRD, but v1 in the HLD and in the PRD's own Decided list.
  - The PRD's "Detection depth: fast or thorough" setting does not match the HLD's three levels.
- **Recommendation:**
  - Add a short table mapping each P0 requirement to the section that delivers it.
  - Flag each conflict and send it back to the PRD owner.

### M11. "The browser is never the only copy of a vault" claims a guarantee the design cannot keep
- **Ids:** `style-1-M9`
- **Scope:** L403, against L206 and L460
- **Problem:** The design can only prompt for a backup; it cannot force one. L460 admits a lost vault is unrecoverable.
- **Recommendation:** Rewrite it as "the design does not rely on the browser as the only copy". List export, import and the backup prompt.

### M12. "Proven parts" and "already exists" claim more than has been checked
- **Ids:** `style-1-M2`
- **Scope:** L19, L336, against L76, L127 and L488
- **Problem:**
  - GLiNER2-PII in the browser and MuPDF.js pixel redaction are listed as unverified.
  - The DOCX adapter's walk through runs and offsets is custom parsing, built on top of the XML parser.
- **Recommendation:**
  - Reword principle 7 to "established libraries; no home-made PDF, image or crypto code".
  - At L336, say which parts are still unconfirmed.

---

## 🟡 Major: document structure and consistency

### M13. The document has no problem statement or goals and non-goals, and does not link the PRD
- **Ids:** `structural-1-1`, `structural-1-N10`, `design-1-Nit` *(seen in S6 #5)*
- **Scope:** L1-19, L279
- **Problem:**
  - The feature-spec standard requires both sections, and neither exists.
  - The only non-goal sits at L279, inside the hosted-delivery section.
  - The PRD is mentioned but not linked.
- **Recommendation:**
  - Add a "Problem and goals" section before Design principles, with goals, non-goals and a link to `PRD.md`.
  - Move L279 into it.

### M14. There is no Alternatives Considered section, and several decisions have no alternative at all
- **Ids:** `structural-1-2`, `design-1-M10`, `structural-1-N13`
- **Scope:** L153, L199, L208, L279, L306-312, L354-369, L396, L450; D8 (L289, L448); quota model (L283-312); store and telemetry
- **Problem:**
  - Alternatives are spread over nine places, each in a different form.
  - Some rejections give no reason (L396, L450).
  - Some decisions name no alternative:
    - D8 (Clerk, Cognito, Keycloak or Ory, or licence keys);
    - the credit-per-document quota (a subscription with no metering, or signed offline tokens);
    - the single encrypted store;
    - self-hosted telemetry.
  - The "Asset gating (dropped)" row sits inside the design table, and "the only one" heads a table with three rows.
- **Recommendation:** Add one table with the columns Decision, Chosen, Rejected and Reason, giving a concrete cost for each rejection, and leave pointers at the old locations.

### M15. Decided items are still written as open
- **Ids:** `structural-1-6`, `style-1-M4`, `design-1-Nit` *(seen in S5 M1, S6 #6)*
- **Scope:** L63, L146, L343, L349, L362, L422
- **Problem:**
  - L349 still lists D8 as "To confirm", though it is decided as Auth0.
  - L343 points to D5 where the open item is D10.
  - L362 and L422 say the spike settles or confirms D1, though D1 is decided.
  - L63 and L146 still treat the language as open.
- **Recommendation:** Make each line match the decision log. The style reviewer gives replacement text for each line.

### M16. The superseded build order is still the thing other sections cite
- **Ids:** `structural-1-3`, `style-1-M5`, `design-1-Nit` *(seen in S5 M7, S6 #6)*
- **Scope:** L418-433; citations at L137, L362, L446, L451, L457, L461
- **Problem:**
  - Other sections cite "build step N", and those steps do not match the plan's phases.
  - The link to the plan is a claude.ai address, which may not open for every reader.
  - The HLD is dated Nov 15 but refers to the plan, which is dated Nov 18.
- **Recommendation:**
  - Delete the list, or move it to an appendix marked superseded.
  - Point each citation at a plan phase.
  - Link `Implementation-Plan.md` by relative path.
  - Update the date or add a revision note.

### M17. The Risks and open decisions section has the wrong count, no ordering and an unlabelled table
- **Ids:** `structural-1-4`, `style-1-M3`, `design-1-Nit` *(seen in S5 M1, S6 #9)*
- **Scope:** L435-467
- **Problem:**
  - It says "Nine decisions are open", but two are.
  - "Shape everything else" overstates, and "before any build work" contradicts the plan, where the spikes run alongside the build.
  - Neither decision list is in order, and "Launch scope" has no id.
  - The risk table has no heading, so it reads as part of the Decided list.
- **Recommendation:**
  - Change the count to "Two decisions are open, D10 and D6; both are settled by spikes that run beside the build".
  - Give Launch scope an id.
  - Sort both lists.
  - Split the section under three subheadings: Open decisions, Decided, Risks and mitigations.

### M18. Bold lines stand in for headings, inconsistently with the real subheadings
- **Ids:** `structural-1-5`
- **Scope:** L183, L190, L201, L253, L260, L273, L285, L294, L300, L306, L314, L328, L354, L442
- **Problem:** Half the sections use real subheadings and half use bold lines. Bold lines create no anchors, do not appear in an outline and cannot be linked, yet the body cross-references sections by name.
- **Recommendation:** Turn each standalone bold label into a real subheading, and keep bold only for lead-ins within a sentence.

### M19. The spread rules disagree with each other, and the "Two limits" list has four bullets
- **Ids:** `structural-1-8`, `style-1-M11`, `design-1-Nit` *(seen in S5 N7 and N9, S6 #3)*
- **Scope:** L214-228
- **Problem:**
  - The heading says two items but four follow, and two of them are rules rather than limits.
  - "To be honest about" is filler.
  - Bullet 3 repeats L214 and L218.
  - Matching ignores case, so it is unclear whether an approved "Bill" matches "bill", given L226.
- **Recommendation:**
  - Split the list into "Limits" and "Spread rules".
  - Remove the repeated text.
  - State the case rule for short values.
  - See S6 #3 for the proposed spread-rules table.

---

## 🟡 Major: cost

### M20. No cost model for the infrastructure
- **Ids:** `design-1-M11`
- **Scope:** L255, L273-277, L326, L458
- **Problem:**
  - Each new profile downloads WebAssembly modules and models, possibly hundreds of MB at the Full level.
  - Safari's 7-day eviction and users clearing storage trigger the download again.
  - Free users are unmetered for downloads, so CDN traffic is unbounded.
  - No estimate is given for Accounts API load or the size of the telemetry store.
- **Recommendation:**
  - Add a short model covering:
    - bytes per first load at each level;
    - how often re-downloads happen;
    - egress cost per 1,000 free users;
    - telemetry events per user per month;
    - peak requests per second to the Accounts API.
  - Name the rate limits.

### M21. Present-tense claims credit the product with what only the POC does
- **Ids:** `style-1-N1`, `style-1-N2`, `style-1-N7` (raised to Major here because they bear on safety claims)
- **Scope:** L57, L118, L177, L283
- **Problem:**
  - L118: "work today" describes the POC, not the browser product.
  - L177: "a mechanical change" conflicts with L159 ("tested, not trusted").
  - L57: restore "works on any format" ignores PDF and image limits and the restore scope in the PRD.
  - L283: "enforced" overstates a quota that L310 says can be bypassed.
- **Recommendation:** Use the style reviewer's rewordings: "handled in the POC", "field-for-field mapping; still fixture-gated", "fidelity follows that format's limits" and "metered".

---

## 🟢 Nits

| Id | Scope | Issue | Fix |
| --- | --- | --- | --- |
| `design-1-Nit`, `style-1-N13` | L244 | A salted hash whose salt is discarded cannot be checked by anyone. | State its purpose or drop it. RED-5 already keeps the values out of reports. |
| `design-1-Nit` *(S5 N9)* | L161 | A JavaScript regex cannot be interrupted on the same thread. | Run the pattern in a worker that can be terminated, or use RE2 compiled to WebAssembly. Also check imported packs for catastrophic backtracking. |
| `design-1-Nit` | L192 | The restore matcher has no word boundaries, so `PERSON_1` matches inside `PERSON_10`. | Match on word boundaries. |
| `design-1-Nit` | L34, L127 | No chunking rule for NER context limits, or for entities split across lines, columns or pages. | Define one. |
| `design-1-Nit` | L129 | `navigator.deviceMemory` exists only in Chromium. | Say what Firefox and Safari fall back to. |
| `design-1-Nit` | L255 vs L379 | Models are cached both by the service worker and in OPFS. | Pick one. |
| `structural-1-11`, `style-1-N11` | L3, L7, L471 | Three different date formats. | Use one. |
| `structural-1-12` | L316-322 | A two-column table pairs two unrelated lists. | Use two lists, or the columns Item and Sent?. |
| `structural-1-14` | L29-39 | The column header "Stage" also covers the helper row. | Rename it "Contract", or mark the helper row. |
| `structural-1-16` | L74, L127, L289, L341, L469-488 | PDF.js, Auth0 and GLiNER2-PII are never linked. Sources lists pages the body never cites. | Make the links match. |
| `style-1-N3` | L5 | The stage is called "decide" here but "Resolver" elsewhere. | Use "resolve". |
| `style-1-N4` | L214 | "Third contract" (a legal document) clashes with "contract" meaning an interface. | Say "third document". |
| `style-1-N5` | L5, L133-135, L185, L255, L348, L350, L364 | Claims with no measure behind them: small, ample, most laptops, easiest, fast, easy to hire for, least code, clean. | Give a measure or drop the word. |
| `style-1-N6` | L11, L141 | "Most questions" and "most of what we need". | Name what is covered. |
| `style-1-N8` | L264, L269 | A table cell lists a benefit where a threat belongs, and one control claims more than it does. | Reword as threats. |
| `style-1-N9` | L271 | "Settled in D9" overstates what D9 does. | "D9 reduces it." |
| `style-1-N10` | L5, L7, L13, L25, L251, L275 | The no-upload claim appears six times, and L7 repeats L5. | Merge L7 into L5. |
| `style-1-N12` | L70, L208, L336, L393 | "Truly"; "anyway"; L336 points at the wrong table; "Lets SET-6 detect" makes a requirement the actor. | Fix each. |
| `structural-1-N16`, `design-1-Nit` | L74, L96 | "eg." and a double space. | Fix. |
| `design-1-Nit` | L223 | Covered by M19. | — |
| `design-1-Nit` | L437 | Covered by M17. | — |

---

## Settled and kept

The style reviewer checked these caveats and found each one backed by evidence. They need no change:

| Line | What it covers |
| --- | --- |
| L106 | The spike's coverage limits |
| L116 | PaddleOCR's box reference |
| L150 | The secrets-patterns-db licence |
| L247 | What the certificate does not claim |
| L364 | Counsel's confirmation of the licence |
| L369 | The search for a replacement PDF engine |
| L488 | The list of unverified claims |

## Round status

- **Round 1 is not clean.** It has 3 Blockers and 21 Majors, and none of them is settled yet.
- **Converging takes two clean rounds in a row**, with a cap of 5 rounds.
- **The next step is resolution.** In `egm-resolve`, each finding is either marked PROPOSE FIX or CONTEST, and approved edits are applied to `docs/HLD.md`.

## Where to start

1. **B1 and B2: decide how the vault is split and how keys work.** These are the only real design blockers, and both touch P0 promises in the PRD.
2. **B3, M15, M16 and M17: fix the stale and contradictory text.** These are mechanical edits, and they clear most of the cross-stage duplicates.
3. **M1, M5 and M9: work with the PRD owner.** They cover telemetry consent, a verifier that knows which values were kept, and a layout rule that can be measured. Some of them need PRD edits first.
4. **M6, M7 and M8: settle the storage engine, the stored `DocumentModel` and the image codecs.** These decide whether the MVP's performance and format promises can be met.
