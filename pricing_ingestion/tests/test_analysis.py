from __future__ import annotations

import csv
import json
import tempfile
import unittest
from pathlib import Path

from pricing_ingestion.discovery.analyze import (
    build_header_synonyms,
    cluster_template_families,
    load_workbook_analyses,
    run_analysis,
)


class DiscoveryAnalysisTests(unittest.TestCase):
    def write_csv(self, path: Path, fieldnames: list[str], rows: list[dict[str, object]]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(rows)

    def write_profile(
        self,
        output_dir: Path,
        file_name: str,
        sheet_name: str,
        headers: list[str],
        *,
        extension: str = ".xlsx",
        risks: list[str] | None = None,
        sheet_risks: list[str] | None = None,
        candidate_count: int = 1,
        sample_price: str = "12.34",
    ) -> None:
        profile = {
            "file_name": file_name,
            "file_hash": "synthetic",
            "file_size": 10,
            "workbook_extension": extension,
            "manifest_metadata": None,
            "sheet_names": [sheet_name] if extension != ".xls" else [],
            "hidden_sheets": [],
            "risk_flags": risks or [],
            "candidate_pricing_sheets": [
                {"sheet_name": sheet_name, "score": 12, "reasons": ["synthetic"]}
            ][:candidate_count],
            "sheets": [] if extension == ".xls" else [
                {
                    "name": sheet_name,
                    "state": "visible",
                    "dimensions": {"max_row": 4, "max_column": len(headers)},
                    "used_range": {"range": "A1:E4"},
                    "merged_cell_ranges": [],
                    "formula_count": 1 if sheet_risks and "contains_formulas" in sheet_risks else 0,
                    "hidden_row_count": 0,
                    "hidden_column_count": 0,
                    "candidate_pricing_sheet_score": 12,
                    "candidate_pricing_sheet_reasons": ["synthetic"],
                    "detected_header_labels": headers,
                    "candidate_header_rows": [
                        {
                            "sheet_name": sheet_name,
                            "row_index": 1,
                            "score": 12,
                            "non_empty_count": len(headers),
                            "matched_categories": [
                                "distributor_sku",
                                "description",
                                "uom",
                                "price",
                            ],
                            "labels": headers,
                        }
                    ],
                    "likely_distributor_sku_columns": [
                        {"column_index": 1, "column_letter": "A", "header": headers[0], "confidence": 1.0, "matched_term": "sku"}
                    ],
                    "likely_manufacturer_part_number_columns": [],
                    "likely_description_columns": [
                        {"column_index": 2, "column_letter": "B", "header": headers[1], "confidence": 1.0, "matched_term": "description"}
                    ],
                    "likely_uom_columns": [
                        {"column_index": 3, "column_letter": "C", "header": headers[2], "confidence": 1.0, "matched_term": "uom"}
                    ],
                    "likely_price_columns": [
                        {"column_index": 4, "column_letter": "D", "header": headers[3], "confidence": 1.0, "matched_term": "price"}
                    ],
                    "likely_effective_date_columns": [],
                    "likely_expiration_date_columns": [],
                    "sample_rows": [
                        {"row_index": 2, "values": {"A": "SKU-001", "D": sample_price}}
                    ],
                    "risk_flags": sheet_risks or [],
                }
            ],
        }
        safe_name = file_name.replace(" ", "_")
        (output_dir / "profiles").mkdir(parents=True, exist_ok=True)
        (output_dir / "profiles" / f"{safe_name}.pricing_discovery.json").write_text(
            json.dumps(profile),
            encoding="utf-8",
        )

    def create_synthetic_discovery_output(self, output_dir: Path) -> None:
        workbooks = [
            {
                "file_name": "Acme Price List.xlsx",
                "file_hash": "1",
                "file_size": "10",
                "workbook_extension": ".xlsx",
                "sheet_count": "1",
                "hidden_sheet_count": "0",
                "candidate_pricing_sheet_count": "1",
                "risk_flags": "",
            },
            {
                "file_name": "Acme Category Price List.xlsx",
                "file_hash": "2",
                "file_size": "10",
                "workbook_extension": ".xlsx",
                "sheet_count": "2",
                "hidden_sheet_count": "0",
                "candidate_pricing_sheet_count": "1",
                "risk_flags": "contains_merged_cells",
            },
            {
                "file_name": "Beta Dealer Pricing.xlsx",
                "file_hash": "3",
                "file_size": "10",
                "workbook_extension": ".xlsx",
                "sheet_count": "1",
                "hidden_sheet_count": "0",
                "candidate_pricing_sheet_count": "1",
                "risk_flags": "",
            },
            {
                "file_name": "Legacy Vendor Pricing.xls",
                "file_hash": "4",
                "file_size": "10",
                "workbook_extension": ".xls",
                "sheet_count": "0",
                "hidden_sheet_count": "0",
                "candidate_pricing_sheet_count": "0",
                "risk_flags": "xls_not_supported_without_xlrd_adapter",
            },
        ]
        self.write_csv(
            output_dir / "workbook_inventory.csv",
            [
                "file_name",
                "file_hash",
                "file_size",
                "workbook_extension",
                "sheet_count",
                "hidden_sheet_count",
                "candidate_pricing_sheet_count",
                "risk_flags",
            ],
            workbooks,
        )
        self.write_csv(
            output_dir / "sheet_inventory.csv",
            [
                "file_name",
                "sheet_name",
                "state",
                "max_row",
                "max_column",
                "used_range",
                "merged_cell_range_count",
                "formula_count",
                "hidden_row_count",
                "hidden_column_count",
                "candidate_pricing_sheet_score",
                "risk_flags",
            ],
            [
                {
                    "file_name": "Acme Price List.xlsx",
                    "sheet_name": "Pricing",
                    "state": "visible",
                    "max_row": "4",
                    "max_column": "4",
                    "used_range": "A1:D4",
                    "merged_cell_range_count": "0",
                    "formula_count": "0",
                    "hidden_row_count": "0",
                    "hidden_column_count": "0",
                    "candidate_pricing_sheet_score": "12",
                    "risk_flags": "",
                },
                {
                    "file_name": "Acme Category Price List.xlsx",
                    "sheet_name": "Pricing",
                    "state": "visible",
                    "max_row": "4",
                    "max_column": "4",
                    "used_range": "A1:D4",
                    "merged_cell_range_count": "1",
                    "formula_count": "0",
                    "hidden_row_count": "0",
                    "hidden_column_count": "0",
                    "candidate_pricing_sheet_score": "12",
                    "risk_flags": "contains_merged_cells",
                },
                {
                    "file_name": "Beta Dealer Pricing.xlsx",
                    "sheet_name": "Products",
                    "state": "visible",
                    "max_row": "4",
                    "max_column": "4",
                    "used_range": "A1:D4",
                    "merged_cell_range_count": "0",
                    "formula_count": "0",
                    "hidden_row_count": "0",
                    "hidden_column_count": "0",
                    "candidate_pricing_sheet_score": "12",
                    "risk_flags": "",
                },
            ],
        )
        self.write_csv(
            output_dir / "candidate_headers.csv",
            ["file_name", "sheet_name", "row_index", "score", "non_empty_count", "matched_categories", "labels"],
            [],
        )
        (output_dir / "discovery_summary.md").write_text(
            "# Pricing Discovery Summary\n\n- Workbooks profiled: 4\n- Sheets profiled: 3\n- Candidate pricing sheets: 3\n- Workbooks with risk flags: 2\n",
            encoding="utf-8",
        )
        (output_dir / "risk_report.md").write_text("# Risk Report\n", encoding="utf-8")
        self.write_profile(output_dir, "Acme Price List.xlsx", "Pricing", ["SKU", "Description", "UOM", "Net Price"])
        self.write_profile(output_dir, "Acme Category Price List.xlsx", "Pricing", ["SKU", "Description", "UOM", "Net Price"], risks=["contains_merged_cells"], sheet_risks=["contains_merged_cells"])
        self.write_profile(output_dir, "Beta Dealer Pricing.xlsx", "Products", ["Item #", "Item Description", "Unit", "Dealer Price"])
        self.write_profile(
            output_dir,
            "Legacy Vendor Pricing.xls",
            "",
            [],
            extension=".xls",
            risks=["xls_not_supported_without_xlrd_adapter"],
            candidate_count=0,
        )

    def test_clusters_template_families_and_counts_risks(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir)
            self.create_synthetic_discovery_output(output_dir)

            workbooks = load_workbook_analyses(output_dir)
            families = cluster_template_families(workbooks)

            self.assertEqual(len(workbooks), 4)
            self.assertGreaterEqual(len(families), 3)
            self.assertTrue(any(len(family.workbooks) == 2 for family in families))
            self.assertTrue(any(family.complexity == "high" for family in families))

    def test_header_synonyms_are_conservative(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir)
            self.create_synthetic_discovery_output(output_dir)

            families = cluster_template_families(load_workbook_analyses(output_dir))
            synonyms = build_header_synonyms(families)
            by_header = {row["observed_header"]: row for row in synonyms}

            self.assertEqual(by_header["SKU"]["suggested_canonical_field"], "distributor_sku")
            self.assertEqual(by_header["Net Price"]["suggested_canonical_field"], "price")
            self.assertEqual(by_header["Unit"]["suggested_canonical_field"], "raw_uom")

    def test_analysis_outputs_backlog_xls_gap_and_no_raw_price_values(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir)
            self.create_synthetic_discovery_output(output_dir)

            result = run_analysis(output_dir, output_dir)

            self.assertEqual(result["workbooks_analyzed"], 4)
            self.assertTrue((output_dir / "template_families.csv").exists())
            self.assertTrue((output_dir / "header_synonyms.csv").exists())
            self.assertTrue((output_dir / "recommended_profile_backlog.csv").exists())
            self.assertTrue((output_dir / "discovery_analysis.md").exists())
            self.assertTrue((output_dir / "profile_build_plan.md").exists())

            with (output_dir / "recommended_profile_backlog.csv").open(encoding="utf-8") as handle:
                backlog = list(csv.DictReader(handle))
            self.assertEqual(backlog[0]["status"], "recommended_now")
            self.assertTrue(any(row["status"] == "blocked_adapter_gap" for row in backlog))

            generated_text = "\n".join(
                path.read_text(encoding="utf-8")
                for path in [
                    output_dir / "template_families.csv",
                    output_dir / "header_synonyms.csv",
                    output_dir / "recommended_profile_backlog.csv",
                    output_dir / "discovery_analysis.md",
                    output_dir / "profile_build_plan.md",
                ]
            )
            self.assertNotIn("12.34", generated_text)


if __name__ == "__main__":
    unittest.main()
