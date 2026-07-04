from __future__ import annotations

import re
import json
from datetime import date, datetime, time
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any


UOM_ALIASES = {
    "EA": "EA",
    "EACH": "EA",
    "BX": "BX",
    "BOX": "BX",
    "CS": "CS",
    "CASE": "CS",
    "PK": "PK",
    "PACK": "PK",
    "CT": "CT",
    "CARTON": "CT",
    "BG": "BG",
    "BAG": "BG",
    "RL": "RL",
    "ROLL": "RL",
    "PR": "PR",
    "PAIR": "PR",
    "DZ": "DZ",
    "DOZEN": "DZ",
}


def reference_uom_alias_path() -> Path:
    return Path(__file__).resolve().parent / "reference" / "uom_aliases.json"


def load_reference_uom_aliases() -> dict[str, str]:
    path = reference_uom_alias_path()
    if not path.exists():
        return {}
    rows = json.loads(path.read_text(encoding="utf-8"))
    return {
        re.sub(r"[^A-Za-z]+", "", str(row["alias"])).upper(): str(row["normalized_uom"])
        for row in rows
        if row.get("classification") == "direct_lexical_synonym"
    }

NON_NUMERIC_PRICE_PLACEHOLDERS = {
    "TBD",
    "N/A",
    "NA",
    "CALL",
    "CALL FOR PRICE",
    "QUOTE REQUIRED",
    "REQUEST QUOTE",
    "RFQ",
}


def trim(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text if text else None


def collapse_whitespace(value: Any) -> str | None:
    text = trim(value)
    if text is None:
        return None
    return re.sub(r"\s+", " ", text)


def null_if_blank(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, str) and not value.strip():
        return None
    return value


def normalize_identifier(value: Any, *, remove_formatting_whitespace: bool = True) -> str | None:
    text = collapse_whitespace(value)
    if text is None:
        return None
    if remove_formatting_whitespace:
        text = re.sub(r"\s+", "", text)
    return text


def normalize_description(value: Any) -> str | None:
    return collapse_whitespace(value)


def parse_decimal(value: Any) -> Decimal | None:
    if value is None:
        return None
    if isinstance(value, Decimal):
        return value
    if isinstance(value, (int, float)):
        return Decimal(str(value))

    text = str(value).strip()
    if not text:
        return None
    if text.upper() in NON_NUMERIC_PRICE_PLACEHOLDERS:
        raise ValueError(f"nonnumeric price placeholder: {text}")

    negative = False
    if text.startswith("(") and text.endswith(")"):
        negative = True
        text = text[1:-1]
    text = text.replace("$", "").replace(",", "").strip()
    if text.startswith("-"):
        negative = True
        text = text[1:].strip()

    try:
        parsed = Decimal(text)
    except InvalidOperation as exc:
        raise ValueError(f"invalid decimal: {value}") from exc

    return -parsed if negative else parsed


def parse_currency(value: Any) -> Decimal | None:
    return parse_decimal(value)


def normalize_currency(value: Any) -> str | None:
    text = collapse_whitespace(value)
    if text is None:
        return "USD"
    if text.upper() in {"$", "US$", "USD", "US DOLLAR", "US DOLLARS"}:
        return "USD"
    raise ValueError(f"unsupported currency: {value}")


def normalize_uom(value: Any) -> str | None:
    text = collapse_whitespace(value)
    if text is None:
        return None
    normalized = re.sub(r"[^A-Za-z]+", "", text).upper()
    aliases = {**UOM_ALIASES, **load_reference_uom_aliases()}
    if normalized in aliases:
        return aliases[normalized]
    raise ValueError(f"unknown uom: {value}")


def parse_date(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, time):
        raise ValueError(f"invalid date: {value}")

    text = collapse_whitespace(value)
    if text is None:
        return None

    formats = [
        "%Y-%m-%d",
        "%m/%d/%Y",
        "%m/%d/%y",
        "%m-%d-%Y",
        "%m-%d-%y",
        "%m.%d.%Y",
        "%m.%d.%y",
        "%B %d, %Y",
        "%b %d, %Y",
    ]
    for date_format in formats:
        try:
            return datetime.strptime(text, date_format).date().isoformat()
        except ValueError:
            continue
    raise ValueError(f"invalid date: {value}")


def parse_pack_size(value: Any) -> Decimal | None:
    text = collapse_whitespace(value)
    if text is None:
        return None

    patterns = [
        r"^(?P<count>\d+(?:\.\d+)?)$",
        r"^(?P<count>\d+(?:\.\d+)?)\s*/\s*[A-Za-z]+$",
        r"^(?P<count>\d+(?:\.\d+)?)\s+[A-Za-z]+$",
        r"^(?P<a>\d+(?:\.\d+)?)\s*x\s*(?P<b>\d+(?:\.\d+)?)$",
        r"^case\s+of\s+(?P<count>\d+(?:\.\d+)?)$",
    ]
    normalized = text.lower()
    for pattern in patterns:
        match = re.match(pattern, normalized)
        if not match:
            continue
        groups = match.groupdict()
        if groups.get("a") and groups.get("b"):
            return Decimal(groups["a"]) * Decimal(groups["b"])
        if groups.get("count"):
            return Decimal(groups["count"])
    raise ValueError(f"pack size not parsed: {value}")


def apply_transform(value: Any, transform_name: str) -> Any:
    if transform_name == "trim":
        return trim(value)
    if transform_name == "collapse_whitespace":
        return collapse_whitespace(value)
    if transform_name == "normalize_identifier":
        return normalize_identifier(value)
    if transform_name == "normalize_description":
        return normalize_description(value)
    if transform_name == "parse_decimal":
        return parse_decimal(value)
    if transform_name == "parse_currency":
        return parse_currency(value)
    if transform_name == "normalize_currency":
        return normalize_currency(value)
    if transform_name == "normalize_uom":
        return normalize_uom(value)
    if transform_name == "parse_pack_size":
        return parse_pack_size(value)
    if transform_name == "parse_date":
        return parse_date(value)
    if transform_name == "uppercase":
        text = trim(value)
        return text.upper() if text is not None else None
    if transform_name == "lowercase":
        text = trim(value)
        return text.lower() if text is not None else None
    if transform_name == "null_if_blank":
        return null_if_blank(value)
    raise ValueError(f"unsupported transform: {transform_name}")


SUPPORTED_TRANSFORMS = {
    "trim",
    "collapse_whitespace",
    "normalize_identifier",
    "normalize_description",
    "parse_decimal",
    "parse_currency",
    "normalize_currency",
    "normalize_uom",
    "parse_pack_size",
    "parse_date",
    "uppercase",
    "lowercase",
    "null_if_blank",
}
