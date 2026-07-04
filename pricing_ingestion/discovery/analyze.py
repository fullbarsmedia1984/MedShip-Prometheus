from __future__ import annotations

import argparse
import csv
import json
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


TEMPLATE_FAMILY_FIELDS = [
    "family_id",
    "workbook_count",
    "representative_files",
    "likely_distributor_names",
    "common_sheet_names",
    "common_header_terms",
    "common_price_header_terms",
    "common_uom_header_terms",
    "common_identifier_header_terms",
    "risk_count",
    "dominant_risks",
    "likely_required_profile_complexity",
    "recommended_priority",
    "notes",
]

HEADER_SYNONYM_FIELDS = [
    "observed_header",
    "normalized_observed_header",
    "suggested_canonical_field",
    "confidence",
    "source_family_ids",
    "occurrence_count",
    "notes",
]

BACKLOG_FIELDS = [
    "priority_rank",
    "family_id",
    "representative_files",
    "likely_distributor_names",
    "workbook_count",
    "likely_profile_name",
    "complexity",
    "reasons_to_build_now",
    "blockers",
    "required_manual_review",
    "recommended_next_action",
    "status",
]

HIGH_COMPLEXITY_RISKS = {
    "contains_formulas",
    "no_candidate_header_row",
    "no_candidate_pricing_sheet",
    "sheet_hidden",
    "contains_hidden_sheets",
    "xls_not_supported_without_xlrd_adapter",
    "unsupported_workbook_extension",
    "openpyxl_not_installed",
}

MEDIUM_COMPLEXITY_RISKS = {
    "contains_merged_cells",
    "contains_hidden_columns",
    "contains_hidden_rows",
    "multiple_candidate_pricing_sheets",
}


CANONICAL_PATTERNS: dict[str, list[str]] = {
    "distributor_sku": [
        "distributor sku",
        "distributor item",
        "vendor sku",
        "vendor item",
        "vendor part",
        "item number",
        "item no",
        "item #",
        "sku",
        "catalog number",
        "catalog no",
        "product code",
    ],
    "manufacturer_name": [
        "manufacturer",
        "mfr",
        "mfg",
        "brand",
    ],
    "manufacturer_part_number": [
        "manufacturer part number",
        "manufacturer part",
        "manufacturer item",
        "mfr part",
        "mfg part",
        "mpn",
        "model number",
        "model no",
    ],
    "item_description_raw": [
        "description",
        "product description",
        "item description",
        "item name",
        "product name",
        "title",
    ],
    "raw_uom": [
        "uom",
        "unit of measure",
        "unit",
        "units",
        "sell uom",
        "sell unit",
        "selling unit",
    ],
    "pack_size": [
        "pack",
        "pack size",
        "case pack",
        "qty per",
        "quantity per",
    ],
    "price": [
        "price",
        "contract price",
        "net price",
        "dealer price",
        "distributor price",
        "cost",
        "list price",
        "msrp",
        "your price",
    ],
    "effective_date": [
        "effective date",
        "start date",
        "valid from",
        "price effective",
        "eff date",
    ],
    "expiration_date": [
        "expiration date",
        "expiry date",
        "end date",
        "valid through",
        "valid until",
        "expires",
    ],
    "contract_number": [
        "contract number",
        "contract no",
        "contract #",
        "agreement number",
        "agreement no",
    ],
    "account_number": [
        "account number",
        "account no",
        "account #",
        "customer number",
        "customer no",
    ],
    "tier": [
        "tier",
        "price tier",
        "level",
        "discount level",
    ],
}

AMBIGUOUS_NORMALIZED_HEADERS = {
    "item",
    "number",
    "part",
    "code",
    "id",
    "type",
    "category",
    "class",
}


@dataclass
class WorkbookAnalysis:
    file_name: str
    workbook_extension: str
    sheet_names: list[str]
    candidate_pricing_sheet_count: int
    risk_flags: set[str] = field(default_factory=set)
    sheet_risk_flags: set[str] = field(default_factory=set)
    observed_headers: set[str] = field(default_factory=set)
    price_headers: set[str] = field(default_factory=set)
    uom_headers: set[str] = field(default_factory=set)
    identifier_headers: set[str] = field(default_factory=set)
    detected_categories: set[str] = field(default_factory=set)

    @property
    def all_risks(self) -> set[str]:
        return set(self.risk_flags) | set(self.sheet_risk_flags)

    @property
    def likely_distributor_name(self) -> str:
        return infer_distributor_name(self.file_name)


@dataclass
class TemplateFamily:
    family_id: str
    workbooks: list[WorkbookAnalysis]
    signature: tuple[Any, ...]
    complexity: str
    priority_score: tuple[int, int, int, str]


def normalize_header(value: Any) -> str:
    text = "" if value is None else str(value)
    text = text.replace("\n", " ").replace("\r", " ")
    text = re.sub(r"[_\-/#:]+", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip().lower()


def split_semicolon(value: str | None) -> list[str]:
    if not value:
        return []
    return [part.strip() for part in value.split(";") if part.strip()]


def split_pipe(value: str | None) -> list[str]:
    if not value:
        return []
    return [part.strip() for part in value.split("|") if part.strip()]


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


def load_profile(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def is_sensitive_value_like(value: str) -> bool:
    normalized = value.strip()
    if not normalized:
        return True
    if re.fullmatch(r"[$€£]?\s*\d+(?:[.,]\d+)?\s*%?", normalized):
        return True
    if re.fullmatch(r"\d{1,2}[/-]\d{1,2}[/-]\d{2,4}", normalized):
        return True
    if normalized == "<redacted_price_value>":
        return True
    return False


def safe_header(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text or is_sensitive_value_like(text):
        return None
    return text


def infer_distributor_name(file_name: str) -> str:
    stem = Path(file_name).stem
    cleaned = re.sub(r"[_]+", " ", stem)
    cleaned = re.sub(r"\b(20\d{2}|19\d{2})[A-Z]?\b", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\b(price|pricing|price list|file|contract|dealer|distributor|customer|medical shipment|llc|updated|final|effective|eff)\b", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\b\d{1,2}[.-]\d{1,2}[.-]\d{2,4}\b", "", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" -_")
    return cleaned or stem


def suggest_canonical_field(observed_header: str) -> tuple[str, str, str]:
    normalized = normalize_header(observed_header)
    if normalized in AMBIGUOUS_NORMALIZED_HEADERS:
        return "", "low", "Ambiguous generic header; requires manual review."

    matches: list[tuple[str, str, bool]] = []
    for field_name, patterns in CANONICAL_PATTERNS.items():
        for pattern in patterns:
            normalized_pattern = normalize_header(pattern)
            if normalized == normalized_pattern:
                matches.append((field_name, pattern, True))
            elif normalized_pattern and normalized_pattern in normalized:
                matches.append((field_name, pattern, False))

    if not matches:
        return "", "low", "No deterministic canonical mapping suggested."

    exact_fields = sorted({field for field, _pattern, exact in matches if exact})
    fuzzy_fields = sorted({field for field, _pattern, exact in matches if not exact})
    candidate_fields = exact_fields or fuzzy_fields

    if len(candidate_fields) > 1:
        return "", "low", f"Ambiguous between: {', '.join(candidate_fields)}."

    confidence = "high" if exact_fields else "medium"
    return candidate_fields[0], confidence, ""


def common_values(values: list[str], limit: int = 8) -> str:
    counter = Counter(value for value in values if value)
    return "; ".join(value for value, _count in counter.most_common(limit))


def profile_header_values(profile: dict[str, Any], sheet_name: str | None = None) -> dict[str, set[str]]:
    values = {
        "observed": set(),
        "price": set(),
        "uom": set(),
        "identifier": set(),
        "categories": set(),
    }

    for sheet in profile.get("sheets", []):
        if sheet_name and sheet.get("name") != sheet_name:
            continue

        for label in sheet.get("detected_header_labels", []):
            header = safe_header(label)
            if header:
                values["observed"].add(header)

        for candidate in sheet.get("candidate_header_rows", []):
            for label in candidate.get("labels", []):
                header = safe_header(label)
                if header:
                    values["observed"].add(header)
            for category in candidate.get("matched_categories", []):
                if category:
                    values["categories"].add(str(category))

        for candidate in sheet.get("likely_price_columns", []):
            header = safe_header(candidate.get("header"))
            if header:
                values["price"].add(header)
                values["observed"].add(header)
                values["categories"].add("price")

        for candidate in sheet.get("likely_uom_columns", []):
            header = safe_header(candidate.get("header"))
            if header:
                values["uom"].add(header)
                values["observed"].add(header)
                values["categories"].add("uom")

        identifier_groups = [
            "likely_distributor_sku_columns",
            "likely_manufacturer_part_number_columns",
        ]
        for group in identifier_groups:
            for candidate in sheet.get(group, []):
                header = safe_header(candidate.get("header"))
                if header:
                    values["identifier"].add(header)
                    values["observed"].add(header)
                    values["categories"].add(
                        "manufacturer_part_number"
                        if group == "likely_manufacturer_part_number_columns"
                        else "distributor_sku"
                    )

        for group, category in [
            ("likely_description_columns", "description"),
            ("likely_effective_date_columns", "effective_date"),
            ("likely_expiration_date_columns", "expiration_date"),
        ]:
            for candidate in sheet.get(group, []):
                header = safe_header(candidate.get("header"))
                if header:
                    values["observed"].add(header)
                    values["categories"].add(category)

    return values


def load_workbook_analyses(input_dir: Path) -> list[WorkbookAnalysis]:
    workbook_rows = {row.get("file_name", ""): row for row in read_csv(input_dir / "workbook_inventory.csv")}
    sheet_rows = read_csv(input_dir / "sheet_inventory.csv")
    sheet_risks_by_file: dict[str, set[str]] = defaultdict(set)
    sheet_names_by_file: dict[str, list[str]] = defaultdict(list)

    for row in sheet_rows:
        file_name = row.get("file_name", "")
        sheet_name = row.get("sheet_name", "")
        if sheet_name:
            sheet_names_by_file[file_name].append(sheet_name)
        sheet_risks_by_file[file_name].update(split_semicolon(row.get("risk_flags")))

    profiles_dir = input_dir / "profiles"
    analyses: list[WorkbookAnalysis] = []
    for profile_path in sorted(profiles_dir.glob("*.pricing_discovery.json")):
        profile = load_profile(profile_path)
        file_name = str(profile.get("file_name") or profile_path.name)
        inventory_row = workbook_rows.get(file_name, {})
        header_values = profile_header_values(profile)
        analyses.append(
            WorkbookAnalysis(
                file_name=file_name,
                workbook_extension=str(profile.get("workbook_extension") or inventory_row.get("workbook_extension") or "").lower(),
                sheet_names=[str(value) for value in profile.get("sheet_names", [])] or sheet_names_by_file.get(file_name, []),
                candidate_pricing_sheet_count=int(inventory_row.get("candidate_pricing_sheet_count") or len(profile.get("candidate_pricing_sheets", [])) or 0),
                risk_flags=set(split_semicolon(inventory_row.get("risk_flags"))) | set(profile.get("risk_flags", [])),
                sheet_risk_flags=sheet_risks_by_file.get(file_name, set()),
                observed_headers=header_values["observed"],
                price_headers=header_values["price"],
                uom_headers=header_values["uom"],
                identifier_headers=header_values["identifier"],
                detected_categories=header_values["categories"],
            )
        )

    for file_name, row in workbook_rows.items():
        if any(analysis.file_name == file_name for analysis in analyses):
            continue
        analyses.append(
            WorkbookAnalysis(
                file_name=file_name,
                workbook_extension=str(row.get("workbook_extension") or "").lower(),
                sheet_names=sheet_names_by_file.get(file_name, []),
                candidate_pricing_sheet_count=int(row.get("candidate_pricing_sheet_count") or 0),
                risk_flags=set(split_semicolon(row.get("risk_flags"))),
                sheet_risk_flags=sheet_risks_by_file.get(file_name, set()),
            )
        )

    return sorted(analyses, key=lambda analysis: analysis.file_name.lower())


def family_signature(workbook: WorkbookAnalysis) -> tuple[Any, ...]:
    if workbook.workbook_extension == ".xls":
        return ("adapter_gap", ".xls")

    category_signature = tuple(sorted(workbook.detected_categories))
    price_signature = tuple(sorted(normalize_header(header) for header in workbook.price_headers))
    uom_signature = tuple(sorted(normalize_header(header) for header in workbook.uom_headers))
    identifier_signature = tuple(sorted(normalize_header(header) for header in workbook.identifier_headers))
    sheet_shape = (
        "multi_sheet" if len(workbook.sheet_names) > 1 else "single_sheet",
        "multi_pricing" if workbook.candidate_pricing_sheet_count > 1 else "single_pricing",
    )

    if not category_signature and not price_signature:
        return ("unclear_headers", sheet_shape, tuple(sorted(workbook.all_risks)))

    return (
        "headers",
        category_signature,
        price_signature,
        uom_signature,
        identifier_signature,
        sheet_shape,
    )


def assess_complexity(workbooks: list[WorkbookAnalysis]) -> str:
    risks = set().union(*(workbook.all_risks for workbook in workbooks)) if workbooks else set()
    candidate_counts = [workbook.candidate_pricing_sheet_count for workbook in workbooks]
    has_required_headers = any(
        workbook.price_headers and workbook.uom_headers and workbook.identifier_headers
        for workbook in workbooks
    )

    if "xls_not_supported_without_xlrd_adapter" in risks:
        return "high"
    if risks & HIGH_COMPLEXITY_RISKS:
        return "high"
    if not has_required_headers:
        return "high"
    if risks & MEDIUM_COMPLEXITY_RISKS or any(count > 1 for count in candidate_counts):
        return "medium"
    return "low"


def family_priority_score(family: TemplateFamily) -> tuple[int, int, int, str]:
    complexity_rank = {"low": 0, "medium": 1, "high": 2}[family.complexity]
    risk_count = sum(len(workbook.all_risks) for workbook in family.workbooks)
    return (complexity_rank, -len(family.workbooks), risk_count, family.family_id)


def cluster_template_families(workbooks: list[WorkbookAnalysis]) -> list[TemplateFamily]:
    groups: dict[tuple[Any, ...], list[WorkbookAnalysis]] = defaultdict(list)
    for workbook in workbooks:
        groups[family_signature(workbook)].append(workbook)

    ordered_groups = sorted(
        groups.items(),
        key=lambda item: (-len(item[1]), assess_complexity(item[1]), str(item[0])),
    )
    families: list[TemplateFamily] = []
    for index, (signature, grouped_workbooks) in enumerate(ordered_groups, start=1):
        complexity = assess_complexity(grouped_workbooks)
        family = TemplateFamily(
            family_id=f"F{index:03d}",
            workbooks=sorted(grouped_workbooks, key=lambda workbook: workbook.file_name.lower()),
            signature=signature,
            complexity=complexity,
            priority_score=(0, 0, 0, ""),
        )
        family.priority_score = family_priority_score(family)
        families.append(family)

    priority_sorted = sorted(families, key=lambda family: family.priority_score)
    for rank, family in enumerate(priority_sorted, start=1):
        family.priority_score = (*family.priority_score[:3], f"{rank:03d}")
    return families


def risk_counter(workbooks: list[WorkbookAnalysis]) -> Counter[str]:
    counter: Counter[str] = Counter()
    for workbook in workbooks:
        counter.update(workbook.all_risks)
    return counter


def family_to_row(family: TemplateFamily, priority_lookup: dict[str, int]) -> dict[str, Any]:
    workbooks = family.workbooks
    risks = risk_counter(workbooks)
    representative_files = "; ".join(workbook.file_name for workbook in workbooks[:3])
    distributors = common_values([workbook.likely_distributor_name for workbook in workbooks], limit=5)
    sheet_names = common_values([sheet for workbook in workbooks for sheet in workbook.sheet_names], limit=10)
    headers = common_values([header for workbook in workbooks for header in workbook.observed_headers], limit=12)
    price_headers = common_values([header for workbook in workbooks for header in workbook.price_headers], limit=8)
    uom_headers = common_values([header for workbook in workbooks for header in workbook.uom_headers], limit=8)
    identifier_headers = common_values([header for workbook in workbooks for header in workbook.identifier_headers], limit=8)
    notes = []
    if family.complexity == "high":
        notes.append("Requires manual review before profile build.")
    if any(workbook.workbook_extension == ".xls" for workbook in workbooks):
        notes.append("Legacy .xls adapter decision required.")
    if any(workbook.candidate_pricing_sheet_count > 1 for workbook in workbooks):
        notes.append("Sheet/category selection rules likely needed.")
    return {
        "family_id": family.family_id,
        "workbook_count": len(workbooks),
        "representative_files": representative_files,
        "likely_distributor_names": distributors,
        "common_sheet_names": sheet_names,
        "common_header_terms": headers,
        "common_price_header_terms": price_headers,
        "common_uom_header_terms": uom_headers,
        "common_identifier_header_terms": identifier_headers,
        "risk_count": sum(risks.values()),
        "dominant_risks": "; ".join(f"{risk}:{count}" for risk, count in risks.most_common(8)),
        "likely_required_profile_complexity": family.complexity,
        "recommended_priority": priority_lookup[family.family_id],
        "notes": " ".join(notes),
    }


def build_header_synonyms(families: list[TemplateFamily]) -> list[dict[str, Any]]:
    family_ids_by_header: dict[str, set[str]] = defaultdict(set)
    exact_header_by_normalized: dict[str, Counter[str]] = defaultdict(Counter)

    for family in families:
        for workbook in family.workbooks:
            for header in workbook.observed_headers:
                normalized = normalize_header(header)
                if not normalized:
                    continue
                family_ids_by_header[normalized].add(family.family_id)
                exact_header_by_normalized[normalized][header] += 1

    rows: list[dict[str, Any]] = []
    for normalized, header_counter in sorted(exact_header_by_normalized.items()):
        observed_header, occurrence_count = header_counter.most_common(1)[0]
        canonical_field, confidence, notes = suggest_canonical_field(observed_header)
        rows.append(
            {
                "observed_header": observed_header,
                "normalized_observed_header": normalized,
                "suggested_canonical_field": canonical_field,
                "confidence": confidence,
                "source_family_ids": "; ".join(sorted(family_ids_by_header[normalized])),
                "occurrence_count": sum(header_counter.values()),
                "notes": notes,
            }
        )
    return rows


def build_backlog(families: list[TemplateFamily]) -> list[dict[str, Any]]:
    priority_families = sorted(families, key=lambda family: family.priority_score)
    rows: list[dict[str, Any]] = []
    for rank, family in enumerate(priority_families, start=1):
        workbooks = family.workbooks
        risks = risk_counter(workbooks)
        adapter_gap = any(workbook.workbook_extension == ".xls" for workbook in workbooks)
        blockers = []
        manual_review = []
        if adapter_gap:
            blockers.append("Unsupported .xls format")
            manual_review.append("Decide whether to build xlrd-backed .xls profiling adapter")
        if "contains_formulas" in risks:
            manual_review.append("Confirm formula-derived values and source columns")
        if "multiple_candidate_pricing_sheets" in risks or any(workbook.candidate_pricing_sheet_count > 1 for workbook in workbooks):
            manual_review.append("Confirm which sheets/tabs are in scope")
        if "no_candidate_header_row" in risks or "no_candidate_pricing_sheet" in risks:
            blockers.append("Unclear pricing/header structure")

        immediate = rank <= 3 and family.complexity != "high" and not adapter_gap
        reasons = [
            f"Covers {len(workbooks)} workbook(s)",
            f"{family.complexity} complexity",
        ]
        if family.complexity in {"low", "medium"}:
            reasons.append("Deterministic headers are available")

        profile_name = re.sub(r"[^a-z0-9]+", "_", common_values([workbook.likely_distributor_name for workbook in workbooks], limit=1).lower()).strip("_")
        if not profile_name:
            profile_name = family.family_id.lower()

        rows.append(
            {
                "priority_rank": rank,
                "family_id": family.family_id,
                "representative_files": "; ".join(workbook.file_name for workbook in workbooks[:3]),
                "likely_distributor_names": common_values([workbook.likely_distributor_name for workbook in workbooks], limit=5),
                "workbook_count": len(workbooks),
                "likely_profile_name": f"{profile_name}_profile",
                "complexity": family.complexity,
                "reasons_to_build_now": "; ".join(reasons),
                "blockers": "; ".join(blockers),
                "required_manual_review": "; ".join(manual_review),
                "recommended_next_action": "Build profile now" if immediate else ("Adapter decision" if adapter_gap else "Review after first three profiles"),
                "status": "recommended_now" if immediate else ("blocked_adapter_gap" if adapter_gap else "backlog"),
            }
        )
    return rows


def parse_summary_value(summary_text: str, label: str) -> int | None:
    match = re.search(rf"{re.escape(label)}:\s*(\d+)", summary_text)
    if not match:
        return None
    return int(match.group(1))


def build_discovery_analysis_markdown(
    workbooks: list[WorkbookAnalysis],
    families: list[TemplateFamily],
    backlog: list[dict[str, Any]],
    input_dir: Path,
) -> str:
    summary_path = input_dir / "discovery_summary.md"
    summary_text = summary_path.read_text(encoding="utf-8") if summary_path.exists() else ""
    total_workbooks = len(workbooks)
    total_sheets = parse_summary_value(summary_text, "Sheets profiled") or 0
    likely_pricing_sheets = sum(workbook.candidate_pricing_sheet_count for workbook in workbooks)
    no_pricing_files = sum(1 for workbook in workbooks if workbook.candidate_pricing_sheet_count == 0)
    high_risk_files = sum(1 for workbook in workbooks if workbook.all_risks)
    straightforward_files = sum(
        1
        for workbook in workbooks
        if workbook.candidate_pricing_sheet_count == 1
        and not workbook.all_risks
        and workbook.price_headers
        and workbook.uom_headers
        and workbook.identifier_headers
    )
    unsupported_xls = sum(1 for workbook in workbooks if workbook.workbook_extension == ".xls")
    common_risks = risk_counter(workbooks)
    recommended = [row for row in backlog if row["status"] == "recommended_now"][:3]

    lines = [
        "# Contract Pricing Discovery Analysis",
        "",
        "## Executive Summary",
        "",
        f"- Total workbooks analyzed: {total_workbooks}",
        f"- Total sheets analyzed: {total_sheets}",
        f"- Total likely pricing sheets: {likely_pricing_sheets}",
        f"- Files with no likely pricing sheet: {no_pricing_files}",
        f"- High-risk file count: {high_risk_files}",
        f"- Straightforward file count: {straightforward_files}",
        f"- Unsupported .xls count: {unsupported_xls}",
        "- Unsupported non-Excel file count: not available in deterministic discovery outputs",
        f"- Template families found: {len(families)}",
        "",
        "## Top Common Risk Categories",
        "",
    ]
    if common_risks:
        lines.extend(f"- {risk}: {count}" for risk, count in common_risks.most_common(10))
    else:
        lines.append("- No structural risks detected.")

    lines.extend(
        [
            "",
            "## Recommended Next Implementation Phase",
            "",
            "Build the first three deterministic distributor profile families from `recommended_profile_backlog.csv`, then use the results to harden the profile schema before taking on high-risk formula-heavy or unsupported legacy workbooks.",
            "",
            "Recommended now:",
        ]
    )
    if recommended:
        lines.extend(
            f"- {row['family_id']}: {row['likely_distributor_names']} ({row['complexity']})"
            for row in recommended
        )
    else:
        lines.append("- No low/medium-complexity family is ready without manual review.")

    lines.extend(
        [
            "",
            "## Discovery Limitations",
            "",
            "- The analyzer reads structural discovery metadata only; it does not read raw spreadsheets.",
            "- Vendor/distributor names are inferred from file names and should be confirmed manually.",
            "- Workbooks may use separate tabs for product categories, so sheet selection rules must be profile-specific.",
            "- Header synonym suggestions are deterministic and conservative; ambiguous headers remain unmapped.",
            "- Legacy `.xls` files require an adapter decision before profiling can inspect sheets.",
            "- Non-Excel unsupported files are not counted unless a future raw-file inventory output is added.",
            "- Price-like values are excluded; generated reports use headers, counts, risks, and family structure only.",
        ]
    )
    return "\n".join(lines) + "\n"


def build_profile_build_plan_markdown(
    families: list[TemplateFamily],
    header_synonyms: list[dict[str, Any]],
    backlog: list[dict[str, Any]],
) -> str:
    synonym_by_family: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in header_synonyms:
        for family_id in split_semicolon(row.get("source_family_ids")):
            if row.get("suggested_canonical_field"):
                synonym_by_family[family_id].append(row)

    recommended = [row for row in backlog if row["status"] == "recommended_now"][:3]
    family_by_id = {family.family_id: family for family in families}

    lines = [
        "# Contract Pricing Profile Build Plan",
        "",
        "## Recommended First 3 Profile Families",
        "",
    ]

    if not recommended:
        lines.append("No family is ready for immediate profile implementation without manual review.")
    for row in recommended:
        family = family_by_id[row["family_id"]]
        mappings = synonym_by_family.get(family.family_id, [])
        lines.extend(
            [
                f"### {family.family_id}: {row['likely_distributor_names']}",
                "",
                f"- Why selected: {row['reasons_to_build_now']}",
                f"- Representative files: {row['representative_files']}",
                f"- Expected parser complexity: {row['complexity']}",
                f"- Known risks: {row['required_manual_review'] or 'None beyond normal workbook verification.'}",
                f"- Manual review questions: confirm vendor name, in-scope sheets/tabs, effective dates, and whether listed price fields represent net, contract, dealer, or MSRP pricing.",
                "- Likely canonical field mappings:",
            ]
        )
        if mappings:
            for mapping in mappings[:10]:
                lines.append(
                    f"  - `{mapping['observed_header']}` -> `{mapping['suggested_canonical_field']}` ({mapping['confidence']})"
                )
        else:
            lines.append("  - No deterministic mappings suggested yet.")
        lines.extend(["", ""])

    lines.extend(
        [
            "## Suggested Codex Implementation Order",
            "",
            "1. Create sanitized synthetic fixture workbooks for the first recommended family.",
            "2. Add a JSON distributor profile with sheet selection, header detection, and column mapping rules.",
            "3. Build profile application code that emits dry-run rows with file/sheet/row lineage.",
            "4. Add validation and exception generation before any publish/import path exists.",
            "5. Repeat for the second and third recommended families, extracting shared transforms only after duplication is clear.",
            "",
            "## Suggested Test Fixtures",
            "",
            "- One simple single-sheet workbook with clear SKU, UOM, description, price, and date headers.",
            "- One workbook with category-specific sheets/tabs.",
            "- One workbook with merged title rows above the real header.",
            "- One workbook with formulas in non-price and price-adjacent columns.",
            "- One workbook with ambiguous headers requiring manual mapping.",
            "",
            "## Keep Out Of Git",
            "",
            "- Real distributor spreadsheets.",
            "- Generated discovery outputs from real pricing files.",
            "- Raw price row exports.",
            "- Supplier portal credentials or other secrets.",
        ]
    )
    return "\n".join(lines) + "\n"


def run_analysis(input_dir: Path, output_dir: Path) -> dict[str, Any]:
    workbooks = load_workbook_analyses(input_dir)
    families = cluster_template_families(workbooks)
    priority_lookup = {
        family.family_id: rank
        for rank, family in enumerate(sorted(families, key=lambda item: item.priority_score), start=1)
    }
    template_rows = [family_to_row(family, priority_lookup) for family in families]
    header_synonyms = build_header_synonyms(families)
    backlog = build_backlog(families)

    output_dir.mkdir(parents=True, exist_ok=True)
    write_csv(output_dir / "template_families.csv", TEMPLATE_FAMILY_FIELDS, template_rows)
    write_csv(output_dir / "header_synonyms.csv", HEADER_SYNONYM_FIELDS, header_synonyms)
    write_csv(output_dir / "recommended_profile_backlog.csv", BACKLOG_FIELDS, backlog)
    (output_dir / "discovery_analysis.md").write_text(
        build_discovery_analysis_markdown(workbooks, families, backlog, input_dir),
        encoding="utf-8",
    )
    (output_dir / "profile_build_plan.md").write_text(
        build_profile_build_plan_markdown(families, header_synonyms, backlog),
        encoding="utf-8",
    )

    recommended_now = [row for row in backlog if row["status"] == "recommended_now"][:3]
    return {
        "output": str(output_dir),
        "workbooks_analyzed": len(workbooks),
        "template_families": len(families),
        "recommended_now": [
            {
                "family_id": row["family_id"],
                "likely_distributor_names": row["likely_distributor_names"],
                "complexity": row["complexity"],
            }
            for row in recommended_now
        ],
    }


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Analyze deterministic contract-pricing discovery outputs."
    )
    parser.add_argument("--input", required=True, type=Path, help="Discovery output directory.")
    parser.add_argument("--output", required=True, type=Path, help="Analysis output directory.")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(argv)
    result = run_analysis(args.input, args.output)
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
