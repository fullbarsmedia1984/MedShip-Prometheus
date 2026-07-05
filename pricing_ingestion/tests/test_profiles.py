from __future__ import annotations

import copy
import unittest

from pricing_ingestion.profiles.loader import validate_profile


def valid_profile() -> dict:
    return {
        "schema_version": "1.0.0",
        "profile_name": "synthetic_v1",
        "profile_version": "1.0.0",
        "status": "review_required",
        "distributor_name": "Synthetic",
        "distributor_id": None,
        "description": "Synthetic profile",
        "applicable_family_ids": ["FTEST"],
        "workbook_match_rules": {
            "filename_patterns": ["Synthetic.*\\.xlsx$"],
            "sheet_name_patterns": ["Pricing"],
            "required_headers": ["SKU", "Description", "UOM", "Price"],
            "optional_headers": [],
            "forbidden_headers": [],
            "minimum_match_score": 4,
        },
        "sheet_rules": {
            "exact_sheet_name": "Pricing",
            "case_insensitive_sheet_name": None,
            "regex_sheet_name": None,
            "include_patterns": [],
            "exclude_patterns": [],
            "include_hidden_sheets": False,
            "process_multiple_matching_sheets": False,
        },
        "header_rules": {
            "exact_header_row": 1,
            "candidate_row_range": {"start": 1, "end": 5},
            "required_header_terms": ["SKU", "Description", "UOM", "Price"],
            "optional_header_terms": [],
            "multi_row_header": False,
            "merged_header_handling": "error",
            "normalized_header_matching": True,
            "minimum_header_match_score": 4,
        },
        "data_region_rules": {
            "explicit_first_data_row": 2,
            "first_row_after_detected_header": False,
            "explicit_last_row": None,
            "stop_after_consecutive_blank_required_field_rows": 2,
            "maximum_row_limit": None,
            "skip_hidden_rows": True,
            "include_hidden_rows_with_warning": False,
            "skip_subtotal_and_total_rows": True,
            "repeated_header_detection": True,
        },
        "column_mappings": [
            {"canonical_field": "distributor_sku", "source_header": "SKU", "source_header_aliases": [], "source_column_letter": "A", "source_column_index": 1, "required": True, "transforms": ["normalize_identifier"], "fallback_source_headers": [], "constant_value": None, "default_value": None, "notes": ""},
            {"canonical_field": "item_description_raw", "source_header": "Description", "source_header_aliases": [], "source_column_letter": "B", "source_column_index": 2, "required": True, "transforms": ["normalize_description"], "fallback_source_headers": [], "constant_value": None, "default_value": None, "notes": ""},
            {"canonical_field": "raw_uom", "source_header": "UOM", "source_header_aliases": [], "source_column_letter": "C", "source_column_index": 3, "required": False, "transforms": ["normalize_uom"], "fallback_source_headers": [], "constant_value": None, "default_value": None, "notes": ""},
            {"canonical_field": "price", "source_header": "Price", "source_header_aliases": [], "source_column_letter": "D", "source_column_index": 4, "required": True, "transforms": ["parse_currency"], "fallback_source_headers": [], "constant_value": None, "default_value": None, "notes": ""},
        ],
        "transforms": ["normalize_identifier", "normalize_description", "normalize_uom", "parse_currency"],
        "default_values": {"currency": {"source": "constant", "value": "USD", "manifest_field": None, "required": False}},
        "validation_rules": {},
        "exception_rules": {},
        "notes": "",
        "created_at": "2026-06-17",
        "reviewed_by": None,
        "review_status": "not_reviewed",
    }


class ProfileValidationTests(unittest.TestCase):
    def error_codes(self, profile: dict) -> set[str]:
        return {error.code for error in validate_profile(profile)}

    def test_valid_profile(self) -> None:
        self.assertEqual(validate_profile(valid_profile()), [])

    def test_missing_required_profile_fields(self) -> None:
        profile = valid_profile()
        del profile["profile_name"]
        self.assertIn("MISSING_REQUIRED_PROFILE_FIELD", self.error_codes(profile))

    def test_unsupported_canonical_field(self) -> None:
        profile = valid_profile()
        profile["column_mappings"][0]["canonical_field"] = "not_a_field"
        self.assertIn("UNSUPPORTED_CANONICAL_FIELD", self.error_codes(profile))

    def test_unsupported_transform(self) -> None:
        profile = valid_profile()
        profile["column_mappings"][0]["transforms"] = ["magic"]
        self.assertIn("UNSUPPORTED_TRANSFORM", self.error_codes(profile))

    def test_duplicate_canonical_mapping(self) -> None:
        profile = valid_profile()
        duplicate = copy.deepcopy(profile["column_mappings"][0])
        duplicate["source_column_letter"] = "E"
        duplicate["source_column_index"] = 5
        profile["column_mappings"].append(duplicate)
        self.assertIn("DUPLICATE_CANONICAL_MAPPING", self.error_codes(profile))

    def test_invalid_regex(self) -> None:
        profile = valid_profile()
        profile["workbook_match_rules"]["filename_patterns"] = ["["]
        self.assertIn("INVALID_REGEX", self.error_codes(profile))

    def test_missing_required_mappings(self) -> None:
        profile = valid_profile()
        profile["column_mappings"] = [
            mapping for mapping in profile["column_mappings"] if mapping["canonical_field"] != "price"
        ]
        self.assertIn("MISSING_PRICE_MAPPING", self.error_codes(profile))

        profile = valid_profile()
        profile["column_mappings"] = [
            mapping for mapping in profile["column_mappings"] if mapping["canonical_field"] != "item_description_raw"
        ]
        self.assertIn("MISSING_DESCRIPTION_MAPPING", self.error_codes(profile))

        profile = valid_profile()
        profile["column_mappings"] = [
            mapping for mapping in profile["column_mappings"] if mapping["canonical_field"] != "distributor_sku"
        ]
        self.assertIn("MISSING_ITEM_IDENTIFIER_MAPPING", self.error_codes(profile))

    def test_model_number_and_price_uom_extensions_are_valid(self) -> None:
        profile = valid_profile()
        profile["column_mappings"][0]["canonical_field"] = "model_number"
        price_uom = copy.deepcopy(profile["column_mappings"][2])
        price_uom["canonical_field"] = "raw_price_uom"
        profile["column_mappings"].append(price_uom)
        self.assertEqual(validate_profile(profile), [])


if __name__ == "__main__":
    unittest.main()
