from __future__ import annotations

import unittest
from decimal import Decimal

from pricing_ingestion.normalization import (
    normalize_identifier,
    normalize_uom,
    parse_currency,
    parse_date,
    parse_pack_size,
)


class NormalizationTests(unittest.TestCase):
    def test_currency_parsing(self) -> None:
        self.assertEqual(parse_currency("$1,234.50"), Decimal("1234.50"))
        self.assertEqual(parse_currency("(12.34)"), Decimal("-12.34"))
        with self.assertRaises(ValueError):
            parse_currency("TBD")

    def test_uom_aliases_and_unknowns(self) -> None:
        self.assertEqual(normalize_uom("Each"), "EA")
        self.assertEqual(normalize_uom("EA."), "EA")
        self.assertEqual(normalize_uom("EACHES"), "EA")
        self.assertEqual(normalize_uom("BOX"), "BX")
        self.assertEqual(normalize_uom("BOXES"), "BX")
        self.assertEqual(normalize_uom("PKG"), "PK")
        self.assertEqual(normalize_uom("rolls"), "RL")
        self.assertEqual(normalize_uom("PR"), "PR")
        with self.assertRaises(ValueError):
            normalize_uom("mystery")

    def test_pack_size_parsing(self) -> None:
        self.assertEqual(parse_pack_size("10/BOX"), Decimal("10"))
        self.assertEqual(parse_pack_size("12 EA"), Decimal("12"))
        self.assertEqual(parse_pack_size("4 x 25"), Decimal("100"))
        self.assertEqual(parse_pack_size("CASE OF 100"), Decimal("100"))

    def test_date_parsing_and_identifier_preservation(self) -> None:
        self.assertEqual(parse_date("2026-01-02"), "2026-01-02")
        self.assertEqual(parse_date("01/02/2026"), "2026-01-02")
        self.assertEqual(normalize_identifier("  001 234 "), "001234")


if __name__ == "__main__":
    unittest.main()
