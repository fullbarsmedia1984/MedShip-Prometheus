from __future__ import annotations

import csv
import json
import tempfile
import unittest
from pathlib import Path

from pricing_ingestion.review.exceptions import classify_uom, run_review
from pricing_ingestion.tests.test_profiles import valid_profile


class ExceptionReviewTests(unittest.TestCase):
    def write_csv(self, path: Path, fieldnames: list[str], rows: list[dict[str, object]]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(rows)

    def test_uom_classification(self) -> None:
        self.assertEqual(classify_uom("EACHES")[3], "known_alias")
        self.assertEqual(classify_uom("10/BOX")[3], "packaging_expression")
        self.assertEqual(classify_uom("12 IN")[3], "dimensional_unit")
        self.assertEqual(classify_uom("SET")[3], "ambiguous_unit")
        self.assertEqual(classify_uom("")[3], "missing_value")

    def test_review_outputs_are_aggregate_and_safe(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            dry_root = root / "dry_runs"
            run_dir = dry_root / "synthetic_run"
            profiles_dir = root / "profiles"
            output_dir = root / "review"
            run_dir.mkdir(parents=True)
            profiles_dir.mkdir()

            profile = valid_profile()
            profile["applicable_family_ids"] = ["FTEST"]
            (profiles_dir / "synthetic_v1.json").write_text(json.dumps(profile), encoding="utf-8")
            (run_dir / "dry_run_summary.json").write_text(
                json.dumps(
                    {
                        "rows_scanned": 2,
                        "proposed_rows": 2,
                        "valid_rows": 1,
                        "warning_rows": 1,
                        "blocking_exception_rows": 0,
                        "formula_derived_rows": 0,
                        "exception_counts": {"UNKNOWN_UOM": 1},
                    }
                ),
                encoding="utf-8",
            )
            self.write_csv(
                run_dir / "proposed_rows.csv",
                ["profile_name", "source_file", "raw_uom"],
                [
                    {"profile_name": "synthetic_v1", "source_file": "Synthetic.xlsx", "raw_uom": "EACHES"},
                    {"profile_name": "synthetic_v1", "source_file": "Synthetic.xlsx", "raw_uom": "10/BOX"},
                ],
            )
            self.write_csv(
                run_dir / "exceptions.csv",
                ["exception_code", "severity"],
                [{"exception_code": "UNKNOWN_UOM", "severity": "warning"}],
            )
            self.write_csv(run_dir / "excluded_rows.csv", ["source_file", "source_sheet", "source_row", "reason", "message"], [])

            result = run_review(dry_root, output_dir, profiles_dir, None)

            self.assertEqual(result["runs_reviewed"], 1)
            self.assertTrue((output_dir / "uom_review.csv").exists())
            self.assertTrue((output_dir / "profile_decision_matrix.csv").exists())
            self.assertTrue((output_dir / "profile_readiness.md").exists())

            generated = "\n".join(path.read_text(encoding="utf-8") for path in output_dir.iterdir())
            self.assertNotIn("$10.00", generated)
            self.assertNotIn("SKU-001", generated)
            self.assertNotIn("Synthetic item", generated)


if __name__ == "__main__":
    unittest.main()
