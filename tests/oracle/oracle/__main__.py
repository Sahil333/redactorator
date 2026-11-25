"""uv run --project tests/oracle python -m oracle <spec.json>

The spec names the input and output files and the checks to run (see README.md).
Exit 0 when every check passes; exit 1 with one reason per line otherwise.
"""

import json
import sys
from pathlib import Path

from . import checks


def run(spec: dict) -> list[str]:
    source = Path(spec["input"]).read_bytes()
    output = Path(spec["output"]).read_bytes()
    reasons = []
    for check in spec["checks"]:
        match check["check"]:
            case "absent":
                reasons += checks.absent(output, check["values"])
            case "present":
                reasons += checks.present(output, check["text"])
            case "metadata":
                reasons += checks.metadata(output)
            case "covered":
                reasons += checks.covered(source, output, check["word"])
            case "positions":
                reasons += checks.positions(source, output, check["words"])
            case "pixels":
                at = tuple(check["at"]) if "at" in check else None
                reasons += checks.pixels(source, output, tuple(check["region"]), check.get("mask", False), at)
            case "unchanged":
                reasons += checks.unchanged(source, output, tuple(check["at"]))
            case "rendered":
                reasons += checks.rendered(source, output, check.get("exceptions", []))
            case unknown:
                reasons.append(f"unknown check {unknown!r}")
    return reasons


if __name__ == "__main__":
    reasons = run(json.loads(Path(sys.argv[1]).read_text()))
    print("\n".join(reasons) or "pass")
    sys.exit(1 if reasons else 0)
