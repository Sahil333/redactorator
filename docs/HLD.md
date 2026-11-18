# Redactorator HLD

Nov 15, 2026 · @Sahil Chaddha

Redactorator is a hosted single-page web app that does all document work in the browser. Our servers deliver the app, models and rule packs and run sign-in and billing; they never receive a document. Each stage of the work (read, detect, decide, transform, write, verify) sits behind a small contract, so a format, a detector or the implementation language can change without touching the rest. The Python POC is a test rig and a reference, not the product's code base. This HLD is a draft for partner review and pairs with the PRD.

**Confirmed on 15 November 2026.** "Hosted" means hosted delivery with processing in the browser. Documents are never processed on our servers, which is what lets the requirement that no private data reaches our cloud hold.

## Design principles

Seven rules decide most questions in this design.

1. **Document bytes stay in the browser.** The app comes from our servers, but reading, detecting, transforming and verifying all run in the user's browser. No request carries document content, and no endpoint exists that would accept it.
2. **One intermediate model.** Every format is converted to the same text-plus-anchors model. Detectors and policy never see a file format.
3. **Detect, decide and transform are separate.** Detectors propose, policy and the user decide, transformers execute. That separation is what makes review, auto mode and pivots possible.
4. **Outputs are derived, never edited.** An output is a pure function of the original, the decisions and the policy. Changing a decision means re-running the function, not patching a file.
5. **Redaction destroys, pseudonymisation maps.** They are different code paths. A redacted value never reaches the vault.
6. **Fail closed.** An output that fails verification is not released.
7. **Proven parts, plugged in by name.** Adapters, detectors and surrogate generators are registry entries configured by data, behind contracts that assume no language. No custom parsers, no custom cryptography.

## Architecture at a glance

![architecture · UI, engine pipeline, local storage, and the two things outside](images/hld-architecture.png)

Everything inside the box runs in the user's browser tab. Two things sit outside it: our servers, which send the app, models and packs and handle accounts, and the cloud AI, which only sees pseudonymised text the user copies out.

## Component contracts

Six stage contracts and one helper make up the engine. Each has one job and a typed input and output. The POC column names the Python module that shows the behaviour; it is a reference to test against, not code to ship.

| Stage | Takes | Returns | First implementations | POC reference |
| --- | --- | --- | --- | --- |
| Reader (format adapter) | File bytes | `DocumentModel`: ordered text blocks with every character anchored to a native location, plus side channels (metadata, comments, fields) | PDF, text, image; then DOCX | `extract.py`, `mapping.py` |
| Detector | A text block and its context | `Finding[]`: span, type, score, detector id | Regex packs, GLiNER2-PII, Privacy Filter, term lists, working-set matcher | `detectors/` |
| Resolver | Findings, the entity registry, the policy | `Decision[]`: entity, action, confidence band | Merge overlaps, link to entities, apply thresholds and lists, propagate repeats | `merge.py` |
| Transformer | Decisions | `Edit[]`: an anchor range plus removal or replacement text | Redactor, Pseudonymiser, Restorer | `pipeline.label_for` |
| Writer (format adapter) | Original bytes and edits | New bytes in the same format, side channels scrubbed | PDF, text, image; then DOCX | `redact.py`, `scrub.py` |
| Verifier (format adapter) | Output bytes and the removed values, held in memory | A certificate, or a failure that blocks release | PDF, text, image; then DOCX | `verify.py` |
| Surrogate generator | Entity type and id | A surrogate string | Counter placeholders; then realistic fakes | none yet |

A format adapter is three functions and a detector is one. The notation stays neutral so the contracts read the same in any language; the implementation is TypeScript (D1):

```text
FormatAdapter
  formats                        names it handles: "pdf", or "png", "jpg", "tiff"
  read(bytes)                    -> DocumentModel
  write(bytes, edits, options)   -> bytes
  verify(bytes, removedValues)   -> checks

Detector
  id                             "regex:us_ssn", "gliner2@1cb4166"
  detect(text, context)          -> findings
```

Every contract is data in, data out, with no shared state. A stage can therefore be written in another language and compiled to WebAssembly, and stages talk across Web Workers by message.

Restore is not a special case. It is the same pipeline with the vault as the only detector and the Restorer as the transformer, so it works on any format that has an adapter.

This is what a pivot reuses:

| If the product becomes | It reuses | It adds |
| --- | --- | --- |
| A command-line or batch tool | The engine, if its language also runs outside a browser (D1) | A CLI front end |
| A proxy that pseudonymises prompts to an AI API and restores replies | Text adapter, detectors, Pseudonymiser, Restorer, vault | An HTTP proxy front end |
| A library inside another product | The engine as a package or WebAssembly module | Packaging only |
| A tool for another domain (source code secrets, chat logs) | Pipeline, review UI | A detector pack and, if needed, an adapter |

## Format adapters

Each format gets one adapter that knows how to read it, how to truly remove content from it, and where it hides copies of data. The POC proved the PDF approach in Python; all four adapters are still to be built for the browser.

| Format | Read | Redact (remove for good) | Pseudonymise | Hidden carriers to scrub | Browser building block (candidate) |
| --- | --- | --- | --- | --- | --- |
| PDF, text-based | Glyph-level text with a box per character, all layers on, no clipping | Delete glyphs from the content stream, blank image pixels under the box, full rewrite of the file. Removal of content shall not change the formatting of the document, eg. sentence line number changes | Remove as for redaction, then draw the surrogate fitted into the box with a fallback font | The 27 vectors in the POC's `LEAK_VECTORS.md`: metadata, XMP, annotations, form values, bookmarks, attachments, scripts, thumbnails, structure tree, ActualText, old revisions | MuPDF.js (MuPDF compiled to WebAssembly); PDF.js as an independent cross-check |
| Image and scanned PDF | OCR to words with boxes | Overwrite the pixels, re-encode from the pixel buffer, drop any OCR text layer under the box | Paint the box, draw the surrogate on it | EXIF, XMP, embedded thumbnails, trailing data after the image end marker | Tesseract.js for OCR; canvas for pixels |
| DOCX | Walk the OOXML parts and map runs to character offsets: body, tables, headers, footers, footnotes, text boxes, comments | Rewrite run text in the XML; resolve tracked changes; drop comments and document properties | Replace run text, keeping the run's formatting | Core, app and custom properties; comments; tracked insertions and deletions; hidden text; field codes; hyperlink targets; alt text; custom XML; embedded objects; thumbnails; revision ids | A zip library and the browser's XML parser |
| Text and Markdown | Read as is | Replace the span | Replace the span | None | None needed |

Three notes on the unbuilt adapters:

- **DOCX has the largest unproven leak surface.** Before writing its adapter we write its leak-vector list and fixtures, the same way the POC did for PDF. Images embedded in a DOCX are handed to the image adapter.
- **OCR quality bounds image safety.** A word the OCR misses cannot be detected. Image pages default to the review band, low-confidence OCR regions are flagged, and box-drawing by hand is always available.
- **Pseudonyms in PDFs and images are approximate.** The surrogate is fitted into the space of the original. Replacement shall not change the format of the documents.

### How OCR output maps back to the image

OCR engines return every word with a box in the pixel coordinates of the image they were given. Mapping back is bookkeeping: record each transform applied before OCR, then invert it. A local spike with Tesseract 5.5.1 and the POC's PyMuPDF 1.27.2.3 ran the path end to end.

1. **Render or load.** A scanned PDF page is rendered at 300 dpi through a known matrix. An image file is loaded with its EXIF orientation applied. Any deskew or rescale before OCR is recorded as one more matrix.
2. **OCR to words.** Tesseract's TSV output has one row per word: `left`, `top`, `width`, `height` in pixels from the top-left corner, a 0-100 confidence, and the text ([TSV and hOCR output](https://tesseract-ocr.github.io/tessdoc/Command-Line-Usage.html)).
3. **Build the text with an index.** The adapter joins the words in reading order into the page text. For every character offset it records the word it came from. This is the same `DocumentModel` the PDF adapter fills from glyph boxes, so detectors do not change.
4. **Finding to boxes.** A finding is a character span. The words it touches supply the boxes, merged per line. A match inside a word takes the whole word's box.
5. **Back to the source.** Boxes pass through the inverse matrix: pixels to page points for a PDF, deskewed pixels to original pixels for an image. A box that comes back rotated is widened to its enclosing rectangle.
6. **Remove the pixels.** For a PDF, `apply_redactions` with `PDF_REDACT_IMAGE_PIXELS` blanks the pixels inside the embedded scan ([PyMuPDF Page](https://pymupdf.readthedocs.io/en/latest/page.html)). For an image file, the box is painted into the pixel buffer and the file re-encoded.

The spike ran on the POC's Python stack.  Do not use or read anything from that POC code. In the browser the build according to HLD steps use the same engines compiled to WebAssembly: [Tesseract.js](https://github.com/naptha/tesseract.js) for word boxes and confidences, and [MuPDF.js](https://github.com/ArtifexSoftware/mupdf.js) for `applyRedactions`. Two things to check when the spike is repeated in a browser: Tesseract.js switches every output except plain text off by default since version 6, and MuPDF.js must expose the image-pixel option.

| Spike check | Result | Design consequence |
| --- | --- | --- |
| Box tightness, upright page at 100, 200, 300 dpi | Boxes hug the ink: 0.3% to 7% of a word's ink pixels, the anti-aliased fringe, fell outside the raw box. 1 px of padding covered all of it. | Pad every OCR box before redacting. Start at 10% of line height, minimum 2 px, and tune on real scans. |
| Redact with the raw OCR box | A second OCR pass no longer read the value, but faint glyph-edge pixels stayed in the embedded image. | The certificate checks pixels in the padded box, not just a second OCR pass. |
| 2 degree skew | All four test values read. Boxes grew to cover the slanted word (44 to 71 px tall for the email). | Small skew needs no special handling. |
| 5 degree skew | The email address was misread, so it would not have been detected. | Deskew before OCR, then map boxes back through the inverse rotation (step 5). |
| Both PDF paths | Direct TSV and `get_textpage_ocr` each returned the four test values with usable boxes. | Either works; TSV is chosen for its confidence values. |

The spike used a clean synthetic page in one 11 pt font. Noisy scans, stamps and handwriting are not covered; that is the D6 benchmark.

If D6 swaps the engine, only step 2 changes, because the adapter normalises every engine to pixel rectangles:

| Engine | Smallest box | Coordinates | Confidence |
| --- | --- | --- | --- |
| [Tesseract 5](https://tesseract-ocr.github.io/tessdoc/Command-Line-Usage.html) | Word (TSV, hOCR) | Pixels, top-left origin | Per word, 0-100 |
| [docTR](https://mindee.github.io/doctr/using_doctr/using_models.html) | Word, nested in page, block, line | Relative 0-1 corner pairs; polygons when pages are not assumed straight | Per word, plus an objectness score |
| [PaddleOCR](https://www.paddleocr.ai/latest/en/version3.x/pipeline_usage/OCR.html) | Line by default; words with `return_word_box` | 4-point polygons and `[x_min, y_min, x_max, y_max]` rectangles | Per line |

Two limits follow. An engine that returns text without per-word boxes cannot locate anything, however accurate its text. PaddleOCR's docs do not say which image its boxes refer to when its own orientation or unwarping steps run, so that needs a test before use.

Scans that already carry an invisible OCR layer work today (leak vectors 3 and 10): the layer's text is detected and the pixels under it are blanked. That layer came from unknown software, so image pages are also OCRed by us and the findings merged. Tesseract reads best at 300 dpi or more ([Tesseract: improving quality](https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html)), which sets the render resolution in step 1.

## Detection stack

Detection is a union of four detector families, merged by the resolver. Patterns give precision on structured identifiers; ML models find the names and addresses patterns cannot. In the POC, patterns alone found 0 of 21 names.

1. **Working-set matcher.** Finds every known spelling of entities already in the set. This is what makes a decision carry to the next document.
2. **Term lists.** The user's always-hide terms.
3. **Rule packs.** Regex plus a validator and context words, grouped by country or theme. The POC ships 10 identifier types this way.
4. **NER models.** Run in the browser on ONNX Runtime through [Transformers.js](https://huggingface.co/docs/transformers.js/index), on WebGPU where the device has it and WebAssembly otherwise, pinned by revision and cached after first load. The [OpenAI Privacy Filter](https://huggingface.co/openai/privacy-filter) model card shows a browser example. GLiNER2-PII in the browser is unproven: community ONNX exports exist but need the spike. Which models run depends on the device's detection level, below.

**Detection levels by device (D5).** On first run the app checks the device: a WebGPU adapter and its limits, memory where the browser reports it, and a short timed test run. It then picks a level:

| Level | Detectors | Typical device |
| --- | --- | --- |
| Full | Patterns, validators, the smaller model and the larger model | WebGPU and ample memory |
| Standard | Patterns, validators and the smaller model | Most laptops, WebAssembly only |
| Basic | Patterns and validators only, plus the working-set matcher and manual marking | Low-memory or old devices |

The level is never silent. The app shows it in a banner ("Basic detection on this device: names and addresses are not detected automatically; review each page"), in the review view and on each document's certificate. The user can choose a higher level and accept the slowdown. Each document records the level it was cleaned at, so it can be re-checked later on a stronger device. The spike (build step 1) compares candidate models and decides which fills each slot, and sets the thresholds (D10).

### Open-source rule sets to combine

Three sources cover most of what we need: Presidio for personal identifiers by country, python-stdnum for checksums, gitleaks for secrets. The rest fill gaps or serve as cross-checks.

| Source | What it offers | Licence | How we use it |
| --- | --- | --- | --- |
| [Microsoft Presidio](https://github.com/microsoft/presidio) | [99 predefined entity types](https://presidio.dataprivacystack.org/supported_entities/) in 20 groups: global, 18 countries, and medical. Most are a regex with context words, many with a checksum | MIT | Primary source for country packs. Port patterns and context words into our pack format; skip its NER-based types, which our models cover |
| [python-stdnum](https://arthurdejong.org/python-stdnum/) | Validators for 200+ number formats (tax, identity and company numbers, IBAN) with Luhn, Verhoeff and ISO 7064 check digits | LGPL-2.1+ | Reference for check-digit rules. Used directly only if the engine is Python; otherwise the validators we need are written from the public specifications and tested against it |
| [gitleaks](https://github.com/gitleaks/gitleaks) | Secret-detection rules in TOML: regex, keywords, entropy threshold, allowlists. Roughly 150 rules by third-party counts | MIT | Source for the secrets pack. Its keywords map directly to our context words |
| [OpenRedaction](https://github.com/sam247/openredaction) | 570+ regex patterns in TypeScript; government IDs for 50+ countries; compliance presets | MIT | Mine for countries Presidio lacks. Each pattern is ported and must pass fixtures before it is enabled |
| [detect-secrets](https://github.com/Yelp/detect-secrets) | Regex plugins plus entropy and keyword detectors | Apache-2.0 | Reference for a generic high-entropy secret detector |
| [secrets-patterns-db](https://github.com/mazen160/secrets-patterns-db) | 1,600+ secret regexes graded by confidence, with a converter to gitleaks format | CC BY-SA 4.0 per the repo; the README says CC BY 4.0 and marks its TruffleHog-derived data AGPL | Optional extended pack, high-confidence rules only, after the licence is clarified |
| [DataFog](https://github.com/datafog/datafog-python) | Offline regex engine for email, phone, SSN, card, IP, date, ZIP, plus a German locale | MIT | Cross-check only; it overlaps what the POC has |

Not used: TruffleHog's detectors, which third-party listings give as AGPL-3.0 and which lean on live credential verification, a network call we do not make.

### How the sets become one

- **One pack format.** A pack is a YAML file of rules. Each rule records its source and licence, so attribution and audits are mechanical.
- **Converters, not copies.** One script per source (Presidio recognisers, gitleaks TOML) regenerates our packs, so upstream fixes can be pulled.
- **Fixtures gate every rule.** A rule ships only with positive and negative examples that pass. Regex dialects differ between Go, JavaScript and Python, so ported patterns are tested, not trusted.
- **Validator beats pattern.** When two sources cover one identifier, we keep the rule with a checksum. Rules with no validator must have context words nearby, as the POC's `needs_context` already enforces.
- **User patterns are sandboxed.** Custom regexes run with a time limit so a bad pattern cannot hang the engine.

```yaml
pack: in-identifiers
version: 1
rules:
  - id: in_pan
    type: GOV_ID
    pattern: '\b[A-Z]{5}[0-9]{4}[A-Z]\b'
    validator: stdnum.in_.pan
    context: [pan, permanent account]
    confidence: 0.9
    source: presidio
    licence: MIT
```

The POC's `Rule` dataclass already has these fields. Moving its rules from Python into this file is a mechanical change.

## Pseudonymisation and the vault

A surrogate is assigned once per entity per working set and stored in the working set's encrypted store in the browser; restoring is a lookup in the other direction.

**Making surrogates**

- The MVP generator is a counter per type: `PERSON_1`, `PERSON_2`, `ORG_1`. It is deterministic, cannot collide, and is the easiest form for an AI model to carry through unchanged.
- The v1 generator produces realistic fakes with a Faker-style library, seeded per entity so the same person always gets the same fake.
- The v1 generator never gives two entities in one working set the same first or last name, and never picks a fake that matches a value already in the working set, such as a real person's name or a street name.
- Both sit behind the surrogate-generator contract. The pseudonymiser does not know which one it is calling.

**Restoring**

- The Restorer builds one matcher from the vault's surrogates. It ignores case and tolerates brackets, quotes, markdown emphasis, a trailing possessive and a line break inside a token.
- A token that looks like a surrogate but is not in the vault is reported, never guessed.
- For realistic fakes, the vault also stores the parts of each surrogate (first name, last name), so "Ms Keller" restores when the full fake was "Maria Keller".
- Realistic fakes change what restore can check. A name the AI invents looks like any real name, so it is left as it is; the not-in-the-vault check above works only for placeholders such as `PERSON_3`.
- A name part that fits more than one entity is flagged as ambiguous, never guessed.
- A fragment of a vault fake left in the text after restoring ("M. Keller", "Maria K.") is highlighted as possibly not restored.
- The restore view highlights every replacement, so the user can check each one.
- Placeholders restore safely and checkably. Realistic fakes read better to the AI but restore best-effort, with these flags. Placeholders are the default; realistic fakes are an option per working set.

**The vault**

- Each working set is one encrypted store in the browser's origin-private storage, holding its entities, surrogates, decisions and policy. Encrypting the whole store covers the entity registry as well as the surrogate map.
- The key is generated in the browser with Web Crypto and kept non-extractable. A passphrase can wrap it.
- Purging a working set deletes its store and its key. Exporting a vault writes one encrypted file, with the passphrase shared out of band.
- Browser storage can be cleared by the user or evicted by the browser, and a lost vault cannot be rebuilt. The app asks for persistent storage and prompts for a vault backup after pseudonymising.

**What is stored for redacted entities** is decided (D3). Carrying a redaction to the next document needs something to match on, so the normalised value is kept in the encrypted registry with no surrogate, because the originals sit in the same encrypted store anyway. The stricter alternative, a keyed hash only, was rejected: it limits matching to exact repeats and rules out linking spellings.

## Working sets

Consistency across documents comes from one mechanism: decisions attach to entities, not to places in files, and every document is rendered from the same entity registry.

**Example: a manual redaction spreads to the whole set.** No detector flagged "Project Falcon". The user selects it in the third contract and marks it redacted. From then on it is redacted in every document of that working set: the ones already imported and any imported later. The review list shows each place it was found. A detection spreads the same way once the user approves it; until then it stays in its own document.

1. **Import.** The reader produces the document model. Detectors run, including the working-set matcher, which finds every known spelling of approved entities.
2. **Link.** The resolver ties each finding to an entity by normalised value (case, spacing and number formatting ignored, as the POC's propagation already does). An unknown value becomes a new entity with the policy's default action, pending until the user approves it.
3. **Decide.** The user approves a detection, changes an action on an entity, or marks text by hand in any document, or the policy sets it. The change is one row in the registry. Approving a detection or marking text by hand makes the entity approved, and the working-set matcher runs again over every document already in the set to find its other occurrences.
4. **Render.** Any document with an occurrence of that entity is now stale. Its output is rebuilt from the original when it is next viewed or exported.

Because outputs are derived (principle 4), "redacted in one document means redacted in all" needs no propagation code. There is nothing to patch; the registry changed and the outputs follow.

Two limits to be honest about:

- **Linking spellings** ("J. Roe" to "Jane Roe") is rule-based in v1: shared surname plus matching initial is suggested, and the user confirms. Automatic exact-match linking is in the MVP.
- **Only approved entities spread across documents.** A detection the user has not approved stays in the document where it was found. It is redacted there by default, failing toward privacy, but touches no other document. Within that document the POC's rule holds: only values that are validated or found by two detectors spread to repeats, so "Bill" does not redact every "bill".
- **Approval spreads it to the whole set.** Approving a detection and marking text by hand both count as approval. The value then spreads to every exact match in the set, even when it is short. The review list shows each match, so a wrong hit can be undone.
- **A box with no text behind it** (drawn over a signature or a photo) applies only to that document, because there is nothing to match in the others.

## Irreversibility and verification

Redaction is trusted only after the written file is re-opened and searched for what was removed. The POC does this for PDF; each new adapter must bring its own checks before it ships.

| Format | How content is destroyed | What the verifier checks on the written bytes |
| --- | --- | --- |
| PDF | Glyphs deleted from content streams, image pixels blanked, file fully rewritten as a single revision | No text under any box; removed values absent from two independent text extractors, metadata, links, annotations, form values, bookmarks and every raw object; no scripts, attachments or thumbnails; pattern detectors find nothing |
| Image | Pixels overwritten, image re-encoded from the pixel buffer | Redacted regions are uniform; no metadata blocks; no bytes after the image end marker; a second OCR pass finds no removed value |
| DOCX | Run text rewritten, tracked changes resolved, comments and properties dropped, package rebuilt | Removed values absent from every XML part, relationship and binary part of the package; no comment or revision parts; pattern detectors find nothing |
| Text | Span replaced | Removed values absent from the output |

Rules that hold for every format:

- The file is always written fresh. No incremental save, no undo data, no previous revision.
- Removed values are held in memory only for the check. Reports carry a salted hash, and the salt is discarded, so a low-entropy value such as an ID number cannot be brute-forced from a report.
- A failed check blocks the export and is shown to the user with the failing check's name.

What the certificate does not claim: that nothing was missed by detection, or that a black box hides the length of what it covers.

## Hosted delivery and the privacy boundary

The browser loads the app from our servers, then does all document work itself. Our servers deliver code, models and rule packs and run accounts. They have no route that accepts a document.

**How it runs**

- The app is a single-page web app on our origin. A service worker caches the app, models and packs, so later visits start fast and work offline.
- The engine runs in Web Workers, off the UI thread. The heavy parts (PDF, OCR, models) are WebAssembly modules, and models use WebGPU where the device has it.
- Files are opened with the file picker or by drag and drop and are read inside the page. Outputs are saved back as downloads.
- Working sets persist in the browser's origin-private storage, encrypted (see Data model and storage).

**What keeps data in**

| Control | What it stops |
| --- | --- |
| No upload route: the accounts API has no endpoint that takes document bytes, text or findings | A code change that quietly sends content, because there is nowhere to send it |
| Content Security Policy: `connect-src` lists only our own asset and accounts hosts; no third-party scripts | A library or injected script sending data to another host |
| Code, models and packs served from our own origin under hashed file names | A third-party host swapping a file |
| A fixed, published list of fields that account calls may send, with a test that fails on any other request | Usage or content leaking through account calls |
| The whole pipeline is tested with the network blocked | A regression that makes document work depend on a server |
| The loaded app keeps working with the network disconnected | Gives users and auditors a simple way to check the claim |

**What a hosted app cannot promise.** A browser runs whatever code our servers send on each visit. "Nothing leaves" therefore rests on our release process, where an installed app would rest it on the user's machine. This is the main cost of hosting, settled in D9: the source is public (D2), builds are reproducible, each release's hash is signed and published in a public log, and the app shows its own release hash. In v1 a small browser extension checks the served files against that log.

**What our servers do**

They host the app, model snapshots and rule packs, each pinned by hash. They also run sign-in, plans and billing, described in the next section. They never receive a document: the app's only calls are asset downloads, account requests and usage telemetry. Telemetry carries counts and events, never document content (see Accounts, plans and billing).

**Deployment.** Static assets sit behind a content delivery network on our own domain. The accounts API is a separate small service. Nothing else runs server-side.

**What moved out of scope** is a locally installed engine, the first draft's recommendation. It allowed full-size models and reuse of the Python POC, at the price of an install step. The hosted app trades those for no install and one code base to update.

## Accounts, plans and billing

Sign-in, plans and billing are ordinary web-app features here, with one rule added: nothing about a document reaches them. A plan is a number of document redactions. Our server keeps each user's balance, and the app spends one credit per new document, so the plan is enforced without seeing any document.

**What runs where**

| Piece | Where | Does | Holds |
| --- | --- | --- | --- |
| Identity provider | Cloud, bought | Auth0. Sign-up and sign-in by emailed one-time code, Google or Microsoft, with optional passkeys; no passwords. Enterprise single sign-on arrives with team plans | Email and linked Google or Microsoft identities |
| Stripe | Cloud, bought | Checkout page, invoices, card storage, customer portal | Payment details |
| Accounts API | Our cloud: one small service and a database | Keeps the session, maps a user to a plan, receives Stripe webhooks, keeps the document balance and hands out credits | User id, email, plan, Stripe customer id, balance and a ledger of spent credits |
| Web app | Browser | Shows the balance and spends a credit before a new document's first cleaned output | A session cookie, a cached copy of the plan and a small batch of credits |

**Sign-in**

1. The user chooses Sign in. The browser goes to the identity provider (OpenID Connect, authorisation-code flow) and returns to our origin.
2. The Accounts API sets a session cookie that scripts cannot read.
3. The app asks the API for the user's plan and balance, and takes a small batch of credits so a loaded app keeps working offline.

**Upgrade and billing**

1. Upgrade sends the browser to Stripe's hosted Checkout page. Our pages never show a card form.
2. Stripe notifies the Accounts API by webhook: `checkout.session.completed`, then `invoice.paid` or `invoice.payment_failed` each period. The API updates the plan ([Stripe subscriptions guide](https://docs.stripe.com/billing/subscriptions/build-subscriptions)).
3. The app reads the new plan when the user returns. Card changes and cancellation go through Stripe's customer portal.

**How the plan is enforced**

| Layer | How | Strength |
| --- | --- | --- |
| Document quota (the only one) | Before a document's first cleaned output, the app spends one credit. The request carries the session and a random id for that document, so a retry is not charged twice. Re-exports of the same document, such as after a new decision in the set, are free. Pasted text spends characters from its own allowance | The balance lives on our server, but a modified app could skip the call |
| Offline batch | The app holds a small batch of credits so new documents can be cleaned offline, and reports what it spent at the next sync. With none left, a new document waits for a connection | The batch size caps how far offline use can run ahead of the server |
| Asset gating (dropped) | Paid modules released only to paid sessions | Not needed while plans differ only by the number of documents |

**What crosses the boundary**

| Sent to our cloud | Never sent |
| --- | --- |
| Email and the session cookie | File names, document text, page images |
| Plan and billing requests; one credit request per new document, carrying a random id and nothing about the file, and the character count of each pasted text | Findings, entity values, surrogates |
| Requests for app modules, models and packs, which show what a user downloaded | Working-set names |
| App version | Hashes or other fingerprints of a document's contents |
| Usage telemetry: counts of documents, pages and working sets, which features were used, timings, error codes, browser and device class | Error messages or anything the user typed, since either can hold document text |

**Telemetry.** The app sends usage events, batched, to our own endpoint, tagged with the account id. Every event follows a fixed schema of numbers, enums and identifiers we define. There is no free-text field, so document text has nowhere to go. An error is reported as a code and its stack frames, never its message. The schema is published, a test fails on any field outside it, and users can switch telemetry off in settings. The events land in a self-hosted analytics store; no third-party script runs in the app.

**The free plan.** 10 document redactions a month, plus 20,000 characters of pasted text a month counted separately; paid plans raise both. Every feature is on every plan, and restoring an AI reply never spends anything. Before signing up, a visitor can clean one document. That count lives in the browser, so clearing storage resets it; this is accepted for a trial.

**Rules the design keeps**

- **A lapsed plan never locks data.** Opening a set, exporting, backing up the vault, purging and restoring existing pseudonyms work on every plan and with a balance of zero. The vault is the user's data, not a paid feature.
- **D2 is a pricing decision too.** Under the AGPL route the app's source is public and anyone can host it without the quota. A paid plan then rests on the hosted service, updates, support and team features.
- **Build order.** Accounts touch no pipeline code and can be built beside the engine.

## Implementation language and building blocks

The language is TypeScript (D1, decided); the table below records the options that were weighed. The platform is fixed: a browser, Web Workers and WebAssembly. Every heavy part already exists as a WebAssembly build, so the language choice covers only the engine's own logic: the pipeline, rules, resolver and storage.

| Concern | Candidate | Why | To confirm |
| --- | --- | --- | --- |
| PDF read, redact, rewrite | [MuPDF.js](https://github.com/ArtifexSoftware/mupdf.js) | Official WebAssembly build of the engine the POC proved; has `applyRedactions` | The image-pixel redaction option; results on the POC's 27 leak tests; the licence, below |
| PDF cross-check | PDF.js text extraction | An independent second reader for the verifier, the job pdfminer did in the POC |  |
| OCR | [Tesseract.js](https://github.com/naptha/tesseract.js), Apache-2.0 | The engine used in the OCR spike, in WebAssembly | Speed and accuracy on real scans (D6) |
| NER models | [Transformers.js](https://huggingface.co/docs/transformers.js/index) on ONNX Runtime; WebGPU with a WebAssembly fallback | Runs models in the browser with no server; quantised weights cut the download | Which models fit a browser (D5) |
| DOCX | A zip library and the browser's XML parser | A DOCX is a zip of XML parts | Leak-vector list comes first |
| Images | Canvas | Built in | That re-encoding drops metadata, per format |
| Storage | Origin-private file system and IndexedDB | Built in and private to our origin | Eviction rules, under Data model and storage |
| Encryption | Web Crypto: AES-GCM with non-extractable keys | Built in; no custom cryptography |  |
| UI | A mainstream single-page framework with TypeScript | Easy to hire for | The team's choice |
| Sign-in | A bought identity provider that speaks OpenID Connect | No password storage or home-made auth | Vendor (D8) |
| Billing | Stripe Billing: hosted Checkout, customer portal, webhooks | Card data never reaches us; the least code |  |
| Accounts API | One small service with a relational database | Holds a few rows per user | Language follows the team |
| Tests | The POC's fixtures and leak-vector lists as a conformance suite, run in headless browsers | The expected behaviour is already written down and measured |  |

**Language options for the engine**

| Option | Reuses | Costs |
| --- | --- | --- |
| TypeScript, calling the WebAssembly modules | One language with the UI; every building block above has a JavaScript API | Rules and validators are rewritten; outside a browser it runs only on JavaScript runtimes |
| A Rust core compiled to WebAssembly | One core for the browser, a command line and a server later; predictable speed and memory | A second language beside the UI's; calling MuPDF and Tesseract from inside WebAssembly is more work than from JavaScript |
| Python in the browser through Pyodide | The POC's code, python-stdnum and Presidio's patterns as they are | A large runtime to download; a browser build of PyMuPDF that is not a standard package; models still run through Transformers.js |

The contracts keep the choice reversible. Stages pass messages, so an engine that starts in one language can swap a single stage for a module built in another. Build step 1 is a short spike that settles D1 with measurements.

**The licence item.** MuPDF.js carries MuPDF's terms: AGPL, or a commercial licence from Artifex for proprietary and SaaS products ([MuPDF.js repository](https://github.com/ArtifexSoftware/mupdf.js)). A hosted app sends MuPDF.js to every visitor. On the usual reading the AGPL route then means publishing the source of the web app that uses it; confirm with counsel. There are two clean ways through; D2 chose the first, keeping the Accounts API and billing closed as separate programs:

- **Open-source the app under AGPL.** This fits a privacy product, since anyone can audit the "nothing leaves" claim, which also answers D9. Revenue then rests on the hosted service, not on closed code.
- **Buy the commercial licence** and keep the code closed. Pricing is by quote.

Replacing the PDF engine is a third route we do not recommend: a first search turned up no permissive library with equivalent true-redaction support (a short spike would confirm), and the POC's 27 leak-vector tests would have to be re-earned.

## Data model and storage

Each working set is one encrypted folder in the browser's origin-private file system. Global settings, rule packs and models sit beside the sets and hold no user data. All of it lives in one browser profile on one device.

```text
Origin-private file system, per browser profile
  policy.json            global policy (the keys of the POC's config.yaml)
  packs/                 rule packs, versioned, cached from our servers
  models/                pinned model snapshots, cached from our servers
  sets/<set id>/
    set.db               encrypted records: everything in the table below
    originals/           imported files, encrypted
    outputs/             derived files and certificates, encrypted
```

| Table | Holds | Notes |
| --- | --- | --- |
| `document` | File name, format, content hash, import time, status | Points at a file in `originals/` |
| `entity` | Type, canonical value, action, surrogate (if pseudonymised) | The surrogate map is this table; there is no separate vault store |
| `alias` | Entity id, normalised spelling | What the working-set matcher searches for |
| `occurrence` | Document id, anchor, entity id, detectors, score, band, status | One row per finding; manual marks are occurrences with detector `user` |
| `policy` | The set's overrides as one JSON document | Merged over the global policy at run time |
| `export` | Document id, output hash, certificate, policy hash, stale flag | Lets SET-6 detect outdated exports |
| `audit` | Time, actor (user or policy), action, entity id | No raw values |

A browser cannot reopen a file by its path later, so `originals/` holds encrypted copies (D4, decided). Asking the user to pick the file again for every re-export was rejected.

**Storage limits that shape the design** ([MDN: storage quotas and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)):

- Quota is large: about 60% of the disk per origin in Chrome and Safari, and the smaller of 10% of the disk or 10 GiB in Firefox by default.
- Storage is best-effort unless the browser grants persistence through `navigator.storage.persist()`. Chrome and Safari decide that without asking the user.
- Safari deletes script-written data for a site the user has not interacted with in seven days of browser use, when tracking prevention is on.
- So the browser is never the only copy of a vault. Working-set export and import, as one encrypted file, is an MVP feature. It is also how a set moves to another device.

## Path from the POC

The POC is a reference, not a code base. What carries over is what it specifies and measures.

| POC asset | Role in the product |
| --- | --- |
| `LEAK_VECTORS.md`, 27 vectors | The PDF adapter's acceptance list, ported as browser tests |
| Fixtures and the 90 fast tests | Conformance suite: the browser engine must produce the same findings and pass the same checks |
| `detectors/regex_rules.py`, `config.example.yaml` | Source for the first rule pack and the default thresholds, moved to data |
| `merge.py`, `pipeline.py` | The specification for merging, filtering and propagation |
| `verify.py` | The specification for the certificate's checks |
| Evaluation results | Baselines to compare the browser build against |

Build order, each step shippable to ourselves:

The [Implementation Plan](https://claude.ai/artifact/UjRsDYz5fMUCVJfThqguMG) replaces the order below. It builds manual redaction end to end first, runs the spikes and a dataset track beside the build, and scores every detection phase against that dataset. The list is kept for reference.

1. Spike in TypeScript to confirm D1 and settle D10 (NER models) and D6 (OCR engine): redact and verify one POC fixture with MuPDF.js, run the candidate NER models in the browser, and get OCR boxes from each candidate OCR engine. Measure download size, memory and speed.
2. Port the leak-vector tests and fixtures into a browser conformance suite.
3. Build the app shell: the single-page UI, the worker engine behind the contracts, and encrypted storage.
4. Add the PDF adapter, the review UI, and rule packs for the six launch countries (US, UK, Canada, Australia, New Zealand, Ireland), each with fixtures.
5. Add the NER models.
6. Add the text adapter, the pseudonymiser, the vault and restore. This completes the round-trip loop.
7. Add the working-set matcher, stale-export tracking, and working-set export and import.
8. Add OCR and the image adapter, with their own leak-vector list and fixtures.
9. Add sign-in and the free plan. This completes the MVP.
10. Write the DOCX leak-vector list and fixtures, then the DOCX adapter.
11. Add Stripe billing and the paid plan.
12. Generate further country packs (India first, from the POC) and secrets packs from Presidio and gitleaks.

## Risks and open decisions

Nine decisions are open; the first two shape everything else and are worth settling before any build work.

- [ ] **D10. NER models for each detection level.** Open until the spike. The spike compares candidate models, not only the POC's two: the OpenAI Privacy Filter, GLiNER2-PII, other GLiNER PII models, and DeBERTa- or BERT-based PII taggers with ONNX exports. Each is measured on recall for names and addresses on the launch-country test set (overall and per name-origin group), download size, memory, and speed with WebGPU and with WebAssembly. Each model's licence must allow commercial use. The results fill the Full and Standard slots.
- [ ] **D6. OCR engine.** Open until the spike, like D10. The spike compares Tesseract.js, PaddleOCR PP-OCRv5 and docTR on real scans from target users. It measures text accuracy, how tightly the word boxes cover the ink, download size and speed. Tesseract.js is the fallback if no engine clearly wins.

**Decided**

- **D3. Redacted values in the registry:** stored normalised in the encrypted set store, so later documents match and spellings can be linked.
- **D4. Originals:** each working set keeps encrypted copies in browser storage, so outputs rebuild when a decision spreads. The copies are part of set export and backup.
- **Launch scope:** English, with country packs for the US, UK, Canada, Australia, New Zealand and Ireland in the MVP (build step 4). India comes later.
- **D7. Free plan:** 10 documents and 20,000 characters of pasted text a month, each resetting monthly. One document before sign-up, counted in the browser.
- **D8. Identity provider:** Auth0 through standard OpenID Connect, with no passwords (emailed code, Google, Microsoft, optional passkeys). With no password hashes to export, moving provider later is an export of emails and ids, plus passkey re-enrolment. Enterprise single sign-on comes with team plans.
- **D2. PDF engine licence:** the browser app (UI and engine) is published under the AGPL. The Accounts API, billing and telemetry store are separate programs and stay closed. To be confirmed with counsel before launch.
- **D9. Trust in served code:** MVP has public source, reproducible builds, a signed hash per release in a public log, and the release hash shown in the app. v1 adds a browser extension that checks served files against the log. An installable pinned build is not planned.
- **D1. Implementation language:** TypeScript for the UI and the engine, calling the WebAssembly modules through their JavaScript APIs. The build step 1 spike confirms speed and memory; it no longer chooses the language.
- **D5. Models in the browser:** chosen per device as Full, Standard or Basic detection (see Detection stack). The level is always shown to the user, who can choose a higher one. Which models fill the levels is still open (D10).

| Technical risk | Effect | Mitigation |
| --- | --- | --- |
| Hosted code can change on any visit | The privacy claim rests on our release process | D9; no upload route; a strict Content Security Policy; a claim users can test offline |
| MuPDF.js behaves differently from the POC's pinned PyMuPDF | Redaction or scrubbing gaps; the POC found MuPDF 1.28 shifting text after redactions | Port the 27 leak tests first (build step 2); pin the version |
| Models are heavy for a browser | Slow first load, memory limits, weak devices without WebGPU | Patterns work at once; quantised models cached after first load; a device check picks the detection level and the app shows it |
| Large files in a browser tab | Memory pressure or a crashed tab on long PDFs | Page-at-a-time processing in workers; progress saved per page |
| Browser storage is cleared or evicted | A lost vault makes its pseudonyms unrecoverable | Request persistent storage; backup prompt; working-set export and import |
| DOCX leak surface is unproven | A missed carrier is a silent leak | Leak-vector list and fixtures come before the adapter (build step 10) |
| OCR misses text in images | Undetected data stays visible | Image pages default to review; low-confidence regions flagged; manual box drawing |
| Ported regexes behave differently in the new language | False matches or silent misses | Fixtures gate every rule |
| Sign-in weakens the privacy claim | Users doubt that nothing leaves the device | A fixed, published list of fields in account and telemetry calls; a test fails on any other request |
| The quota check runs in browser code | A modified app can clean documents without spending credits | Balance kept on our server; a small offline batch; the rest accepted, as for any app that works offline |
| Accounts service is down | Sign-in and upgrades fail | A loaded app keeps working on its cached plan and credit batch; only new documents past the batch wait |
| Browsers differ | A feature works in one browser and not in another | A supported-browser list; the conformance suite runs in each |

## Sources

External pages opened on 15 Nov 2026. POC figures come from the repository's `README.md`, `LEAK_VECTORS.md` and `tests/out/eval_full.md`.

- [Presidio repository](https://github.com/microsoft/presidio) and [supported entities](https://presidio.dataprivacystack.org/supported_entities/)
- [python-stdnum](https://arthurdejong.org/python-stdnum/)
- [gitleaks](https://github.com/gitleaks/gitleaks) and its [default rules](https://github.com/gitleaks/gitleaks/blob/master/config/gitleaks.toml)
- [secrets-patterns-db](https://github.com/mazen160/secrets-patterns-db)
- [detect-secrets](https://github.com/Yelp/detect-secrets)
- [OpenRedaction](https://github.com/sam247/openredaction)
- [DataFog](https://github.com/datafog/datafog-python)
- [MuPDF licence](https://mupdf.readthedocs.io/en/latest/license.html) and the [MuPDF.js repository](https://github.com/ArtifexSoftware/mupdf.js)
- [Tesseract](https://github.com/tesseract-ocr/tesseract), its [command-line output formats](https://tesseract-ocr.github.io/tessdoc/Command-Line-Usage.html) and [quality guide](https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html), and [Tesseract.js](https://github.com/naptha/tesseract.js)
- [PyMuPDF Page reference](https://pymupdf.readthedocs.io/en/latest/page.html) and [PyMuPDF on Pyodide](https://pymupdf.readthedocs.io/en/latest/pyodide.html)
- [docTR models](https://mindee.github.io/doctr/using_doctr/using_models.html) and the [PaddleOCR pipeline](https://www.paddleocr.ai/latest/en/version3.x/pipeline_usage/OCR.html)
- [Transformers.js](https://huggingface.co/docs/transformers.js/index) and the [OpenAI Privacy Filter model card](https://huggingface.co/openai/privacy-filter)
- [MDN: storage quotas and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)
- [Stripe subscriptions guide](https://docs.stripe.com/billing/subscriptions/build-subscriptions)

Not verified against a primary source: the gitleaks rule count and TruffleHog's licence, both taken from third-party comparisons. Also unverified: that GLiNER2-PII runs in a browser, that MuPDF.js exposes image-pixel redaction, and that PDF.js is a good enough second extractor. The licence of every building block needs a check before launch.
