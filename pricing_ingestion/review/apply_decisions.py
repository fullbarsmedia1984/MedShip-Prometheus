from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import Counter
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pricing_ingestion.profiles.loader import load_profile
from pricing_ingestion.review.decisions import validate_decisions


PILOT_PROFILES = [
    "detecto_v1",
    "quantum_storage_v1",
    "health_care_logistics_v1",
]

PROFILE_VERSION_MAP = {
    "detecto_v1": ("detecto_v2", "2.0.0"),
    "quantum_storage_v1": ("quantum_storage_v2", "2.0.0"),
    "health_care_logistics_v1": ("health_care_logistics_v2", "2.0.0"),
}

METADATA_REQUIRED_FIELDS = ["contract_number", "effective_date"]
UOM_DECISION_STATUSES = {"approved", "rejected", "not_applicable", "pending"}


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def file_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def decision_rows(data: dict[str, Any]) -> list[dict[str, Any]]:
    return data.get("profiles", []) + data.get("metadata_policy", {}).get("decisions", [])


def decisions_for_profile(data: dict[str, Any], profile_name: str) -> list[dict[str, Any]]:
    return [row for row in data.get("profiles", []) if row.get("profile_name") == profile_name]


def selected_by_category(data: dict[str, Any], profile_name: str) -> dict[str, str]:
    return {
        str(row.get("category")): str(row.get("selected_option") or "")
        for row in decisions_for_profile(data, profile_name)
    }


def metadata_decisions(data: dict[str, Any]) -> dict[str, str]:
    selected: dict[str, str] = {}
    for row in data.get("metadata_policy", {}).get("decisions", []):
        decision_id = str(row.get("decision_id") or "")
        selected[decision_id.removeprefix("metadata_policy:")] = str(row.get("selected_option") or "")
    return selected


def validate_uom_rows(rows: list[dict[str, str]]) -> list[str]:
    errors: list[str] = []
    for index, row in enumerate(rows, start=2):
        status = row.get("decision_status", "")
        if status not in UOM_DECISION_STATUSES:
            errors.append(f"INVALID_UOM_STATUS_ROW_{index}")
        if status == "approved" and not row.get("selected_normalized_uom"):
            errors.append(f"APPROVED_UOM_MISSING_SELECTION_ROW_{index}")
        if status == "approved" and not row.get("rationale"):
            errors.append(f"APPROVED_UOM_MISSING_RATIONALE_ROW_{index}")
        if row.get("classification") == "ambiguous_unit" and status == "approved" and not row.get("rationale"):
            errors.append(f"AMBIGUOUS_UOM_MISSING_RATIONALE_ROW_{index}")
    return errors


def preflight(decisions_path: Path, uom_path: Path) -> dict[str, Any]:
    data = json.loads(decisions_path.read_text(encoding="utf-8"))
    uom_rows = read_csv(uom_path)
    errors = validate_decisions(data)
    if data.get("status") != "ready_to_apply":
        errors.append("DECISION_SET_NOT_READY_TO_APPLY")

    for row in decision_rows(data):
        if row.get("decision_status") == "approved":
            for field in ["selected_option", "rationale", "decided_by", "decided_at"]:
                if not row.get(field):
                    errors.append(f"APPROVED_DECISION_MISSING_{field.upper()}:{row.get('decision_id')}")

    errors.extend(validate_uom_rows(uom_rows))
    uom_statuses = Counter(row.get("decision_status") for row in uom_rows)
    return {
        "passed": not errors,
        "errors": errors,
        "decision_status": data.get("status"),
        "profile_decisions": len(data.get("profiles", [])),
        "metadata_decisions": len(data.get("metadata_policy", {}).get("decisions", [])),
        "uom_decisions": len(uom_rows),
        "uom_statuses": dict(sorted(uom_statuses.items())),
    }


def write_preflight_report(path: Path, result: dict[str, Any]) -> None:
    lines = [
        "# Decision Application Preflight",
        "",
        f"- Result: {'passed' if result['passed'] else 'failed'}",
        f"- Decision-set status: {result['decision_status']}",
        f"- Profile decisions: {result['profile_decisions']}",
        f"- Metadata decisions: {result['metadata_decisions']}",
        f"- UOM decisions: {result['uom_decisions']}",
        "",
        "## UOM Decision Statuses",
        "",
    ]
    for status, count in result["uom_statuses"].items():
        lines.append(f"- {status}: {count}")
    lines.extend(["", "## Errors", ""])
    if result["errors"]:
        lines.extend(f"- {error}" for error in result["errors"])
    else:
        lines.append("- None")
    lines.extend(["", "This report intentionally excludes prices, item identifiers, item descriptions, account numbers, contract numbers, and full source rows."])
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def mapping_for(profile: dict[str, Any], canonical_field: str) -> dict[str, Any] | None:
    for mapping in profile.get("column_mappings", []):
        if mapping.get("canonical_field") == canonical_field:
            return mapping
    return None


def remove_mapping(profile: dict[str, Any], canonical_field: str) -> None:
    profile["column_mappings"] = [
        mapping for mapping in profile.get("column_mappings", []) if mapping.get("canonical_field") != canonical_field
    ]


def add_raw_price_uom_mapping(profile: dict[str, Any], decision_id: str) -> None:
    if mapping_for(profile, "raw_price_uom"):
        return
    raw_uom = mapping_for(profile, "raw_uom")
    if not raw_uom:
        return
    mapping = deepcopy(raw_uom)
    mapping["canonical_field"] = "raw_price_uom"
    mapping["required"] = False
    mapping["notes"] = f"Price UOM captured from the approved UOM source. Decision: {decision_id}."
    profile["column_mappings"].append(mapping)


def ensure_manifest_default(profile: dict[str, Any], field: str, required: bool) -> None:
    profile.setdefault("default_values", {})[field] = {
        "source": "manifest",
        "value": None,
        "manifest_field": field,
        "required": required,
    }


def update_required_headers(profile: dict[str, Any], add: str, remove: str | None = None) -> None:
    for section, key in [
        ("workbook_match_rules", "required_headers"),
        ("header_rules", "required_header_terms"),
    ]:
        values = [value for value in profile.get(section, {}).get(key, []) if value != remove]
        if add not in values:
            values.append(add)
        profile[section][key] = values
    if remove:
        optional = profile.get("workbook_match_rules", {}).setdefault("optional_headers", [])
        if remove not in optional:
            optional.append(remove)
        optional_terms = profile.get("header_rules", {}).setdefault("optional_header_terms", [])
        if remove not in optional_terms:
            optional_terms.append(remove)


def apply_profile_decisions(profile: dict[str, Any], decisions: dict[str, Any]) -> dict[str, Any]:
    predecessor_name = profile["profile_name"]
    new_name, new_version = PROFILE_VERSION_MAP[predecessor_name]
    profile_decisions = decisions_for_profile(decisions, predecessor_name)
    selected = selected_by_category(decisions, predecessor_name)
    metadata = metadata_decisions(decisions)
    decision_ids = [str(row["decision_id"]) for row in profile_decisions]
    decision_ids.extend(str(row["decision_id"]) for row in decisions.get("metadata_policy", {}).get("decisions", []))

    updated = deepcopy(profile)
    updated["profile_name"] = new_name
    updated["profile_version"] = new_version
    updated["status"] = "review_required"
    updated["review_status"] = "not_reviewed"
    updated["reviewed_by"] = None
    updated["predecessor_profile"] = predecessor_name
    updated["predecessor_profile_version"] = profile.get("profile_version")
    updated["applied_decision_ids"] = sorted(decision_ids)
    updated["decision_references"] = {
        row["category"]: {
            "decision_id": row["decision_id"],
            "selected_option": row.get("selected_option"),
            "decided_by": row.get("decided_by"),
            "decided_at": row.get("decided_at"),
        }
        for row in profile_decisions
    }
    updated["decision_references"]["metadata_policy"] = {
        key: value for key, value in sorted(metadata.items())
    }

    if predecessor_name == "detecto_v1" and selected.get("item_identifier") == "Model [model_number]":
        model_mapping = mapping_for(updated, "manufacturer_part_number")
        if model_mapping and model_mapping.get("source_header") == "Model":
            model_mapping["canonical_field"] = "model_number"
            model_mapping["notes"] = "Approved as model_number; not duplicated into manufacturer_part_number."

    if predecessor_name == "quantum_storage_v1" and selected.get("pricing_basis") == "Discounted [discounted_price]":
        price_mapping = mapping_for(updated, "price")
        if price_mapping:
            price_mapping["source_header"] = "Discounted"
            price_mapping["source_header_aliases"] = []
            price_mapping["source_column_letter"] = None
            price_mapping["source_column_index"] = None
            price_mapping["fallback_source_headers"] = []
            price_mapping["notes"] = "Approved negotiated-price source; List Price is not used as fallback."
        update_required_headers(updated, "Discounted", "List Price")

    price_uom_decision = next((row for row in profile_decisions if row.get("category") == "price_uom"), None)
    if price_uom_decision:
        add_raw_price_uom_mapping(updated, str(price_uom_decision["decision_id"]))

    ensure_manifest_default(updated, "contract_number", metadata.get("contract_number_required_before_publish") == "required_before_publish")
    if selected.get("effective_date_source") == "manifest":
        ensure_manifest_default(updated, "effective_date", metadata.get("effective_date_required_before_publish") == "required_before_publish")

    updated.setdefault("validation_rules", {})["required_metadata_fields"] = METADATA_REQUIRED_FIELDS
    updated.setdefault("validation_rules", {})["metadata_source_policy"] = selected.get("contract_metadata") or metadata.get("metadata_source_policy")
    updated.setdefault("validation_rules", {})["expiration_date_nullable"] = metadata.get("expiration_date_nullable") == "nullable_allowed"
    updated.setdefault("exception_rules", {})["required_metadata_missing"] = "blocking"
    updated.setdefault("exception_rules", {})["metadata_conflict"] = "blocking"
    updated["notes"] = (
        "Decision-applied v2 pilot profile. Status remains review_required and review_status remains not_reviewed. "
        "No unit conversions, each-price calculations, or unapproved price fallbacks are inferred."
    )
    return updated


def create_v2_profiles(decisions_path: Path, profiles_dir: Path) -> list[dict[str, str]]:
    decisions = json.loads(decisions_path.read_text(encoding="utf-8"))
    created: list[dict[str, str]] = []
    for predecessor in PILOT_PROFILES:
        source_path = profiles_dir / f"{predecessor}.json"
        target_name, target_version = PROFILE_VERSION_MAP[predecessor]
        target_path = profiles_dir / f"{target_name}.json"
        profile = load_profile(source_path)
        updated = apply_profile_decisions(profile, decisions)
        write_json(target_path, updated)
        created.append(
            {
                "predecessor_profile": predecessor,
                "predecessor_version": str(profile.get("profile_version")),
                "new_profile": target_name,
                "new_version": target_version,
                "path": str(target_path),
            }
        )
    return created


def write_decision_application(
    path: Path,
    decisions_path: Path,
    uom_path: Path,
    decisions: dict[str, Any],
    created_profiles: list[dict[str, str]],
    application_timestamp: str,
) -> None:
    rows = decision_rows(decisions)
    data = {
        "decision_set_version": decisions.get("decision_set_version"),
        "application_timestamp": application_timestamp,
        "applied_decision_ids": [row.get("decision_id") for row in rows],
        "profile_names_affected": [row["new_profile"] for row in created_profiles],
        "profile_versions": created_profiles,
        "reviewer_identifiers": sorted({str(row.get("decided_by")) for row in rows if row.get("decided_by")}),
        "decision_timestamps": sorted({str(row.get("decided_at")) for row in rows if row.get("decided_at")}),
        "input_hashes": {
            str(decisions_path): file_hash(decisions_path),
            str(uom_path): file_hash(uom_path),
        },
    }
    write_json(path, data)


def run_apply(args: argparse.Namespace) -> int:
    run_id = args.run_id or datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    output_dir = args.output_root / run_id
    result = preflight(args.decisions, args.uom_decisions)
    write_preflight_report(output_dir / "preflight_report.md", result)
    if not result["passed"]:
        print(json.dumps({"run_id": run_id, "preflight_passed": False, "errors": result["errors"]}, indent=2, sort_keys=True))
        return 1

    created = []
    if not args.preflight_only:
        created = create_v2_profiles(args.decisions, args.profiles_dir)
        decisions = json.loads(args.decisions.read_text(encoding="utf-8"))
        write_decision_application(
            output_dir / "decision_application.json",
            args.decisions,
            args.uom_decisions,
            decisions,
            created,
            utc_now(),
        )
    print(json.dumps({"run_id": run_id, "preflight_passed": True, "profiles_created": created, "output": str(output_dir)}, indent=2, sort_keys=True))
    return 0


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Apply approved contract-pricing business decisions to v2 pilot profiles.")
    parser.add_argument("--decisions", type=Path, default=Path("data/pricing/business_decisions.local.json"))
    parser.add_argument("--uom-decisions", type=Path, default=Path("data/pricing/uom_decisions.local.csv"))
    parser.add_argument("--profiles-dir", type=Path, default=Path("pricing_ingestion/profiles"))
    parser.add_argument("--output-root", type=Path, default=Path("outputs/pricing_discovery/decision_application"))
    parser.add_argument("--run-id", default="")
    parser.add_argument("--preflight-only", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_arg_parser()
    return run_apply(parser.parse_args(argv))


if __name__ == "__main__":
    raise SystemExit(main())
