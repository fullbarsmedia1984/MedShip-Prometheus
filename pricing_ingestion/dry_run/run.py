from __future__ import annotations

import argparse
import json
from pathlib import Path

from pricing_ingestion.dry_run.runner import run_dry_run


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run deterministic contract-pricing dry-run extraction.")
    parser.add_argument("--workbook", required=True, type=Path)
    parser.add_argument("--profile", required=True, type=Path)
    parser.add_argument("--manifest", type=Path, default=None)
    parser.add_argument("--output", required=True, type=Path)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(argv)
    summary = run_dry_run(args.workbook, args.profile, args.manifest, args.output)
    safe_summary = {
        "rows_scanned": summary["rows_scanned"],
        "proposed_rows": summary["proposed_rows"],
        "valid_rows": summary["valid_rows"],
        "warning_rows": summary["warning_rows"],
        "blocking_exception_rows": summary["blocking_exception_rows"],
        "top_exception_codes": dict(sorted(summary["exception_counts"].items())[:10]),
        "output": summary["output"],
    }
    print(json.dumps(safe_summary, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
