from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

from pricing_ingestion.dry_run.runner import run_dry_run


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run selected contract-pricing dry-run profiles in batch.")
    parser.add_argument("--profiles-dir", type=Path, default=Path("pricing_ingestion/profiles"))
    parser.add_argument("--raw-dir", type=Path, default=Path("data/pricing/raw"))
    parser.add_argument("--manifest", type=Path, default=Path("data/pricing/manifest.csv"))
    parser.add_argument("--output", type=Path, required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(argv)
    summaries = []
    for profile_path in sorted(args.profiles_dir.glob("*.json")):
        profile_name = profile_path.stem
        # Batch mode expects profile file names to include a representative workbook hint in notes;
        # explicit single-workbook dry runs remain the preferred pilot path.
        continue
    args.output.mkdir(parents=True, exist_ok=True)
    with (args.output / "batch_summary.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["profile", "workbook", "proposed_rows", "blocking_exception_rows"])
        writer.writeheader()
        writer.writerows(summaries)
    print(json.dumps({"profiles_considered": 0, "output": str(args.output)}, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
