"""Generates the allowlist's role table from the Arlington PDF Model and our decisions.

    python3 tools/arlington/generate.py          # writes engine/pdf/allowlistRoles.generated.ts
    python3 tools/arlington/generate.py --check  # fails when that file is not what it would write

Inputs: the model's TSVs in vendor/arlington/tsv/latest/ (one per PDF 2.0 object type), and
engine/pdf/allowlist-decisions.json, our decisions (docs/designs/pdf-leak-suite.md, Appendix
A.1): per object type, the keys we keep and the kind each deleted key records. It walks the
model's `Link` column from `FileTrailer`, following only keys we keep, and writes, for every type
it reaches, what the run-time walker needs. It stops, listing them, when a type it reaches has no
decision, or a decision names a type or key the model does not have.

Arrays keep every element, and map-style types (a `*` key, chosen by the file) every key: only a
dictionary's or stream's own keys are ever deleted.
"""

from __future__ import annotations

import csv
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TSVS = ROOT / "vendor/arlington/tsv/latest"
DECISIONS = ROOT / "engine/pdf/allowlist-decisions.json"
OUTPUT = ROOT / "engine/pdf/allowlistRoles.generated.ts"

# The model's types, by the PDF type a value has when it is read.
PDF_TYPES = {
    "array": "array", "rectangle": "array", "matrix": "array",
    "dictionary": "dictionary", "number-tree": "dictionary", "name-tree": "dictionary",
    "stream": "stream",
    "name": "name",
    "string": "string", "string-text": "string", "string-byte": "string", "string-ascii": "string", "date": "string",
    "integer": "number", "number": "number", "bitmask": "number",
    "boolean": "boolean",
    "null": "null",
}


def unwrap(text: str) -> str:
    """A model value without its `fn:` wrappers, which say since when or under what it applies:
    `fn:SinceVersion(1.2,FontType0)` is `FontType0`."""
    while text.startswith("fn:"):
        inner = text[text.index("(") + 1 : text.rindex(")")]
        text = split_top(inner, ",")[-1].strip()
    return text


def split_top(text: str, separator: str) -> list[str]:
    """`text` split at `separator` outside parentheses and brackets."""
    parts, depth, start = [], 0, 0
    for at, c in enumerate(text):
        if c in "([":
            depth += 1
        elif c in ")]":
            depth -= 1
        if c == separator and depth == 0:
            parts.append(text[start:at])
            start = at + 1
    return parts + [text[start:]]


def listed(column: str) -> list[list[str]]:
    """A `;`-separated column of `[a,b]` lists, one per type, unwrapped."""
    if column.strip() == "":
        return []
    return [[unwrap(item.strip()) for item in split_top(part.strip()[1:-1], ",") if item.strip()] for part in split_top(column, ";")]


def read_type(name: str) -> list[dict[str, str]] | None:
    path = TSVS / f"{name}.tsv"
    if not path.exists():
        return None
    with path.open(newline="") as file:
        return list(csv.DictReader(file, delimiter="\t"))


def key_entry(row: dict[str, str]) -> dict[str, list[str]]:
    """What a key's value can be: per PDF type, the model types it can lead to."""
    types = [unwrap(each.strip()) for each in split_top(row["Type"], ";")]
    links = listed(row["Link"])
    entry: dict[str, list[str]] = {}
    for index, kind in enumerate(types):
        pdf = PDF_TYPES.get(kind)
        if pdf is None:
            raise SystemExit(f"unknown model type {kind!r}")
        targets = links[index] if index < len(links) else []
        # A rectangle or a matrix links nowhere: its shape is its type (`allowlist.ts`, SHAPES).
        if kind in ("rectangle", "matrix"):
            targets = [kind]
        elif pdf in ("array", "dictionary", "stream") and not targets:
            raise SystemExit(f"{row['Key']} is a {kind} that links nowhere")
        entry.setdefault(pdf, [])
        entry[pdf] += [target for target in targets if target not in entry[pdf]]
    # The walker reads a shape only as a key's sole array candidate.
    if any(shape in targets and len(targets) > 1 for targets in entry.values() for shape in ("rectangle", "matrix")):
        raise SystemExit(f"{row['Key']} mixes a rectangle or matrix with other types")
    return entry


STREAM_KEYS = ("Length", "Filter", "DecodeParms")
SHAPES = ("rectangle", "matrix")

# The keys whose fixed values tell a key's candidate types apart. A stream's DecodeParms is told by
# the stream's filter instead (`allowlist.ts`).
DISCRIMINATORS = ("Type", "Subtype", "Subtype2", "S", "FunctionType", "ShadingType", "PatternType", "HalftoneType", "0")

LITERAL = re.compile(r"^[A-Za-z0-9_.\-]+$")


def fixed_values(row: dict[str, str]) -> list[str] | None:
    """The values the model fixes for a key, as for `/Type` or `/Subtype`, when they are plain literals."""
    for values in listed(row["PossibleValues"]):
        if values and all(LITERAL.match(value) for value in values):
            return values
    return None


def generate() -> str:
    decisions = json.loads(DECISIONS.read_text())
    roles: dict[str, dict] = {}
    pending = ["FileTrailer"]
    undecided, unknown = [], []
    used: set[str] = set()
    while pending:
        name = pending.pop()
        if name in roles or name in undecided:
            continue
        rows = read_type(name)
        if rows is None:
            unknown.append(f"type {name}")
            continue
        model_keys = {row["Key"]: row for row in rows}
        # A map, whose keys the file chooses, has only `*`; an array only `*` or numbered keys.
        # Both keep every entry. A type with `*` and keys of its own needs a decision on those.
        is_map = set(model_keys) == {"*"}
        is_array = all(re.match(r"^(\*|\d+)$", key) for key in model_keys)
        decision = decisions.get(name)
        used.add(name)
        if decision is None and not (is_map or is_array):
            undecided.append(name)
            continue
        if decision is not None and (is_map or is_array):
            unknown.append(f"type {name}, which keeps every entry and needs no decision")
        decision = decision or {}
        refuse = bool(decision.get("refuse"))
        delete = bool(decision.get("delete"))
        # A key not walked is kept unchecked, so it must be one we keep.
        if not set(decision.get("notWalked", [])) <= set(decision.get("keep", [])):
            unknown.append(f"type {name}, whose notWalked keys are not all kept")
        if (refuse or delete) and (decision.get("keep") or refuse == delete):
            unknown.append(f"type {name}, which can't keep keys and also be refused or deleted, nor be both")
        kept = list(model_keys) if (is_map or is_array) else decision.get("keep", []) + (["*"] if "*" in model_keys else [])
        # Every stream keeps how it is stored (Appendix A.1).
        if "Length" in model_keys and not (is_map or is_array):
            kept += [key for key in STREAM_KEYS if key in model_keys and key not in kept]
        for key in kept + list(decision.get("kinds", {})):
            if key not in model_keys:
                unknown.append(f"{name}/{key}")
        role = {"keys": {}, "fixed": {}, "kinds": decision.get("kinds", {}), "notWalked": decision.get("notWalked", []), "refuse": refuse, "delete": delete}
        # A type we refuse or delete keeps nothing: an object of it refuses its file, or is deleted where it is reached.
        for key in [] if refuse or delete else kept:
            if key not in model_keys:
                continue
            entry = key_entry(model_keys[key])
            role["keys"][key] = entry
            if key not in role["notWalked"]:
                pending += [target for targets in entry.values() for target in targets if target not in SHAPES]
        # Beside `*`, the type's own keys it does not keep are deleted, never taken as `*` entries.
        if "*" in model_keys and not (is_map or is_array):
            for key in model_keys:
                role["keys"].setdefault(key, None)
        for key, row in model_keys.items():
            values = fixed_values(row)
            if values is not None and key in DISCRIMINATORS:
                role["fixed"][key] = values
        roles[name] = role
    unknown += [f"type {name}, which the walk never reaches" for name in decisions if name not in used]
    if undecided or unknown:
        message = []
        if undecided:
            message.append("Types the walk reaches with no decision:\n  " + "\n  ".join(sorted(set(undecided))))
        if unknown:
            message.append("Decisions that can't be applied:\n  " + "\n  ".join(sorted(set(unknown))))
        raise SystemExit("\n".join(message))
    return render(roles)


def render(roles: dict[str, dict]) -> str:
    # One role a line, so a change of decision or model reads as a diff of the roles it touches.
    lines = [f"  {json.dumps(name)}: {json.dumps(role, sort_keys=True, separators=(', ', ': '))}," for name, role in sorted(roles.items())]
    body = "{\n" + "\n".join(lines) + "\n}"
    return (
        "// Generated by tools/arlington/generate.py from the Arlington PDF Model (vendor/arlington) and\n"
        "// engine/pdf/allowlist-decisions.json. Do not edit: change the decisions and run it again.\n"
        'import type { RemovalKind } from "../model/document";\n\n'
        "/** What a key's value can be: per PDF type, the model types it can lead to. */\n"
        "export type KeyEntry = Readonly<Partial<Record<\"array\" | \"dictionary\" | \"stream\" | \"name\" | \"string\" | \"number\" | \"boolean\" | \"null\", readonly string[]>>>;\n\n"
        "export interface Role {\n"
        "  /** The keys kept; `null` for one of a type's own keys that is deleted though the type has `*`. */\n"
        "  readonly keys: Readonly<Record<string, KeyEntry | null>>;\n"
        "  /** Values the model fixes for keys that tell candidates apart, such as `/Type`. */\n"
        "  readonly fixed: Readonly<Record<string, readonly string[]>>;\n"
        "  /** The kind a deleted key records; any other records `app-data`. `null` records none. */\n"
        "  readonly kinds: Readonly<Record<string, RemovalKind | null>>;\n"
        "  /** Kept keys whose values are not walked. */\n"
        "  readonly notWalked: readonly string[];\n"
        "  /** An object of a type we refuse refuses its file. */\n"
        "  readonly refuse: boolean;\n"
        "  /** An object of a type we delete is deleted with the key that leads to it. */\n"
        "  readonly delete: boolean;\n"
        "}\n\n"
        f"export const ROLES: Readonly<Record<string, Role>> = {body};\n"
    )


if __name__ == "__main__":
    text = generate()
    if "--check" in sys.argv:
        if not OUTPUT.exists() or OUTPUT.read_text() != text:
            raise SystemExit(f"{OUTPUT.relative_to(ROOT)} is not what the generator writes; run tools/arlington/generate.py")
        print("allowlist role table is current")
    else:
        OUTPUT.write_text(text)
        roles = text.count('"keys"')
        print(f"wrote {OUTPUT.relative_to(ROOT)}: {roles} roles")
