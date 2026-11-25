"""uv run --project tests/oracle python -m oracle <spec.json>

The spec names the input and output files and the checks to run (see README.md).
Exit 0 when every check passes; exit 1 with one reason per line otherwise.
"""

import json
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Literal, NamedTuple

from . import checks


class Check(NamedTuple):
    run: Callable[[bytes, bytes, dict], list[str]]
    # A leak check proves something is gone, so it fails on the uncleaned file; a keep check proves
    # something visible stayed, so it passes there (docs/designs/pdf-leak-suite.md, part 9).
    sort: Literal["leak", "keep"]


def box(values: list[float] | None) -> checks.Box | None:
    return None if values is None else (values[0], values[1], values[2], values[3])


CHECKS: dict[str, Check] = {
    "absent": Check(lambda source, output, check: checks.absent(output, check["values"]), "leak"),
    "metadata": Check(lambda source, output, check: checks.metadata(output), "leak"),
    "covered": Check(lambda source, output, check: checks.covered(source, output, check["word"]), "leak"),
    "pixels": Check(lambda source, output, check: checks.pixels(
        source, output, box(check["region"]), check.get("mask", False), box(check.get("at"))), "leak"),
    "structure": Check(lambda source, output, check: checks.structure(output), "leak"),
    "image-metadata": Check(lambda source, output, check: checks.image_metadata(output), "leak"),
    "drawings": Check(lambda source, output, check: checks.drawings(output, check["boxes"]), "leak"),
    "glyphs-absent": Check(lambda source, output, check: checks.glyphs_absent(output, check["regions"]), "leak"),
    "present": Check(lambda source, output, check: checks.present(output, check["text"]), "keep"),
    "kept": Check(lambda source, output, check: checks.kept(output, check["values"]), "keep"),
    "positions": Check(lambda source, output, check: checks.positions(source, output, check["words"]), "keep"),
    "unchanged": Check(lambda source, output, check: checks.unchanged(source, output, box(check["at"])), "keep"),
    "rendered": Check(lambda source, output, check: checks.rendered(source, output, check.get("exceptions", [])), "keep"),
}


def run(spec: dict) -> list[str]:
    source = Path(spec["input"]).read_bytes()
    output = Path(spec["output"]).read_bytes()
    reasons = []
    for check in spec["checks"]:
        known = CHECKS.get(check["check"])
        reasons += [f"unknown check {check['check']!r}"] if known is None else known.run(source, output, check)
    return reasons


if __name__ == "__main__":
    reasons = run(json.loads(Path(sys.argv[1]).read_text()))
    print("\n".join(reasons) or "pass")
    sys.exit(1 if reasons else 0)
