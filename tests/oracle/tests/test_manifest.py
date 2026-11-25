"""The meta-test of leak-vectors.json (docs/designs/pdf-leak-suite.md, Detailed item 30).

Each entry's checks run with its uncleaned fixture as both input and output: what an export would be
if the app removed nothing. Every leak check must then fail, as its negative control, except
`structure`, which may pass where the fixture holds only kept keys, as a guard on what the app writes
(owner, 25 Nov 2026). That each entry passes on the app's output is `tests/e2e/leak-suite.spec.ts`'s job.
"""

import json
import re
from pathlib import Path

import pytest

from oracle.__main__ import CHECKS, run

ROOT = Path(__file__).resolve().parents[3]
VECTORS = json.loads((ROOT / "tests/oracle/leak-vectors.json").read_text())
FIELDS = {"id", "spec", "howItLeaks", "rule", "kind", "fixture", "value", "mark", "markType", "expect", "checks"}
RULES = {"strip", "flatten", "keep-redact", "rewrite", "refuse", "keep"}
# The refusals a synthetic file reaches, and when (owner, 25 Nov 2026). text-moved, check-failed and
# apply-failed are reached through the fake worker, and mark-lost through edited stored text.
REFUSALS = {"unsupported-form": "add", "prepare-failed": "add", "encrypted": "add", "open-failed": "add",
            "extra-text-removed": "preview", "partly-covered-drawing": "preview"}
# The types a mark can take, by the label the app shows: the dataset's entity types.
MARK_TYPES = {kind["title"] for kind in json.loads((ROOT / "dataset/ground-truth.schema.json").read_text())["$defs"]["entityType"]["oneOf"]}


def is_box(value: object) -> bool:
    return isinstance(value, list) and len(value) == 4 and all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in value)


def malformed(entry: dict) -> list[str]:
    """What is wrong with an entry's fields, as item 28's schema has them."""
    problems = [f"field {field!r} missing" for field in FIELDS - entry.keys()] + [f"field {field!r} unknown" for field in entry.keys() - FIELDS]
    if problems:
        return problems
    mark, expect = entry["mark"], entry["expect"]
    if not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", entry["id"]):
        problems.append("id is not kebab-case")
    if not all(isinstance(entry[field], str) and entry[field] for field in ("spec", "howItLeaks")):
        problems.append("spec and howItLeaks must be text")
    if entry["rule"] not in RULES:
        problems.append(f"rule {entry['rule']!r} is not one of {sorted(RULES)}")
    # Whether a kind is one the app records is leak-suite.spec.ts's check, against the app's own list.
    if entry["kind"] is not None and not isinstance(entry["kind"], str):
        problems.append("kind must be text or null")
    if not (isinstance(entry["fixture"], str) and re.fullmatch(r"fixtures/[a-z0-9-]+\.pdf", entry["fixture"])):
        problems.append("fixture is not a path under fixtures/")
    elif not (ROOT / entry["fixture"]).is_file():
        problems.append(f"{entry['fixture']} does not exist")
    if entry["value"] is not None and not isinstance(entry["value"], str):
        problems.append("value must be text or null")
    if mark is not None and not (isinstance(mark, dict) and isinstance(mark.get("page"), int) and mark["page"] >= 1
                                 and len(mark) == 2 and (is_box(mark.get("select")) or is_box(mark.get("box")))):
        problems.append("mark must be null or { page, select } or { page, box }, with a 1-based page and four numbers")
    if (mark is None) != (entry["markType"] is None) or (entry["markType"] is not None and entry["markType"] not in MARK_TYPES):
        problems.append("markType must be a mark type exactly when there is a mark")
    if isinstance(expect, dict):
        if set(expect) != {"refusal", "at"} or REFUSALS.get(expect["refusal"]) != expect["at"]:
            problems.append(f"expect {expect!r} is not a refusal a file reaches, at its stage")
        if entry["rule"] != "refuse" or entry["checks"] != []:
            problems.append("a refusal entry has rule 'refuse' and no checks")
        if expect.get("at") == "preview" and mark is None:
            problems.append("a refusal at Preview needs a mark")
    elif expect not in ("clean", "kept"):
        problems.append("expect must be 'clean', 'kept' or a refusal")
    elif entry["rule"] == "refuse":
        problems.append("rule 'refuse' needs a refusal")
    elif (expect == "kept") != (entry["rule"] == "keep"):
        problems.append("rule 'keep' goes with expect 'kept'")
    if not isinstance(entry["checks"], list) or not all(isinstance(check, dict) and isinstance(check.get("check"), str) for check in entry["checks"]):
        problems.append("checks must be a list of { check, ... }")
    return problems


def test_ids_are_unique():
    ids = [entry["id"] for entry in VECTORS]
    assert sorted(ids) == sorted(set(ids)), "an id is listed twice"


@pytest.mark.parametrize("entry", VECTORS, ids=[entry["id"] for entry in VECTORS])
def test_entry(entry: dict):
    assert malformed(entry) == []
    if isinstance(entry["expect"], dict):
        return
    unknown = [check["check"] for check in entry["checks"] if check["check"] not in CHECKS]
    assert unknown == [], "checks not in CHECKS"
    leaks = [check for check in entry["checks"] if CHECKS[check["check"]].sort == "leak"]
    fixture = str(ROOT / entry["fixture"])
    passing = [check["check"] for check in entry["checks"] if not run({"input": fixture, "output": fixture, "checks": [check]})]
    if entry["expect"] == "kept":
        assert leaks == [], "an entry whose value is kept by decision has no leak check"
        assert any(check["check"] == "kept" for check in entry["checks"]), "an entry whose value is kept has a kept check"
        assert len(passing) == len(entry["checks"]), "every check passes on the uncleaned fixture, which holds the value"
        return
    assert leaks, "an entry expecting a clean output has a leak check"
    assert [check["check"] for check in leaks if check["check"] in passing and check["check"] != "structure"] == [], \
        "a leak check passes on the uncleaned fixture, so it can't fail"
    assert any(check["check"] not in passing for check in leaks), "no leak check fails on the uncleaned fixture"
