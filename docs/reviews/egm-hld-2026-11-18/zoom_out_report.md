# Stage 5: Initial Zoom Out Review

**Target:** `docs/HLD.md` (lines 1-488, full file)
**Background files given to reviewers:** `docs/PRD.md`, `docs/images/hld-architecture.png`, `docs/Implementation-Plan.md`
**Standard:** `zoom-out-standard.md`

## Reviewer status

| Reviewer | Status | Raw findings |
| --- | --- | --- |
| `egm-zoom-out` | completed | 11 Major, 6 Nit |
| `egm-inventive-catalyst` | completed | 8 Major, 4 Nit |

After merging overlaps: **0 Blocker, 15 Major, 9 Nit.**

Both reviewers say the context is sufficient: the objective (browser-only redaction and pseudonymisation, with removal you can prove and restore across a working set) and the reasons for it are clear and match the PRD. The zoom-out reviewer's verdict is **revise before approval**. Its main reasons are text left over from decisions already made, the superseded build order, spike data inside the design, and quota machinery built before it is needed.

**Limits on this review:**
- The POC source (`merge.py`, `verify.py`, the `Rule` dataclass, `needs_context`) is not in this repository, so no reviewer could check what the HLD says about reusing it.
- No code was searched. Suggestions to reuse libraries (for example a JavaScript port of `stdnum`) come from what the reviewers know, not from a verified search.

**What the main context checked:** each PRD line the reviewers cite says what they claim it says:
- PRD L229: telemetry is "Off by default. Ask for the user consent".
- PRD ACC-11 (L194): users can switch telemetry off. This contradicts L229.
- PSE-9 is marked P0 (L153).
- ACC-4 (L187) asks for offline credit batches.
- "Detection depth" (L211) is a separate setting.

The Web Crypto claim in M2 also holds. `wrapKey` refuses a key created with `extractable: false`.

## Trade-offs both reviewers checked and accepted

The inventive-catalyst reviewer tested three trade-offs and found they are real limits, not weak choices. The HLD already handles them openly:

- **Hosted code can change on any visit** (L271, L450). D9 is the right response.
- **A modified app can skip the quota** (L465). Under the AGPL anyone can host the app without a quota anyway (L331).
- **Browser storage can be evicted** (L206, L398-403). Set export is the right fallback.

---

## Prioritized findings

### Contradictions inside the document

#### M1. Decided items are still written as open - Severity: Major
- **Reviewer lens:** `egm-zoom-out` (also noted by `egm-inventive-catalyst`)
- **Affected scope:** L41, L63, L146, L336, L349, L354-362, L422, L437, L451
- **Problem:** D1 (TypeScript) is decided at L41, L336 and L451, but other lines still treat it as open:
  - L63 makes CLI reuse depend on "if its language also runs outside a browser (D1)".
  - L146 says python-stdnum is used directly "only if the engine is Python".
  - L354-362 keeps the full Rust and Pyodide options table. L362 says the spike "settles D1", while L451 says it "no longer chooses the language".

  Other decisions are out of sync too. L349 lists the identity vendor as "To confirm (D8)", but D8 (Auth0) is decided at L448. L437 says "Nine decisions are open", but only D10 and D6 are. A new reader cannot tell what is settled.
- **Recommendation:**
  - Move the language table and the "choice stays reversible" paragraph into a short "Alternatives considered" note, or delete them.
  - Fix L63, L146, L349 and L437.
  - State each decision in one place only: the decision log.

#### M2. A non-extractable key cannot be wrapped or exported - Severity: Major
- **Reviewer lens:** `egm-zoom-out`, `egm-inventive-catalyst` (merged)
- **Affected scope:** L204-205, L347; PRD "Vault lock" (P0) and "Data at rest"
- **Problem:**
  - Web Crypto's `wrapKey` only works on a key created as extractable. So "kept non-extractable. A passphrase can wrap it" cannot both be true, and neither can "Exporting a vault writes one encrypted file".
  - With no passphrase, the key sits in the same browser profile as the data. That protects against other websites but not against someone who has a copy of the profile.
  - The PRD's auto-lock needs a key that encrypts the data key, and the HLD never defines one.
- **Recommendation:** State the key setup at HLD level and leave the details to the LLD. One option is envelope encryption:
  1. Create a random data key and wrap it immediately.
  2. Derive the wrapping key from the passphrase with PBKDF2, or from WebAuthn PRF on a passkey registered to our origin. PRF reuses the passkey direction in D8.
  3. Unwrap the data key each session as non-extractable.
  4. For export, re-encrypt under a key derived from the passphrase.

  Also say plainly what the no-passphrase mode protects against.
- **Trade-off:** PRF support differs across browsers and authenticators. Users get an unlock step. Recovery after losing the authenticator depends on the passphrase-protected backup.

#### M3. Layout is called "approximate" yet "shall not change" - Severity: Major
- **Reviewer lens:** `egm-zoom-out`, `egm-inventive-catalyst` (merged)
- **Affected scope:** L74 ("Removal of content shall not change the formatting... eg. sentence line number changes"), L83; risk row L458 (MuPDF 1.28 text shift)
- **Problem:** L83 sits under the heading "Pseudonyms in PDFs and images are approximate" and then says replacement "shall not change the format". The PRD's risk table also says to "set the expectation that layout is approximate". A `PERSON_12` drawn over "Al" in a fallback font cannot also leave the layout unchanged. These are new "shall" requirements. If they belong anywhere, it is the PRD, and they commit the adapters to something nobody has shown can be done.
- **Recommendation:**
  - Remove both "shall" sentences.
  - Replace them with something the verifier can check: glyph positions outside the edited boxes do not move. This check also catches the MuPDF text-shift risk at L458.
  - Fit the surrogate visually inside the box, scaled or abbreviated.
  - Take the AI-facing text (PSE-3), with full-length surrogates, from the `DocumentModel` rather than by re-extracting text from the PDF.
- **Trade-off:** The text output and the PDF output can drift apart. The verifier gains one more check.

#### M4. Telemetry is opt-out and tied to the account id; the PRD says opt-in - Severity: Major
- **Reviewer lens:** `egm-zoom-out`, `egm-inventive-catalyst` (merged)
- **Affected scope:** L275, L322-324; PRD L229 vs PRD ACC-11 (L194) and L260
- **Problem:**
  - The HLD says "users can switch telemetry off", which is opt-out. PRD L229 says "Off by default. Ask for the user consent". PRD ACC-11 says the opposite, so the PRD disagrees with itself, and the HLD has picked the weaker of the two readings.
  - Events tagged with the account id, carrying page counts and timings, add up to a linkable record of each user's document activity. That comes close to the fingerprinting L321 rules out.
- **Recommendation:**
  - Settle the PRD conflict first.
  - Then the HLD states the consent flow: off by default, with a consent prompt.
  - Use a telemetry id that is not linked to the account, and aggregate events locally into coarse buckets before sending.
  - Show the "never sent" boundary holding before the user consents.
- **Trade-off:** Losing per-user debugging. The PRD's "per account" metric (L260) would need redefining.

#### M5. Conflicting instructions about the POC code - Severity: Major
- **Reviewer lens:** `egm-zoom-out` (also noted by `egm-inventive-catalyst`)
- **Affected scope:** L96 against L29, L177, L405-416 and the Implementation Plan
- **Problem:** L96 says "Do not use or read anything from that POC code". But:
  - L29 and L405-416 make the POC the reference to test against.
  - L177 calls porting the `Rule` dataclass mechanical.
  - The Implementation Plan uses the POC's `verify.py` as the outside test checker.

  L96 also reads like an instruction to an agent ("In the browser the build according to HLD steps use..."), not like design text.
- **Recommendation:** Replace L96 with the actual rule, for example: "POC code is a specification and a test checker; no POC code ships in the product."

#### M6. Principle 5 says redacted values never reach the vault, but D3 puts them there - Severity: Major
- **Reviewer lens:** `egm-inventive-catalyst`
- **Affected scope:** L17, L201-208, L389 ("there is no separate vault store"), L444 (D3); PRD RED-5, PSE-11
- **Problem:** D3 keeps the normalised redacted value in the same encrypted store that L389 calls the vault. So the vault export at L205, the file a colleague uses to restore (PSE-11), would give the colleague every redacted value and the originals as well.
- **Recommendation:** Separate the two exports:
  - **Restore-only file:** surrogate-to-original pairs for pseudonymised entities only.
  - **Full set export:** redaction match data, originals and decisions.

  Then restate principle 5 as "a redacted value never appears in any restore file".
- **Trade-off:** Two export formats to build and test. Someone holding only the restore file cannot add documents to the set consistently. Users have to understand which file to share.

### Superseded or misplaced content

#### M7. The old build order is still in the HLD and disagrees with the Implementation Plan - Severity: Major
- **Reviewer lens:** `egm-zoom-out` (also noted by `egm-inventive-catalyst`)
- **Affected scope:** L418-433; references to "build step N" at L137, L422, L446, L451, L457, L461
- **Problem:** L420 says the Implementation Plan replaces the list, yet the list stays, and its order differs from the plan's:

  | | NER models | Pseudonyms | Working sets |
  | --- | --- | --- | --- |
  | HLD build order | step 5 | step 6 | step 7 |
  | Implementation Plan | phase 6 | phase 5 | phase 2 |

  Risks and decisions still point at the old step numbers. Two orders in two documents will drift further apart.
- **Recommendation:**
  - Delete the numbered list.
  - Point the risk and decision references at the plan's phase names.
  - Link the local `docs/Implementation-Plan.md` rather than the claude.ai address.

#### M8. The OCR section is a spike report, not design - Severity: Major
- **Reviewer lens:** `egm-zoom-out`
- **Affected scope:** L85-118
- **Problem:** The section holds evidence for D6, not design:
  - Tesseract TSV column names.
  - The PyMuPDF constant `PDF_REDACT_IMAGE_PIXELS` and `get_textpage_ocr`.
  - Padding figures and ink-fringe percentages.
  - Results at each skew angle.
  - A table comparing three engines' box formats.
- **Recommendation:** Cut the section to the four rules that matter to the design:
  1. The OCR adapter normalises any engine to word boxes plus a confidence.
  2. Every transform applied before OCR is recorded and inverted.
  3. Boxes are padded before redaction.
  4. The verifier checks the pixels inside the padded box.

  Move the spike data to a spike note or an appendix.

### Data flow and storage gaps

#### M9. "No propagation code" is overstated, and nothing stores the extracted text - Severity: Major
- **Reviewer lens:** `egm-zoom-out`, `egm-inventive-catalyst` (merged)
- **Affected scope:** Principle 4 (L16); L218-221; data model L375-394 (`export` row L393)
- **Problem:**
  - L218 re-runs the working-set matcher over every document in the set each time an entity is approved. That is propagation code, so L221's "needs no propagation code" is wrong.
  - The `DocumentModel` and the OCR word boxes are not stored. Every approval and every stale rebuild therefore decrypts and re-parses each original, and runs OCR again on scanned pages.
  - Principle 4 also leaves out a factor. The output depends on the reader, OCR, model and pack versions, which a hosted app can change on any visit. The `export` table records a policy hash but no engine version.
  - Without a stored text model, the anchors saved in `occurrence` can drift after an app update.
- **Recommendation:**
  - Restate L221: outputs need no patching, but an approval triggers a re-scan of the set, and that has a cost.
  - Store each `DocumentModel`, including OCR words and boxes, as an encrypted record keyed by content hash and reader version. Run the matcher and the rebuilds from it.
  - Record the engine, model and pack versions in `export`.
  - When the reader version changes, re-anchor occurrences by matching text, and send any that cannot be matched to review.
- **Trade-off:** More storage, though small next to the originals. Migration code whenever the reader version changes. One more sensitive record to encrypt, purge and include in exports.

#### M10. The storage engine behind `set.db` is not named - Severity: Major
- **Reviewer lens:** `egm-zoom-out`
- **Affected scope:** L346, L373-394
- **Problem:** `set.db` holds seven relational tables, but the HLD never says what it is: SQLite compiled to WebAssembly on OPFS, IndexedDB with each record encrypted, or a format of our own. IndexedDB appears at L346 but nowhere in the layout. Principle 7 rules out custom cryptography, so the encryption has to be an existing method, not one built in-house.
- **Recommendation:** Choose one store and one level at which data is encrypted. One example is IndexedDB with AES-GCM per record, plus OPFS for encrypted originals and outputs. Also say where the CryptoKey lives.

### Verification and safety

#### M11. The verifier ignores Keep decisions, and a failed check gives the user no way forward - Severity: Major
- **Reviewer lens:** `egm-inventive-catalyst`
- **Affected scope:** L236-238, L245; principle 3; PRD Goal 6
- **Problem:**
  - "Pattern detectors find nothing" on the output clashes with Keep, never-hide and rejected findings. A document where the user kept an identifier on purpose would fail every export.
  - A failed check is only shown with its name. The user gets no path to fix it.
- **Recommendation:** Keep fail-closed, but:
  - Make the pattern check aware of decisions: a hit on a Keep or rejected value passes.
  - Turn an unknown hit into a new finding that needs review.
  - Turn a leftover copy of a removed value into a new edit at the place the verifier found it, then rewrite and re-verify the file, at most once. The certificate records the fix.
- **Trade-off:** A retry loop to cap and test. An automatic fix could hide a writer bug, so each fix must emit an error code. More logic in the part of the code that must be trusted.

#### M12. DOCX scrubbing relies on a blocklist for a leak surface the HLD admits is unproven - Severity: Major
- **Reviewer lens:** `egm-inventive-catalyst`
- **Affected scope:** L76, L81, L238, L461; principle 7
- **Problem:** Safety depends on the list of hidden carriers being complete. The verifier catches literal copies of a value, but not copies that have been transformed: a value split across runs, a compressed embedded OLE object, or a base64-encoded part.
- **Recommendation:** Rebuild the package from an allowlist and drop everything else:
  - **Keep:** body, styles, numbering, headers, footers, footnotes and referenced media.
  - **Drop:** every other part, and list what was dropped in the report.

  Keep the verifier as the last check.
- **Trade-off:** Elements not on the allowlist, such as charts, SmartArt and content controls, lose their formatting. That strains "same format out". The allowlist needs upkeep as Word changes.

#### M13. A word the OCR misses entirely never reaches review - Severity: Major
- **Reviewer lens:** `egm-inventive-catalyst`
- **Affected scope:** L82, L106, L462; PRD DOC-7
- **Problem:** Only regions where OCR has low confidence are flagged. A word that OCR misses produces no row at all, so handwriting, stamps and faint text stay invisible on a P0 path that compliance users rely on.
- **Recommendation:** Flag ink that OCR did not cover:
  1. Convert the page to black and white.
  2. Subtract the padded word boxes.
  3. Show the remaining ink blobs above a size threshold as "unread ink", each redactable with one click.

  Record on the certificate how many were reviewed. This is canvas work and needs no change of OCR engine.
- **Trade-off:** False flags on table lines, logos and noise, so the threshold needs filtering and tuning. More clicks to review each scanned page.

### Built ahead of need

#### M14. Credit and quota machinery is large for a limit anyone can bypass - Severity: Major
- **Reviewer lens:** `egm-zoom-out`
- **Affected scope:** L283-326, L465; PRD ACC-4
- **Problem:** The MVP includes all of this:
  - A server-side credit ledger.
  - Per-document random ids so a retry is not charged twice.
  - Offline credit batches reconciled at the next sync.
  - A second meter for pasted-text characters.
  - A trial counter kept in the browser.
  - A self-hosted analytics store.

  L331 and L465 admit that under the AGPL anyone can remove the quota call. Paid plans are v1 anyway.
- **Recommendation:** For the MVP, spend a credit only when online, and make a new document wait for a connection otherwise. That is one server call and one table. Drop the offline batch and the character meter until pilot data shows they are needed. This means relaxing PRD ACC-4, which asks for offline credits, so raise it with the PRD owner.
- **Counter-argument:** ACC-4 is P0 and the PRD promises the app works offline. Cutting the batch weakens that promise for new documents. The decision belongs to the PRD owner, not to the HLD.

#### M15. Rule-pack tooling covers more sources than the MVP needs and skips existing TypeScript libraries - Severity: Major
- **Reviewer lens:** `egm-zoom-out`
- **Affected scope:** L141-177
- **Problem:**
  - The HLD plans seven sources and a converter script for each, so upstream fixes can be pulled. The MVP needs six country packs, mostly from Presidio, and Presidio's recognisers are Python classes, so converting them is real work.
  - L146 plans to write validators from the public specifications without first checking JavaScript ports of python-stdnum.
  - L148 treats OpenRedaction, which is MIT-licensed TypeScript, as something to mine rather than a possible dependency or fixture source.
  - The example at L170 uses an India rule with a Python-style validator id, but India is not in the launch scope.
- **Recommendation:**
  - Port the six-country rules by hand into the pack format, with source and licence fields, each gated by fixtures.
  - Add converters only once syncing with upstream proves worth it.
  - Check a JavaScript stdnum port, its coverage and its licence, before writing validators.
  - Use a launch-country rule in the example.

---

### Nits

#### N1. Three detection levels are fixed before D10 shows that two models fit - Severity: Nit
- **Lens:** `egm-zoom-out`. **Scope:** L129-137, L452; PRD L211.
- Three levels, a timed device check, banners and a level recorded per document all assume a smaller and a larger browser model both exist. D10 has not shown that yet. The PRD also has a separate "Detection depth: Fast or thorough" setting that the HLD never reconciles with the levels.
- Let D10 decide how many levels there are, and fold the depth setting into the level override. The inventive-catalyst reviewer adds a candidate for the D10 spike: cheap signals pick candidate spans, and the larger model runs only on those spans. The trade-off is that recall is capped by the pre-filter.

#### N2. The in-app release hash gives no assurance - Severity: Nit
- **Lens:** `egm-zoom-out`. **Scope:** L271, L450, L456.
- A compromised server can serve an app that displays any hash it likes. Present the in-app hash as a convenience and take it out of the D9 mitigations. The real controls are the public log, reproducible builds and the v1 extension.

#### N3. Splitting the engine across workers per stage is premature - Severity: Nit
- **Lens:** `egm-zoom-out`. **Scope:** L55.
- Passing a `DocumentModel`, anchored character by character, between workers is costly on long PDFs, and no bottleneck has been shown. Say that one engine worker runs the whole pipeline. The data-in, data-out contracts still let a stage move out later.

#### N4. The verifier sits in the same adapter as the writer - Severity: Nit
- **Lens:** `egm-zoom-out`. **Scope:** L38, L44-48, L236.
- Require each verifier to use at least one reader that is independent of the writer, such as PDF.js for PDF.

#### N5. The pivot table is speculative - Severity: Nit
- **Lens:** `egm-zoom-out`. **Scope:** L59-66.
- Cut it to one sentence. Its CLI row is also stale (see M1).

#### N6. Realistic fakes give up on a restore that can be checked - Severity: Nit
- **Lens:** `egm-inventive-catalyst`. **Scope:** L185-199; PRD PSE-9.
- Draw the fakes from a closed, versioned pool shipped as a pack. Restore can then flag any pool name that is not in the vault, as it already does for an unknown `PERSON_9`. The trade-off is maintaining a pool per locale.
- PRD PSE-9 marks realistic fakes P0, while the HLD and the PRD's own Decided list say v1. Settle which.

#### N7. An approved short value spreads to every case-insensitive match - Severity: Nit
- **Lens:** `egm-inventive-catalyst`. **Scope:** L218, L226-227.
- Approving "Bill" reaches every "bill" in the set, which breaks the precision rule L226 keeps inside one document.
- For short values and dictionary words, match case-sensitively at word boundaries and send matches in other documents to review.

#### N8. Nothing stops two tabs writing the same set - Severity: Nit
- **Lens:** `egm-inventive-catalyst`. **Scope:** L373.
- Take a Web Locks lock per set, and use BroadcastChannel to tell other tabs to refresh.

#### N9. Small wording and accuracy items - Severity: Nit
- **Lens:** both.
- L223 says "Two limits" but lists four bullets.
- L161: a JavaScript regex cannot be stopped by a time limit inside the same worker. Run user patterns in a worker that can be terminated, or use a regex engine that runs in linear time.
- L205 vault export and SET-8 set export read as two export paths. Define one in terms of the other (see M6).
- L157: compile the YAML packs to JSON at build time so the browser needs no YAML parser.

---

## Where to start

These five carry the most weight:

1. **M1 and M7: remove leftover and superseded text.** These are mechanical edits, and they make every later stage easier to read.
2. **M2 and M6: settle the key setup and what each export contains.** Both affect a P0 vault promise.
3. **M4: settle telemetry consent with the PRD.** The PRD contradicts itself, so the fix starts there.
4. **M9: decide whether each document's extracted text is stored.** That choice changes the cost of the main working-set flow.
5. **M3: replace the "shall not change format" sentences** with the glyph-position check.
