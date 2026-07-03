from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pricing_ingestion.normalization import SUPPORTED_TRANSFORMS


CANONICAL_FIELDS = {
    "distributor_sku",
    "model_number",
    "manufacturer_name",
    "manufacturer_part_number",
    "gtin",
    "udi",
    "ndc",
    "item_description_raw",
    "raw_uom",
    "raw_price_uom",
    "raw_base_uom",
    "pack_size",
    "price",
    "currency",
    "tier",
    "contract_name",
    "contract_number",
    "account_number",
    "location",
    "effective_date",
    "expiration_date",
    "minimum_quantity",
    "rebate_terms",
    "freight_terms",
}

ITEM_IDENTIFIER_FIELDS = {
    "distributor_sku",
    "model_number",
    "manufacturer_part_number",
    "gtin",
    "udi",
    "ndc",
}

PROFILE_STATUS_VALUES = {"draft", "review_required", "approved", "deprecated"}
REVIEW_STATUS_VALUES = {"not_reviewed", "reviewed", "approved", "rejected"}
SHARED_SOURCE_MAPPING_FIELDS = {
    frozenset({"raw_uom", "raw_price_uom"}),
    frozenset({"raw_uom", "raw_base_uom"}),
    frozenset({"raw_price_uom", "raw_base_uom"}),
    frozenset({"raw_uom", "raw_price_uom", "raw_base_uom"}),
}

TOP_LEVEL_REQUIRED = {
    "schema_version",
    "profile_name",
    "profile_version",
    "status",
    "distributor_name",
    "description",
    "applicable_family_ids",
    "workbook_match_rules",
    "sheet_rules",
    "header_rules",
    "data_region_rules",
    "column_mappings",
    "transforms",
    "default_values",
    "validation_rules",
    "exception_rules",
    "notes",
    "created_at",
    "review_status",
}


def schema_path() -> Path:
    return Path(__file__).resolve().parents[1] / "schemas" / "ingestion_profile.schema.json"


def load_schema() -> dict[str, Any]:
    return json.loads(schema_path().read_text(encoding="utf-8"))


@dataclass
class ProfileValidationError:
    code: str
    message: str
    path: str = ""


def load_profile(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _required_errors(profile: dict[str, Any]) -> list[ProfileValidationError]:
    schema = load_schema()
    required = set(schema.get("required", TOP_LEVEL_REQUIRED))
    allowed = set(schema.get("properties", {}))
    errors: list[ProfileValidationError] = []
    for field in sorted(required - set(profile)):
        errors.append(ProfileValidationError("MISSING_REQUIRED_PROFILE_FIELD", f"Missing required field: {field}", field))
    for field in sorted(set(profile) - allowed):
        errors.append(ProfileValidationError("UNSUPPORTED_PROFILE_FIELD", f"Unsupported profile field: {field}", field))
    return errors


def _regex_errors(profile: dict[str, Any]) -> list[ProfileValidationError]:
    errors: list[ProfileValidationError] = []
    pattern_paths = [
        ("workbook_match_rules.filename_patterns", profile.get("workbook_match_rules", {}).get("filename_patterns", [])),
        ("workbook_match_rules.sheet_name_patterns", profile.get("workbook_match_rules", {}).get("sheet_name_patterns", [])),
        ("sheet_rules.regex_sheet_name", [profile.get("sheet_rules", {}).get("regex_sheet_name")]),
        ("sheet_rules.include_patterns", profile.get("sheet_rules", {}).get("include_patterns", [])),
        ("sheet_rules.exclude_patterns", profile.get("sheet_rules", {}).get("exclude_patterns", [])),
    ]
    for path, patterns in pattern_paths:
        for pattern in patterns:
            if not pattern:
                continue
            try:
                re.compile(str(pattern))
            except re.error as exc:
                errors.append(ProfileValidationError("INVALID_REGEX", f"Invalid regular expression: {pattern}: {exc}", path))
    return errors


def _mapping_identity(mapping: dict[str, Any]) -> tuple[Any, ...]:
    return (
        mapping.get("source_column_letter"),
        mapping.get("source_column_index"),
        mapping.get("source_header"),
    )


def validate_profile(profile: dict[str, Any]) -> list[ProfileValidationError]:
    errors = _required_errors(profile)
    if errors:
        return errors

    if profile.get("status") not in PROFILE_STATUS_VALUES:
        errors.append(ProfileValidationError("INVALID_STATUS", "Unsupported profile status.", "status"))
    if profile.get("review_status") not in REVIEW_STATUS_VALUES:
        errors.append(ProfileValidationError("INVALID_REVIEW_STATUS", "Unsupported review status.", "review_status"))

    mappings = profile.get("column_mappings", [])
    if not isinstance(mappings, list) or not mappings:
        errors.append(ProfileValidationError("MISSING_COLUMN_MAPPINGS", "Profile must define column mappings.", "column_mappings"))
        return errors

    seen_canonical: set[str] = set()
    seen_source_columns: dict[tuple[Any, ...], set[str]] = {}
    mapped_fields: set[str] = set()

    for index, mapping in enumerate(mappings):
        path = f"column_mappings[{index}]"
        canonical = mapping.get("canonical_field")
        if canonical not in CANONICAL_FIELDS:
            errors.append(ProfileValidationError("UNSUPPORTED_CANONICAL_FIELD", f"Unsupported canonical field: {canonical}", path))
            continue
        if canonical in seen_canonical:
            errors.append(ProfileValidationError("DUPLICATE_CANONICAL_MAPPING", f"Duplicate mapping for canonical field: {canonical}", path))
        seen_canonical.add(canonical)
        mapped_fields.add(canonical)

        identity = _mapping_identity(mapping)
        if any(identity) and identity in seen_source_columns:
            shared_fields = seen_source_columns[identity] | {canonical}
            if frozenset(shared_fields) not in SHARED_SOURCE_MAPPING_FIELDS:
                errors.append(ProfileValidationError("DUPLICATE_SOURCE_COLUMN_MAPPING", f"Duplicate source column/header mapping for {canonical}.", path))
        if any(identity):
            seen_source_columns.setdefault(identity, set()).add(canonical)

        for transform in mapping.get("transforms", []):
            if transform not in SUPPORTED_TRANSFORMS:
                errors.append(ProfileValidationError("UNSUPPORTED_TRANSFORM", f"Unsupported transform: {transform}", path))

    for transform in profile.get("transforms", []):
        if transform not in SUPPORTED_TRANSFORMS:
            errors.append(ProfileValidationError("UNSUPPORTED_TRANSFORM", f"Unsupported transform: {transform}", "transforms"))

    if "price" not in mapped_fields:
        errors.append(ProfileValidationError("MISSING_PRICE_MAPPING", "Profile must map price.", "column_mappings"))
    if "item_description_raw" not in mapped_fields:
        errors.append(ProfileValidationError("MISSING_DESCRIPTION_MAPPING", "Profile must map item description.", "column_mappings"))
    if not (mapped_fields & ITEM_IDENTIFIER_FIELDS):
        errors.append(ProfileValidationError("MISSING_ITEM_IDENTIFIER_MAPPING", "Profile must map at least one item identifier.", "column_mappings"))

    data_rules = profile.get("data_region_rules", {})
    first_data_row = data_rules.get("explicit_first_data_row")
    last_row = data_rules.get("explicit_last_row")
    if first_data_row and last_row and int(last_row) < int(first_data_row):
        errors.append(ProfileValidationError("INVALID_DATA_REGION_RULES", "explicit_last_row cannot precede explicit_first_data_row.", "data_region_rules"))
    if data_rules.get("skip_hidden_rows") and data_rules.get("include_hidden_rows_with_warning"):
        errors.append(ProfileValidationError("INVALID_DATA_REGION_RULES", "Cannot both skip hidden rows and include hidden rows with warning.", "data_region_rules"))

    if profile.get("status") == "approved" and (
        not profile.get("reviewed_by") or profile.get("review_status") != "approved"
    ):
        errors.append(ProfileValidationError("APPROVED_PROFILE_WITHOUT_REVIEW_METADATA", "Approved profiles require reviewed_by and review_status=approved.", "reviewed_by"))

    errors.extend(_regex_errors(profile))
    return errors


def normalized(value: Any) -> str:
    text = "" if value is None else str(value)
    text = re.sub(r"[_\-/#:]+", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip().lower()


def _profile_required_headers(profile: dict[str, Any]) -> set[str]:
    headers: set[str] = set()
    for mapping in profile.get("column_mappings", []):
        for key in ("source_header",):
            if mapping.get(key):
                headers.add(normalized(mapping[key]))
        for key in ("source_header_aliases", "fallback_source_headers"):
            headers.update(normalized(value) for value in mapping.get(key, []) if value)
    headers.update(normalized(value) for value in profile.get("workbook_match_rules", {}).get("required_headers", []))
    return {header for header in headers if header}


def match_profile_to_discovery(profile: dict[str, Any], discovery_profile: dict[str, Any]) -> dict[str, Any]:
    score = 0
    reasons: list[str] = []
    file_name = discovery_profile.get("file_name", "")
    for pattern in profile.get("workbook_match_rules", {}).get("filename_patterns", []):
        if re.search(pattern, file_name, re.IGNORECASE):
            score += 3
            reasons.append(f"filename matched {pattern}")

    observed_headers: set[str] = set()
    sheet_names = [str(name) for name in discovery_profile.get("sheet_names", [])]
    for sheet in discovery_profile.get("sheets", []):
        observed_headers.update(normalized(value) for value in sheet.get("detected_header_labels", []) if value)
        for candidate in sheet.get("candidate_header_rows", []):
            observed_headers.update(normalized(value) for value in candidate.get("labels", []) if value)

    for pattern in profile.get("workbook_match_rules", {}).get("sheet_name_patterns", []):
        if any(re.search(pattern, sheet_name, re.IGNORECASE) for sheet_name in sheet_names):
            score += 2
            reasons.append(f"sheet matched {pattern}")

    required_headers = _profile_required_headers(profile)
    matched_headers = sorted(header for header in required_headers if header in observed_headers)
    missing_headers = sorted(required_headers - observed_headers)
    score += len(matched_headers)
    if matched_headers:
        reasons.append(f"matched {len(matched_headers)} header(s)")

    forbidden = {
        normalized(value)
        for value in profile.get("workbook_match_rules", {}).get("forbidden_headers", [])
        if value
    }
    forbidden_found = sorted(forbidden & observed_headers)
    minimum_score = profile.get("workbook_match_rules", {}).get("minimum_match_score", 0)
    matched = score >= minimum_score and not forbidden_found and not missing_headers
    return {
        "matched": matched,
        "score": score,
        "minimum_match_score": minimum_score,
        "matched_headers": matched_headers,
        "missing_headers": missing_headers,
        "forbidden_headers_found": forbidden_found,
        "reasons": reasons,
    }
