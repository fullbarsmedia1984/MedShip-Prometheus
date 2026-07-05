from __future__ import annotations

import argparse
import csv
import json
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pricing_ingestion.normalization import normalize_uom
from pricing_ingestion.profiles.loader import load_profile, validate_profile


UOM_REVIEW_FIELDS = [
    "profile_name",
    "family_id",
    "raw_uom",
    "normalized_token",
    "occurrence_count",
    "candidate_normalized_uom",
    "confidence",
    "classification",
    "proposed_action",
    "notes",
]

DECISION_FIELDS = [
    "profile_name",
    "family_id",
    "decision_id",
    "decision_category",
    "candidate_source_field",
    "candidate_canonical_field",
    "recommended_choice",
    "recommendation_confidence",
    "evidence_summary",
    "business_question",
    "required_reviewer",
    "decision_status",
    "profile_change_after_approval",
]


@dataclass
class DryRunReview:
    run_name: str
    run_dir: Path
    summary: dict[str, Any]
    proposed_rows: list[dict[str, str]]
    exceptions: list[dict[str, str]]
    excluded_rows: list[dict[str, str]]
    profile: dict[str, Any]

    @property
    def profile_name(self) -> str:
        return str(self.profile.get("profile_name") or self.run_name)

    @property
    def family_id(self) -> str:
        family_ids = self.profile.get("applicable_family_ids") or []
        return str(family_ids[0]) if family_ids else ""

    @property
    def source_files(self) -> list[str]:
        return sorted({row.get("source_file", "") for row in self.proposed_rows if row.get("source_file")})


def read_csv(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def write_csv(path: Path, fieldnames: list[str], rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def normalize_token(value: str | None) -> str:
    if value is None or not str(value).strip():
        return ""
    text = str(value).strip().upper()
    text = re.sub(r"\s+", " ", text)
    text = text.strip(" .")
    return text


def classify_uom(raw_uom: str | None) -> tuple[str, str, str, str, str]:
    token = normalize_token(raw_uom)
    if not token:
        return token, "", "high", "missing_value", "requires_manual_mapping"
    if re.search(r"\d+\s*/\s*[A-Z]+|\d+\s*X\s*\d+|CASE OF \d+", token):
        return token, "", "medium", "packaging_expression", "parse_as_pack_size"
    try:
        normalized = normalize_uom(token)
        return token, normalized or "", "high", "known_alias", "normalize_automatically"
    except ValueError:
        pass

    compact = re.sub(r"[^A-Z0-9/ X.-]+", "", token)
    if re.fullmatch(r"\d+(\.\d+)?", compact):
        return token, "", "high", "ambiguous_unit", "retain_as_unresolved"
    if re.search(r"\b(IN|INCH|INCHES|CM|MM|FT|FEET|LB|LBS|OZ)\b", token):
        return token, "", "medium", "dimensional_unit", "retain_as_unresolved"
    if token in {"SET", "KIT", "ASSORTED", "VARIOUS", "NAN", "NONE"}:
        return token, "", "medium", "ambiguous_unit", "requires_manual_mapping"
    return token, "", "low", "requires_business_review", "requires_manual_mapping"


def load_profiles(profiles_dir: Path) -> dict[str, dict[str, Any]]:
    profiles = {}
    for path in sorted(profiles_dir.glob("*.json")):
        profile = load_profile(path)
        profiles[str(profile.get("profile_name"))] = profile
    return profiles


def load_review_runs(dry_run_root: Path, profiles_dir: Path) -> list[DryRunReview]:
    profiles = load_profiles(profiles_dir)
    runs: list[DryRunReview] = []
    for run_dir in sorted(path for path in dry_run_root.iterdir() if path.is_dir()):
        summary_path = run_dir / "dry_run_summary.json"
        if not summary_path.exists():
            continue
        summary = json.loads(summary_path.read_text(encoding="utf-8"))
        proposed_rows = read_csv(run_dir / "proposed_rows.csv")
        profile_name = proposed_rows[0].get("profile_name") if proposed_rows else run_dir.name
        profile = profiles.get(profile_name)
        if not profile:
            continue
        runs.append(
            DryRunReview(
                run_name=run_dir.name,
                run_dir=run_dir,
                summary=summary,
                proposed_rows=proposed_rows,
                exceptions=read_csv(run_dir / "exceptions.csv"),
                excluded_rows=read_csv(run_dir / "excluded_rows.csv"),
                profile=profile,
            )
        )
    return runs


def build_uom_review(runs: list[DryRunReview]) -> list[dict[str, Any]]:
    counts: dict[tuple[str, str, str], Counter[str]] = defaultdict(Counter)
    for run in runs:
        for row in run.proposed_rows:
            counts[(run.profile_name, run.family_id, row.get("raw_uom", ""))][row.get("raw_uom", "")] += 1

    rows = []
    for (profile_name, family_id, raw_uom), counter in sorted(counts.items()):
        token, candidate, confidence, classification, action = classify_uom(raw_uom)
        rows.append(
            {
                "profile_name": profile_name,
                "family_id": family_id,
                "raw_uom": raw_uom,
                "normalized_token": token,
                "occurrence_count": sum(counter.values()),
                "candidate_normalized_uom": candidate,
                "confidence": confidence,
                "classification": classification,
                "proposed_action": action,
                "notes": "No package conversion inferred.",
            }
        )
    return rows


def mapping_for(profile: dict[str, Any], field: str) -> dict[str, Any] | None:
    for mapping in profile.get("column_mappings", []):
        if mapping.get("canonical_field") == field:
            return mapping
    return None


def source_header(mapping: dict[str, Any] | None) -> str:
    if not mapping:
        return ""
    return str(mapping.get("source_header") or mapping.get("source_column_letter") or "")


def build_decision_matrix(runs: list[DryRunReview]) -> list[dict[str, Any]]:
    rows = []
    seen_profiles = {}
    for run in runs:
        seen_profiles[run.profile_name] = run.profile
    for profile_name, profile in sorted(seen_profiles.items()):
        family_id = ";".join(profile.get("applicable_family_ids", []))
        price_mapping = mapping_for(profile, "price")
        desc = profile.get("distributor_name", profile_name)
        price_header = source_header(price_mapping)
        rows.append(
            {
                "profile_name": profile_name,
                "family_id": family_id,
                "decision_id": f"{profile_name}:pricing_basis",
                "decision_category": "pricing_basis",
                "candidate_source_field": price_header,
                "candidate_canonical_field": "price",
                "recommended_choice": "pending_human_confirmation",
                "recommendation_confidence": "medium",
                "evidence_summary": "Mapped source header is structurally parseable; final negotiated-price basis is a business decision.",
                "business_question": f"For {desc}, is this source header the correct negotiated or contract price?",
                "required_reviewer": "Purchasing Manager",
                "decision_status": "pending",
                "profile_change_after_approval": "Update selected price mapping if reviewer chooses a different source field.",
            }
        )

        identifier_mapping = next((mapping for mapping in profile.get("column_mappings", []) if mapping.get("canonical_field") in {"distributor_sku", "manufacturer_part_number", "gtin", "udi", "ndc"}), None)
        rows.append(
            {
                "profile_name": profile_name,
                "family_id": family_id,
                "decision_id": f"{profile_name}:item_identifier",
                "decision_category": "item_identifier",
                "candidate_source_field": source_header(identifier_mapping),
                "candidate_canonical_field": identifier_mapping.get("canonical_field") if identifier_mapping else "",
                "recommended_choice": "pending_human_confirmation",
                "recommendation_confidence": "medium",
                "evidence_summary": "Identifier mapping is structurally stable; semantic meaning still needs reviewer confirmation.",
                "business_question": "Does this source field represent distributor SKU, manufacturer part number, GTIN/UPC, or model number?",
                "required_reviewer": "Purchasing Manager / Product Data Owner",
                "decision_status": "pending",
                "profile_change_after_approval": "Adjust canonical identifier mapping or add a model-number canonical field if needed.",
            }
        )

        uom_mapping = mapping_for(profile, "raw_uom")
        rows.append(
            {
                "profile_name": profile_name,
                "family_id": family_id,
                "decision_id": f"{profile_name}:price_uom",
                "decision_category": "price_uom",
                "candidate_source_field": source_header(uom_mapping),
                "candidate_canonical_field": "raw_uom",
                "recommended_choice": "pending_human_confirmation",
                "recommendation_confidence": "low",
                "evidence_summary": "Current model has raw_uom/normalized_uom only; some workbooks may distinguish price unit from sales/base unit.",
                "business_question": "Which unit does the price apply to, and is it distinct from inventory/base UOM?",
                "required_reviewer": "Purchasing Manager",
                "decision_status": "pending",
                "profile_change_after_approval": "May require raw_price_uom/normalized_price_uom and raw_base_uom/normalized_base_uom.",
            }
        )

        rows.append(
            {
                "profile_name": profile_name,
                "family_id": family_id,
                "decision_id": f"{profile_name}:contract_metadata",
                "decision_category": "contract_metadata",
                "candidate_source_field": "manifest",
                "candidate_canonical_field": "contract_name;contract_number;account_number",
                "recommended_choice": "pending_manifest_completion",
                "recommendation_confidence": "high",
                "evidence_summary": "Profiles are configured to read contract/account metadata from manifest where available.",
                "business_question": "Which contract/account metadata is required before publish workflows?",
                "required_reviewer": "Purchasing Manager / Operations",
                "decision_status": "pending",
                "profile_change_after_approval": "Mark manifest defaults required or add workbook-level extraction rules.",
            }
        )
    return rows


def exception_counter(run: DryRunReview) -> Counter[str]:
    return Counter(row.get("exception_code", "") for row in run.exceptions if row.get("exception_code"))


def duplicate_count(run: DryRunReview) -> int:
    counts = exception_counter(run)
    return counts.get("DUPLICATE_IDENTICAL_ROW", 0) + counts.get("DUPLICATE_CONFLICTING_PRICE", 0)


def classify_readiness(run: DryRunReview) -> str:
    if run.summary.get("blocking_exception_rows", 0):
        return "requires_profile_revision"
    if exception_counter(run).get("UNKNOWN_UOM", 0):
        return "requires_uom_review"
    return "requires_pricing_basis_decision"


def write_exception_review_summary(runs: list[DryRunReview], output_dir: Path) -> None:
    lines = ["# Pilot Exception Review Summary", ""]
    for run in runs:
        counts = exception_counter(run)
        lines.extend(
            [
                f"## {run.run_name}",
                "",
                f"- Profile: {run.profile_name}",
                f"- Family: {run.family_id}",
                f"- Rows scanned: {run.summary.get('rows_scanned', 0)}",
                f"- Proposed rows: {run.summary.get('proposed_rows', 0)}",
                f"- Valid rows: {run.summary.get('valid_rows', 0)}",
                f"- Warning rows: {run.summary.get('warning_rows', 0)}",
                f"- Blocking rows: {run.summary.get('blocking_exception_rows', 0)}",
                "- Top exception codes:",
            ]
        )
        if counts:
            lines.extend(f"  - {code}: {count}" for code, count in counts.most_common(8))
        else:
            lines.append("  - None")
        lines.append("")
    lines.append("Reports intentionally exclude prices, item identifiers, item descriptions, account numbers, contract numbers, and full source rows.")
    (output_dir / "exception_review_summary.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_detecto_variant_analysis(runs: list[DryRunReview], output_dir: Path) -> None:
    detecto_runs = [run for run in runs if run.profile_name.startswith("detecto")]
    lines = [
        "# Detecto Variant Analysis",
        "",
        "The Detecto workbooks use the same sheet name, header row, and selected structural headers under the current profile.",
        "The updated workbook dry-runs cleanly, while the larger 2026 workbook still has non-item or malformed rows that require review.",
        "",
        "| Run | Rows scanned | Proposed | Blocking rows | Missing description | Missing price | Excluded rows | Recommendation |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ]
    for run in detecto_runs:
        counts = exception_counter(run)
        lines.append(
            f"| {run.run_name} | {run.summary.get('rows_scanned', 0)} | {run.summary.get('proposed_rows', 0)} | {run.summary.get('blocking_exception_rows', 0)} | {counts.get('MISSING_DESCRIPTION', 0)} | {counts.get('MISSING_PRICE', 0)} | {len(run.excluded_rows)} | Keep one profile for now; review remaining blocking row patterns. |"
        )
    lines.extend(
        [
            "",
            "Variant decision: do not split Detecto profiles yet. The structural rules are compatible, but the broader workbook needs business review for rows with identifiers/prices missing companion fields.",
            "No row-level values are included in this report.",
        ]
    )
    (output_dir / "detecto_variant_analysis.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_profile_readiness(runs: list[DryRunReview], output_dir: Path, manifest_path: Path | None) -> None:
    manifest_rows = read_csv(manifest_path) if manifest_path else []
    manifest_by_file = {row.get("file_name", ""): row for row in manifest_rows}
    lines = [
        "# Pilot Profile Readiness",
        "",
        "| Run | Profile | Family | Validation | Price decision | Identifier decision | UOM decision | Manifest metadata | Rows scanned | Proposed | Valid | Warning | Blocking | Blocking rate | Unknown UOM | Duplicates | Formula-derived | Readiness | Blockers before approval | Next action |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |",
    ]
    for run in runs:
        validation = "valid" if not validate_profile(run.profile) else "invalid"
        counts = exception_counter(run)
        proposed = int(run.summary.get("proposed_rows", 0) or 0)
        blocking = int(run.summary.get("blocking_exception_rows", 0) or 0)
        blocking_rate = f"{(blocking / proposed * 100):.1f}%" if proposed else "0.0%"
        metadata_state = "incomplete"
        if run.source_files:
            row = manifest_by_file.get(run.source_files[0], {})
            if row and all(row.get(field) for field in ["contract_name", "contract_number", "account_number"]):
                metadata_state = "complete"
        readiness = classify_readiness(run)
        blockers = []
        if blocking:
            blockers.append("blocking exceptions")
        if counts.get("UNKNOWN_UOM", 0):
            blockers.append("unknown UOM review")
        blockers.append("pricing basis pending")
        lines.append(
            f"| {run.run_name} | {run.profile_name} | {run.family_id} | {validation} | pending | pending | pending | {metadata_state} | {run.summary.get('rows_scanned', 0)} | {proposed} | {run.summary.get('valid_rows', 0)} | {run.summary.get('warning_rows', 0)} | {blocking} | {blocking_rate} | {counts.get('UNKNOWN_UOM', 0)} | {duplicate_count(run)} | {run.summary.get('formula_derived_rows', 0)} | {readiness} | {'; '.join(blockers)} | Review decisions and rerun. |"
        )
    lines.extend(
        [
            "",
            "## Canonical UOM Model Review",
            "",
            "Current dry-run rows preserve `raw_uom` and `normalized_uom`. That is sufficient for structural dry-run review, but it is not sufficient for publish-ready pricing when a workbook distinguishes the unit attached to price from a base, inventory, carton, or sales unit.",
            "",
            "Recommended design decision before publish: add backward-compatible fields `raw_price_uom`, `normalized_price_uom`, `raw_base_uom`, and `normalized_base_uom`. Do not implement unit conversion or each-price normalization as part of that extension.",
        ]
    )
    (output_dir / "profile_readiness.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_decision_matrix(rows: list[dict[str, Any]], output_dir: Path) -> None:
    write_csv(output_dir / "profile_decision_matrix.csv", DECISION_FIELDS, rows)


def run_review(dry_run_root: Path, output_dir: Path, profiles_dir: Path, manifest_path: Path | None) -> dict[str, Any]:
    runs = load_review_runs(dry_run_root, profiles_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    uom_rows = build_uom_review(runs)
    write_csv(output_dir / "uom_review.csv", UOM_REVIEW_FIELDS, uom_rows)
    write_decision_matrix(build_decision_matrix(runs), output_dir)
    write_exception_review_summary(runs, output_dir)
    write_detecto_variant_analysis(runs, output_dir)
    write_profile_readiness(runs, output_dir, manifest_path)
    return {
        "runs_reviewed": len(runs),
        "uom_tokens": len(uom_rows),
        "output": str(output_dir),
    }


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Review contract-pricing dry-run exceptions safely.")
    parser.add_argument("--dry-run-root", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--profiles-dir", type=Path, default=Path("pricing_ingestion/profiles"))
    parser.add_argument("--manifest", type=Path, default=Path("data/pricing/manifest.csv"))
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(argv)
    result = run_review(args.dry_run_root, args.output, args.profiles_dir, args.manifest)
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
