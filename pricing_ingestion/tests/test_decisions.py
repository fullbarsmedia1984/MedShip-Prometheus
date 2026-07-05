from __future__ import annotations

import csv
import json
import tempfile
import unittest
from pathlib import Path

from openpyxl import Workbook

from pricing_ingestion.review.decisions import (
    apply_packet_answers,
    build_identifier_candidates,
    build_price_basis_candidates,
    build_uom_decisions,
    generate,
    run_validate,
    validate_decisions,
)
from pricing_ingestion.review.apply_decisions import apply_profile_decisions, preflight
from pricing_ingestion.review.exceptions import load_review_runs


def write_csv(path: Path, fieldnames: list[str], rows: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def detecto_profile() -> dict:
    return {
        "schema_version": "1.0.0",
        "profile_name": "detecto_v1",
        "profile_version": "1.0.0",
        "status": "review_required",
        "distributor_name": "Detecto",
        "distributor_id": None,
        "description": "Synthetic Detecto profile",
        "applicable_family_ids": ["F003"],
        "workbook_match_rules": {
            "filename_patterns": ["Synthetic Detecto.*\\.xlsx$"],
            "sheet_name_patterns": ["Sheet1"],
            "required_headers": ["Model", "Description", "UOM", "Net Price"],
            "optional_headers": ["List Price"],
            "forbidden_headers": [],
            "minimum_match_score": 4,
        },
        "sheet_rules": {
            "exact_sheet_name": "Sheet1",
            "case_insensitive_sheet_name": None,
            "regex_sheet_name": None,
            "include_patterns": [],
            "exclude_patterns": [],
            "include_hidden_sheets": False,
            "process_multiple_matching_sheets": False,
        },
        "header_rules": {
            "exact_header_row": 1,
            "candidate_row_range": {"start": 1, "end": 2},
            "required_header_terms": ["Model", "Description", "UOM", "Net Price"],
            "optional_header_terms": ["List Price"],
            "multi_row_header": False,
            "merged_header_handling": "error",
            "normalized_header_matching": True,
            "minimum_header_match_score": 4,
        },
        "data_region_rules": {
            "explicit_first_data_row": 2,
            "first_row_after_detected_header": False,
            "explicit_last_row": None,
            "stop_after_consecutive_blank_required_field_rows": 5,
            "maximum_row_limit": None,
            "skip_hidden_rows": True,
            "include_hidden_rows_with_warning": False,
            "skip_subtotal_and_total_rows": True,
            "repeated_header_detection": True,
        },
        "column_mappings": [
            {"canonical_field": "manufacturer_part_number", "source_header": "Model", "source_header_aliases": [], "source_column_letter": "A", "source_column_index": 1, "required": True, "transforms": ["normalize_identifier"], "fallback_source_headers": [], "constant_value": None, "default_value": None, "notes": ""},
            {"canonical_field": "item_description_raw", "source_header": "Description", "source_header_aliases": [], "source_column_letter": "B", "source_column_index": 2, "required": True, "transforms": ["normalize_description"], "fallback_source_headers": [], "constant_value": None, "default_value": None, "notes": ""},
            {"canonical_field": "raw_uom", "source_header": "UOM", "source_header_aliases": [], "source_column_letter": "C", "source_column_index": 3, "required": False, "transforms": ["normalize_uom"], "fallback_source_headers": [], "constant_value": None, "default_value": None, "notes": ""},
            {"canonical_field": "price", "source_header": "Net Price", "source_header_aliases": [], "source_column_letter": "D", "source_column_index": 4, "required": True, "transforms": ["parse_currency"], "fallback_source_headers": [], "constant_value": None, "default_value": None, "notes": ""},
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


class DecisionWorkflowTests(unittest.TestCase):
    def make_fixture(self, root: Path) -> tuple[Path, Path, Path, Path, Path]:
        review_root = root / "pilot_review"
        dry_root = root / "dry_runs"
        profiles_dir = root / "profiles"
        raw_root = root / "raw"
        output = root / "business_decisions.local.json"
        run_dir = dry_root / "hardening_v1_detecto_2026"
        profiles_dir.mkdir(parents=True)
        raw_root.mkdir(parents=True)
        run_dir.mkdir(parents=True)

        profile = detecto_profile()
        (profiles_dir / "detecto_v1.json").write_text(json.dumps(profile), encoding="utf-8")

        workbook = Workbook()
        sheet = workbook.active
        sheet.title = "Sheet1"
        sheet.append(["Model", "Description", "UOM", "Net Price", "List Price"])
        sheet.append(["SENSITIVE-MODEL", "Sensitive item description", "EACHES", None, "$999.99"])
        sheet.append(["SENSITIVE-MODEL-2", "Sensitive item description 2", "10/BOX", None, None])
        workbook.save(raw_root / "Synthetic Detecto.xlsx")

        (run_dir / "dry_run_summary.json").write_text(
            json.dumps(
                {
                    "rows_scanned": 2,
                    "proposed_rows": 2,
                    "valid_rows": 0,
                    "warning_rows": 0,
                    "blocking_exception_rows": 2,
                    "formula_derived_rows": 0,
                    "exception_counts": {"MISSING_PRICE": 2},
                }
            ),
            encoding="utf-8",
        )
        write_csv(
            run_dir / "proposed_rows.csv",
            ["profile_name", "source_file", "source_sheet_name", "source_row_number", "manufacturer_part_number", "item_description_raw", "raw_uom", "warning_codes"],
            [
                {"profile_name": "detecto_v1", "source_file": "Synthetic Detecto.xlsx", "source_sheet_name": "Sheet1", "source_row_number": 2, "manufacturer_part_number": "SENSITIVE-MODEL", "item_description_raw": "Sensitive item description", "raw_uom": "EACHES", "warning_codes": ""},
                {"profile_name": "detecto_v1", "source_file": "Synthetic Detecto.xlsx", "source_sheet_name": "Sheet1", "source_row_number": 3, "manufacturer_part_number": "SENSITIVE-MODEL-2", "item_description_raw": "Sensitive item description 2", "raw_uom": "10/BOX", "warning_codes": ""},
            ],
        )
        write_csv(
            run_dir / "exceptions.csv",
            ["exception_code", "severity", "source_row"],
            [
                {"exception_code": "MISSING_PRICE", "severity": "blocking", "source_row": 2},
                {"exception_code": "MISSING_PRICE", "severity": "blocking", "source_row": 3},
            ],
        )
        write_csv(run_dir / "excluded_rows.csv", ["source_file", "source_sheet", "source_row", "reason", "message"], [])
        write_csv(
            review_root / "uom_review.csv",
            ["profile_name", "family_id", "raw_uom", "normalized_token", "occurrence_count", "candidate_normalized_uom", "confidence", "classification", "proposed_action", "notes"],
            [
                {"profile_name": "detecto_v1", "family_id": "F003", "raw_uom": "EACHES", "normalized_token": "EACHES", "occurrence_count": 1, "candidate_normalized_uom": "EA", "confidence": "high", "classification": "known_alias", "proposed_action": "normalize_automatically", "notes": ""},
                {"profile_name": "detecto_v1", "family_id": "F003", "raw_uom": "10/BOX", "normalized_token": "10/BOX", "occurrence_count": 1, "candidate_normalized_uom": "", "confidence": "medium", "classification": "packaging_expression", "proposed_action": "parse_as_pack_size", "notes": ""},
            ],
        )
        write_csv(root / "manifest.csv", ["file_name", "distributor_name", "contract_name", "contract_number", "account_number", "location", "effective_date", "expiration_date", "notes"], [])
        return review_root, dry_root, profiles_dir, raw_root, output

    def test_generation_and_validation_create_expected_files(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            review_root, dry_root, profiles_dir, raw_root, output = self.make_fixture(root)
            business_output = root / "business_review"
            result = generate(review_root, dry_root, profiles_dir, output, business_output, root / "manifest.csv", raw_root, root / "uom_decisions.local.csv")

            self.assertTrue(result["decision_file_written"])
            self.assertTrue((business_output / "business_review_packet.md").exists())
            self.assertTrue((business_output / "detecto_price_presence.csv").exists())
            self.assertTrue((business_output / "price_basis_candidates.csv").exists())
            self.assertTrue((business_output / "identifier_candidates.csv").exists())
            self.assertTrue((business_output / "uom_decision_template.csv").exists())
            self.assertTrue(run_validate(output)["valid"])

    def test_existing_human_decisions_are_preserved_and_force_required(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            review_root, dry_root, profiles_dir, raw_root, output = self.make_fixture(root)
            business_output = root / "business_review"
            generate(review_root, dry_root, profiles_dir, output, business_output, root / "manifest.csv", raw_root, root / "uom_decisions.local.csv")
            data = json.loads(output.read_text(encoding="utf-8"))
            data["profiles"][0]["selected_option"] = data["profiles"][0]["candidate_options"][0]
            data["profiles"][0]["decision_status"] = "approved"
            data["profiles"][0]["decided_by"] = "Reviewer"
            data["profiles"][0]["decided_at"] = "2026-06-24"
            output.write_text(json.dumps(data), encoding="utf-8")

            result = generate(review_root, dry_root, profiles_dir, output, business_output, root / "manifest.csv", raw_root, root / "uom_decisions.local.csv")
            self.assertFalse(result["decision_file_written"])
            result = generate(review_root, dry_root, profiles_dir, output, business_output, root / "manifest.csv", raw_root, root / "uom_decisions.local.csv", force=True)
            self.assertTrue(result["decision_file_written"])
            refreshed = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(refreshed["profiles"][0]["decision_status"], "approved")
            self.assertEqual(refreshed["profiles"][0]["decided_by"], "Reviewer")

    def test_validation_rejects_bad_states(self) -> None:
        data = {
            "status": "ready_to_apply",
            "profiles": [
                {
                    "profile_name": "p",
                    "decision_id": "p:pricing_basis",
                    "category": "pricing_basis",
                    "candidate_options": ["List Price [list_price]"],
                    "selected_option": "List Price [list_price]",
                    "decision_status": "approved",
                    "rationale": "",
                    "decided_by": "",
                    "decided_at": "",
                },
                {
                    "profile_name": "p",
                    "decision_id": "p:pricing_basis2",
                    "category": "pricing_basis",
                    "candidate_options": ["Net Price [net_price]"],
                    "selected_option": "Bad",
                    "decision_status": "pending",
                    "rationale": "",
                    "decided_by": "",
                    "decided_at": "",
                },
            ],
            "metadata_policy": {"decisions": []},
            "uom_decisions": [
                {
                    "profile_name": "p",
                    "raw_uom": "SET",
                    "classification": "ambiguous_unit",
                    "selected_normalized_uom": "",
                    "decision_status": "approved",
                    "rationale": "",
                    "decided_by": "Reviewer",
                    "decided_at": "2026-06-24",
                }
            ],
        }
        errors = validate_decisions(data)
        self.assertIn("READY_TO_APPLY_WITH_PENDING_DECISIONS", errors)
        self.assertTrue(any(error.startswith("SELECTED_OPTION_NOT_IN_CANDIDATES") for error in errors))
        self.assertTrue(any(error.startswith("APPROVED_DECISION_REQUIRES_REVIEWER_AND_DATE") for error in errors))
        self.assertTrue(any(error.startswith("AMBIGUOUS_UOM_REQUIRES_MAPPING_AND_RATIONALE") for error in errors))
        self.assertTrue(any(error.startswith("LIST_PRICE_SELECTION_REQUIRES_RATIONALE") for error in errors))
        self.assertTrue(any(error.startswith("CONFLICTING_PROFILE_CATEGORY_DECISIONS") for error in errors))

    def test_packet_answers_sync_to_candidate_options_without_approval(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            packet = root / "packet.md"
            packet.write_text(
                "\n".join(
                    [
                        "### detecto_v1:item_identifier",
                        "- Question: What canonical meaning should the primary source identifier have? UPC for now",
                        "- Candidate options: Model [model_number], UPC [gtin]",
                        "### metadata_policy:expiration_date_nullable",
                        "- Question: May expiration_date be null? yes",
                        "- Candidate options: nullable_allowed, required_before_publish, unresolved",
                    ]
                ),
                encoding="utf-8",
            )
            data = {
                "profiles": [
                    {
                        "decision_id": "detecto_v1:item_identifier",
                        "candidate_options": ["Model [model_number]", "UPC [gtin]"],
                        "selected_option": "",
                        "decision_status": "pending",
                        "rationale": "",
                    }
                ],
                "metadata_policy": {
                    "decisions": [
                        {
                            "decision_id": "metadata_policy:expiration_date_nullable",
                            "candidate_options": ["nullable_allowed", "required_before_publish", "unresolved"],
                            "selected_option": "",
                            "decision_status": "pending",
                            "rationale": "",
                        }
                    ]
                },
            }
            result = apply_packet_answers(data, packet)
            self.assertEqual(result["applied"][0]["selected_option"], "UPC [gtin]")
            self.assertEqual(result["applied"][1]["selected_option"], "nullable_allowed")
            self.assertEqual(data["profiles"][0]["decision_status"], "pending")

    def test_uom_candidates_do_not_convert_package_to_each(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            review_root, _, _, _, _ = self.make_fixture(root)
            rows = build_uom_decisions(review_root)
            lexical = next(row for row in rows if row["raw_uom"] == "EACHES")
            package = next(row for row in rows if row["raw_uom"] == "10/BOX")
            self.assertEqual(lexical["proposed_normalized_uom"], "EA")
            self.assertEqual(package["classification"], "packaging_expression")
            self.assertEqual(package["proposed_normalized_uom"], "")

    def test_aggregate_analysis_and_redaction(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            review_root, dry_root, profiles_dir, raw_root, output = self.make_fixture(root)
            business_output = root / "business_review"
            generate(review_root, dry_root, profiles_dir, output, business_output, root / "manifest.csv", raw_root, root / "uom_decisions.local.csv")

            generated = "\n".join(path.read_text(encoding="utf-8") for path in business_output.iterdir() if path.is_file())
            self.assertNotIn("$999.99", generated)
            self.assertNotIn("SENSITIVE-MODEL", generated)
            self.assertNotIn("Sensitive item description", generated)

            runs = load_review_runs(dry_root, profiles_dir)
            price_rows = build_price_basis_candidates(runs, raw_root)
            identifier_rows = build_identifier_candidates(runs, raw_root)
            self.assertTrue(any(row["candidate_role"] == "list_price" for row in price_rows))
            self.assertTrue(any(row["candidate_canonical_field"] == "model_number" for row in identifier_rows))

            with (business_output / "detecto_price_presence.csv").open(encoding="utf-8") as handle:
                presence_rows = list(csv.DictReader(handle))
            classifications = {row["row_classification"] for row in presence_rows}
            self.assertIn("selected_price_blank_alternate_present", classifications)
            self.assertIn("identifier_and_description_present_no_price", classifications)

    def test_manifest_example_is_fictional_only(self) -> None:
        path = Path("data/pricing/manifest.example.csv")
        text = path.read_text(encoding="utf-8")
        self.assertIn("Fictional Distributor", text)
        self.assertNotIn("Detecto", text)
        self.assertNotIn("Quantum", text)
        self.assertNotIn("Health Care Logistics", text)

    def test_decision_application_creates_v2_without_approval(self) -> None:
        profile = detecto_profile()
        data = {
            "profiles": [
                {
                    "profile_name": "detecto_v1",
                    "decision_id": "detecto_v1:item_identifier",
                    "category": "item_identifier",
                    "selected_option": "Model [model_number]",
                    "decided_by": "Reviewer",
                    "decided_at": "2026-06-24",
                },
                {
                    "profile_name": "detecto_v1",
                    "decision_id": "detecto_v1:price_uom",
                    "category": "price_uom",
                    "selected_option": "Stock UOM",
                    "decided_by": "Reviewer",
                    "decided_at": "2026-06-24",
                },
            ],
            "metadata_policy": {
                "decisions": [
                    {"decision_id": "metadata_policy:contract_number_required_before_publish", "selected_option": "required_before_publish"},
                    {"decision_id": "metadata_policy:effective_date_required_before_publish", "selected_option": "required_before_publish"},
                    {"decision_id": "metadata_policy:expiration_date_nullable", "selected_option": "nullable_allowed"},
                ]
            },
        }
        updated = apply_profile_decisions(profile, data)
        fields = [mapping["canonical_field"] for mapping in updated["column_mappings"]]
        self.assertEqual(updated["profile_name"], "detecto_v2")
        self.assertEqual(updated["status"], "review_required")
        self.assertEqual(updated["review_status"], "not_reviewed")
        self.assertEqual(updated["predecessor_profile"], "detecto_v1")
        self.assertIn("model_number", fields)
        self.assertNotIn("manufacturer_part_number", fields)
        self.assertIn("raw_price_uom", fields)
        self.assertEqual(updated["default_values"]["contract_number"]["required"], True)

    def test_preflight_blocks_pending_decisions(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            decisions = root / "business_decisions.local.json"
            uom = root / "uom_decisions.local.csv"
            decisions.write_text(
                json.dumps(
                    {
                        "status": "ready_to_apply",
                        "profiles": [
                            {
                                "profile_name": "p",
                                "decision_id": "p:pricing_basis",
                                "category": "pricing_basis",
                                "candidate_options": ["Price [unknown]"],
                                "selected_option": "",
                                "decision_status": "pending",
                                "rationale": "",
                                "decided_by": "",
                                "decided_at": "",
                            }
                        ],
                        "metadata_policy": {"decisions": []},
                        "uom_decisions": [],
                    }
                ),
                encoding="utf-8",
            )
            write_csv(
                uom,
                ["profile_name", "raw_uom", "normalized_token", "occurrence_count", "classification", "proposed_normalized_uom", "selected_normalized_uom", "decision_status", "rationale", "decided_by", "decided_at"],
                [],
            )
            self.assertFalse(preflight(decisions, uom)["passed"])


if __name__ == "__main__":
    unittest.main()
