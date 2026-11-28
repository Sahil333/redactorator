"""Writes one PDF and one truth file per pack into fixtures/packs/, from the packs' YAML sources.

Each rule's examples and near-misses are planted one to a block, with the rule's labels, and each
number is written in seven ways: plain, and with a space, a hyphen, a dot, an en dash, a minus
sign and a no-break space between its groups. A value that is not a number in groups, such as
an IP address or a date, says `asWritten: true` and is planted once. The truth file lists each planted value with its
identifier and its number of places, and each near-miss. tests/e2e/packs.spec.ts runs Auto mode
on each PDF and matches its rows against the truth (docs/designs/auto-mode.md, Technical Plan,
section 9). Every value is synthetic.

A rule's `stdnum` names a python-stdnum module: each example must pass its `is_valid`, and each
near-miss must fail it.

The files are not committed: `pnpm packs`, which `pnpm build`, `pnpm dev` and the tests run
first, writes them.

Run: uv run --project tests/oracle python tests/oracle/make_pack_fixtures.py
"""

import importlib
import json
import re
import shutil
import sys
from pathlib import Path

import yaml

from make_fixtures import FIXTURES, pages_pdf, stream

SOURCES = Path(__file__).resolve().parents[2] / "engine" / "detect" / "packs" / "src"
OUT = FIXTURES / "packs"

# The seven ways a number is written: what goes between its groups.
SEPARATORS = ["", " ", "-", ".", "–", "−", " "]
# What can sit between the groups of a number (engine/model/match.ts, the joiners).
JOINER = re.compile(r"(?<=\d)[\s\-.‐-―−](?=\d)")

# Helvetica in WinAnsi, with the minus sign at code 0x81, and a ToUnicode map so that every reader
# reads the en dash, the minus sign and the no-break space as those characters.
CODES = {"–": "\\226", "−": "\\201", " ": "\\240"}
FONT = ("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding << /Type /Encoding /BaseEncoding /WinAnsiEncoding "
        "/Differences [129 /minus] >> /ToUnicode 4 0 R >>")
TO_UNICODE = (b"/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /PackFixture def "
              b"1 begincodespacerange <00> <FF> endcodespacerange 1 beginbfrange <20> <7E> <0020> endbfrange "
              b"3 beginbfchar <81> <2212> <96> <2013> <A0> <00A0> endbfchar endcmap CMapName currentdict /CMap defineresource pop end end")

FONT_SIZE = 10
TOP = 750
# Lines this far apart are read as separate blocks, so a label never reaches the next block's value.
LINE_GAP = 40
LINES_PER_PAGE = 18


class FixtureError(Exception):
    pass


def ways(value: str, as_written: bool = False) -> list[str]:
    """The value written in each of the seven ways, or as it is when it has no groups or says `asWritten`."""
    if as_written or not JOINER.search(value):
        return [value]
    return [JOINER.sub(separator, value) for separator in SEPARATORS]


def planted(entry: object) -> dict:
    """An example or near-miss as a mapping: its value, the line it is planted on, and whether it is planted only as written."""
    return entry if isinstance(entry, dict) else {"value": entry}


def lines_and_truth(pack: dict) -> tuple[list[str], dict]:
    """The lines of the pack's PDF, one per block, and its truth file."""
    rules = {rule["id"]: rule for rule in pack["rules"]}
    values: list[dict] = []
    near_misses: list[dict] = []
    first_examples: dict[str, dict] = {}
    companion_places: dict[str, int] = {}
    lines: list[str] = []
    for rule in pack["rules"]:
        labels = rule.get("labels") or []
        default = "{label}: {value}" if labels else "{value}"
        companion = (rule.get("companion") or {}).get("rule")
        for kind, entries in (("value", rule["examples"]), ("near-miss", rule["nearMisses"])):
            for entry in map(planted, entries):
                written = ways(str(entry["value"]), bool(entry.get("asWritten")))
                for way in written:
                    label = labels[len(lines) % len(labels)] if labels else ""
                    companion_value = planted(rules[companion]["examples"][0])["value"] if companion else ""
                    line = entry.get("line") or default
                    if "{companion}" in line:
                        companion_places[companion] = companion_places.get(companion, 0) + 1
                    lines.append(line.replace("{label}", label).replace("{companion}", companion_value).replace("{value}", way))
                if kind == "value":
                    values.append({"text": written[0], "identifier": rule["identifier"], "places": len(written)})
                    first_examples.setdefault(rule["id"], values[-1])
                else:
                    near_misses.append({"text": written[0]})
    # The companion written beside a value is the companion rule's first example, one more place of it.
    for rule_id, places in companion_places.items():
        first_examples[rule_id]["places"] += places
    return lines, {"pack": pack["pack"], "values": values, "nearMisses": near_misses}


def check_with_stdnum(pack: dict) -> None:
    """Each example passes the rule's python-stdnum check, and each near-miss fails it."""
    for rule in pack["rules"]:
        if not rule.get("stdnum"):
            continue
        is_valid = importlib.import_module(f"stdnum.{rule['stdnum']}").is_valid
        compact = lambda value: re.sub(r"[\W_]", "", str(value))
        for entry in map(planted, rule["examples"]):
            if not is_valid(compact(entry["value"])):
                raise FixtureError(f"{pack['pack']}, rule {rule['id']}: the example {entry['value']} fails stdnum.{rule['stdnum']}")
        for entry in map(planted, rule["nearMisses"]):
            if is_valid(compact(entry["value"])):
                raise FixtureError(f"{pack['pack']}, rule {rule['id']}: the near-miss {entry['value']} passes stdnum.{rule['stdnum']}")


def pdf_string(text: str) -> str:
    """The text as a PDF string in the fixture's font."""
    out = ""
    for c in text:
        if c in CODES:
            out += CODES[c]
        elif " " <= c <= "~":
            out += "\\" + c if c in "()\\" else c
        else:
            raise FixtureError(f"the character {c!r} cannot be written in the fixture's font")
    return out


def pack_pdf(lines: list[str]) -> bytes:
    pages = [lines[at : at + LINES_PER_PAGE] for at in range(0, len(lines), LINES_PER_PAGE)]
    contents = ["".join(f"BT /F1 {FONT_SIZE} Tf 72 {TOP - LINE_GAP * i} Td ({pdf_string(line)}) Tj ET\n" for i, line in enumerate(page)) for page in pages]
    return pages_pdf(contents, FONT, [stream("", TO_UNICODE)])


def outputs() -> dict[str, bytes]:
    """Every file the generator writes into fixtures/packs/, by name. A pack with no rules has none."""
    files = {}
    for source in sorted(SOURCES.glob("*.yaml")):
        pack = yaml.safe_load(source.read_text(encoding="utf-8"))
        if not pack["rules"]:
            continue
        check_with_stdnum(pack)
        lines, truth = lines_and_truth(pack)
        files[f"{pack['pack']}.pdf"] = pack_pdf(lines)
        files[f"{pack['pack']}.truth.json"] = (json.dumps(truth, indent=2, ensure_ascii=False) + "\n").encode()
    return files


def main() -> int:
    try:
        files = outputs()
    except FixtureError as error:
        print(error, file=sys.stderr)
        return 1
    shutil.rmtree(OUT, ignore_errors=True)
    OUT.mkdir()
    for name, data in files.items():
        (OUT / name).write_bytes(data)
        print(f"wrote fixtures/packs/{name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
