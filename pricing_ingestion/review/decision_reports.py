from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Any


RUN_PAIRS = [
    ("hardening_v1_detecto_2026", "hardening_v2_detecto_2026", "detecto_v1", "detecto_v2"),
    ("hardening_v1_detecto_updated_2026", "hardening_v2_detecto_updated_2026", "detecto_v1", "detecto_v2"),
    ("hardening_v1_quantum_storage_2026", "hardening_v2_quantum_storage_2026", "quantum_storage_v1", "quantum_storage_v2"),
    ("hardening_v1_health_care_logistics_2026_january", "hardening_v2_health_care_logistics_2026_january", "health_care_logistics_v1", "health_care_logistics_v2"),
]

SUMMARY_FIELDS = [
    "run_name",
    "prior_profile_version",
    "new_profile_version",
    "rows_scanned_before",
    "rows_scanned_after",
    "proposed_rows_before",
    "proposed_rows_after",
    "valid_rows_before",
    "valid_rows_after",
    "warning_rows_before",
    "warning_rows_after",
    "blocking_rows_before",
    "blocking_rows_after",
    "excluded_rows_before",
    "excluded_rows_after",
    "unknown_uom_before",
    "unknown_uom_after",
    "missing_price_before",
    "missing_price_after",
    "missing_metadata_after",
    "duplicate_count_before",
    "duplicate_count_after",
    "top_exception_codes_after",
    "readiness_classification",
]


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def count_csv_rows(path: Path) -> int:
    if not path.exists():
        return 0
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return sum(1 for _ in csv.DictReader(handle))


def exception_count(summary: dict[str, Any], code: str) -> int:
    return int(summary.get("exception_counts", {}).get(code, 0))


def metadata_count(summary: dict[str, Any]) -> int:
    counts = summary.get("exception_counts", {})
    return sum(int(count) for code, count in counts.items() if str(code).startswith("MISSING_REQUIRED_"))


def duplicate_count(summary: dict[str, Any]) -> int:
    return exception_count(summary, "DUPLICATE_IDENTICAL_ROW") + exception_count(summary, "DUPLICATE_CONFLICTING_PRICE")


def classify(summary: dict[str, Any]) -> str:
    counts = summary.get("exception_counts", {})
    if metadata_count(summary):
        return "requires_metadata_completion"
    if exception_count(summary, "UNKNOWN_UOM"):
        return "requires_uom_review"
    if int(summary.get("blocking_exception_rows", 0)):
        return "requires_profile_revision"
    if counts.get("MISSING_REQUIRED_DECISION"):
        return "requires_business_decision"
    return "structurally_ready_for_final_review"


def top_codes(summary: dict[str, Any]) -> str:
    counts = summary.get("exception_counts", {})
    top = sorted(counts.items(), key=lambda item: (-int(item[1]), str(item[0])))[:8]
    return "; ".join(f"{code}:{count}" for code, count in top)


def comparison_rows(dry_run_root: Path, run_id: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for prior_run, new_run, prior_profile, new_profile in RUN_PAIRS:
        before_dir = dry_run_root / prior_run
        after_dir = dry_run_root / run_id / new_run
        before = read_json(before_dir / "dry_run_summary.json")
        after = read_json(after_dir / "dry_run_summary.json")
        rows.append(
            {
                "run_name": new_run,
                "prior_profile_version": prior_profile,
                "new_profile_version": new_profile,
                "rows_scanned_before": before.get("rows_scanned", 0),
                "rows_scanned_after": after.get("rows_scanned", 0),
                "proposed_rows_before": before.get("proposed_rows", 0),
                "proposed_rows_after": after.get("proposed_rows", 0),
                "valid_rows_before": before.get("valid_rows", 0),
                "valid_rows_after": after.get("valid_rows", 0),
                "warning_rows_before": before.get("warning_rows", 0),
                "warning_rows_after": after.get("warning_rows", 0),
                "blocking_rows_before": before.get("blocking_exception_rows", 0),
                "blocking_rows_after": after.get("blocking_exception_rows", 0),
                "excluded_rows_before": count_csv_rows(before_dir / "excluded_rows.csv"),
                "excluded_rows_after": count_csv_rows(after_dir / "excluded_rows.csv"),
                "unknown_uom_before": exception_count(before, "UNKNOWN_UOM"),
                "unknown_uom_after": exception_count(after, "UNKNOWN_UOM"),
                "missing_price_before": exception_count(before, "MISSING_PRICE"),
                "missing_price_after": exception_count(after, "MISSING_PRICE"),
                "missing_metadata_after": metadata_count(after),
                "duplicate_count_before": duplicate_count(before),
                "duplicate_count_after": duplicate_count(after),
                "top_exception_codes_after": top_codes(after),
                "readiness_classification": classify(after),
            }
        )
    return rows


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=SUMMARY_FIELDS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def write_before_after_md(path: Path, rows: list[dict[str, Any]]) -> None:
    lines = [
        "# Decision Application Before/After Summary",
        "",
        "| Run | Prior | New | Proposed before | Proposed after | Valid before | Valid after | Blocking before | Blocking after | Readiness |",
        "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ]
    for row in rows:
        lines.append(
            f"| {row['run_name']} | {row['prior_profile_version']} | {row['new_profile_version']} | "
            f"{row['proposed_rows_before']} | {row['proposed_rows_after']} | {row['valid_rows_before']} | "
            f"{row['valid_rows_after']} | {row['blocking_rows_before']} | {row['blocking_rows_after']} | "
            f"{row['readiness_classification']} |"
        )
    lines.extend(["", "Only aggregate counts are included. Commercial row values are intentionally excluded."])
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_readiness_md(path: Path, rows: list[dict[str, Any]]) -> None:
    lines = ["# Profile Readiness", ""]
    for row in rows:
        lines.extend(
            [
                f"## {row['run_name']}",
                "",
                f"- Classification: {row['readiness_classification']}",
                f"- Missing metadata exceptions: {row['missing_metadata_after']}",
                f"- Missing price exceptions: {row['missing_price_after']}",
                f"- Unknown UOM exceptions: {row['unknown_uom_after']}",
                f"- Duplicate exceptions: {row['duplicate_count_after']}",
                "",
            ]
        )
    path.write_text("\n".join(lines), encoding="utf-8")


def write_profile_changes(path: Path, profiles_dir: Path) -> None:
    lines = ["# Profile Changes", ""]
    for profile_name in ["detecto_v2", "quantum_storage_v2", "health_care_logistics_v2"]:
        profile = read_json(profiles_dir / f"{profile_name}.json")
        mappings = [mapping["canonical_field"] for mapping in profile.get("column_mappings", [])]
        lines.extend(
            [
                f"## {profile_name}",
                "",
                f"- Predecessor: {profile.get('predecessor_profile')} {profile.get('predecessor_profile_version')}",
                f"- Status: {profile.get('status')}",
                f"- Review status: {profile.get('review_status')}",
                f"- Applied decisions: {len(profile.get('applied_decision_ids', []))}",
                f"- Mapped canonical fields: {', '.join(mappings)}",
                "- No prices, identifiers, descriptions, contract numbers, account numbers, or source rows are included in this report.",
                "",
            ]
        )
    path.write_text("\n".join(lines), encoding="utf-8")


def write_reports(args: argparse.Namespace) -> dict[str, Any]:
    output_dir = args.output_root / args.run_id
    output_dir.mkdir(parents=True, exist_ok=True)
    rows = comparison_rows(args.dry_run_root, args.run_id)
    write_csv(output_dir / "before_after_summary.csv", rows)
    write_before_after_md(output_dir / "before_after_summary.md", rows)
    write_readiness_md(output_dir / "profile_readiness.md", rows)
    write_profile_changes(output_dir / "profile_changes.md", args.profiles_dir)
    return {"run_id": args.run_id, "reports_written": 4, "output": str(output_dir)}


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Write aggregate decision-application reports.")
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--dry-run-root", type=Path, default=Path("outputs/pricing_discovery/dry_runs"))
    parser.add_argument("--output-root", type=Path, default=Path("outputs/pricing_discovery/decision_application"))
    parser.add_argument("--profiles-dir", type=Path, default=Path("pricing_ingestion/profiles"))
    return parser


def main(argv: list[str] | None = None) -> int:
    result = write_reports(build_arg_parser().parse_args(argv))
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
