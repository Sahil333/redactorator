"""Checks ground-truth files against dataset/ground-truth.schema.json and the rules JSON Schema can't state.

uv run --project tools/dataset python tools/dataset/validate.py <file.json>...
Exit 0 when every file is valid; otherwise exit 1 with one reason per line.
"""

import json
import sys
from pathlib import Path

from jsonschema import Draft202012Validator

SCHEMA = json.loads((Path(__file__).resolve().parents[2] / "dataset" / "ground-truth.schema.json").read_text())
UNIT_FOR_FORMAT = {"born-digital-pdf": "pt", "scanned-pdf": "pt", "image": "px", "text": "none"}


def problems(truth: object) -> list[str]:
    found = [f"{'/'.join(map(str, error.path)) or '(top)'}: {error.message}"
             for error in Draft202012Validator(SCHEMA).iter_errors(truth)]
    if found or not isinstance(truth, dict):
        return found

    document = truth["document"]
    if document["box_unit"] != UNIT_FOR_FORMAT[document["format"]]:
        found.append(f"document: box_unit {document['box_unit']!r} does not fit format {document['format']!r}")

    ids = [entity["id"] for entity in truth["entities"]]
    found += [f"entities: id {id!r} is used twice" for id in sorted({id for id in ids if ids.count(id) > 1})]

    for index, occurrence in enumerate(truth["occurrences"]):
        where = f"occurrences/{index}"
        if occurrence["entity_id"] not in ids:
            found.append(f"{where}: entity_id {occurrence['entity_id']!r} names no entity")
        if "start" in occurrence and occurrence["start"] >= occurrence["end"]:
            found.append(f"{where}: start must be before end")
        if document["format"] == "text":
            if occurrence["boxes"]:
                found.append(f"{where}: a text document's occurrences have no boxes")
            if "start" not in occurrence:
                found.append(f"{where}: a text document's occurrences need start and end")
        elif not occurrence["boxes"]:
            found.append(f"{where}: needs at least one box")
        for number, box in enumerate(occurrence["boxes"]):
            if box["x0"] >= box["x1"] or box["y0"] >= box["y1"]:
                found.append(f"{where}/boxes/{number}: x0 must be below x1 and y0 below y1")

    for index, hidden in enumerate(truth["hidden_occurrences"]):
        if hidden["entity_id"] not in ids:
            found.append(f"hidden_occurrences/{index}: entity_id {hidden['entity_id']!r} names no entity")
    return found


if __name__ == "__main__":
    failed = False
    for name in sys.argv[1:]:
        for problem in problems(json.loads(Path(name).read_text())):
            print(f"{name}: {problem}")
            failed = True
    sys.exit(1 if failed else 0)
