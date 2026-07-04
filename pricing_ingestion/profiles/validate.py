from __future__ import annotations

import argparse
import json
from pathlib import Path

from pricing_ingestion.profiles.loader import load_profile, validate_profile


def validate_profile_path(path: Path) -> dict[str, object]:
    profile = load_profile(path)
    errors = validate_profile(profile)
    return {
        "profile": str(path),
        "valid": not errors,
        "errors": [error.__dict__ for error in errors],
    }


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Validate contract-pricing ingestion profiles.")
    parser.add_argument("--profile", type=Path, help="Profile JSON path.")
    parser.add_argument("--all", action="store_true", help="Validate all JSON profiles in a directory.")
    parser.add_argument("--profiles-dir", type=Path, default=Path("pricing_ingestion/profiles"))
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(argv)

    if args.all:
        profile_paths = sorted(args.profiles_dir.glob("*.json"))
    elif args.profile:
        profile_paths = [args.profile]
    else:
        parser.error("Provide --profile or --all")

    results = [validate_profile_path(path) for path in profile_paths]
    print(json.dumps({"profiles_validated": len(results), "results": results}, indent=2, sort_keys=True))
    return 0 if all(result["valid"] for result in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
