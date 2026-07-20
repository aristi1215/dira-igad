"""Dekadal pipeline entrypoint — seven stages (E1–E7). Not implemented yet.

Usage (once implemented):
  python -m dira_worker.pipeline --cycle 2026-03-11
"""

from __future__ import annotations

import argparse
import sys


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Dira dekadal pipeline worker")
    parser.add_argument(
        "--cycle",
        required=True,
        help="Dekada start date (YYYY-MM-DD); day must be 1, 11, or 21",
    )
    args = parser.parse_args(argv)
    print(
        f"[dira-pipeline] Scaffold only — cycle={args.cycle}. "
        "Implement E1–E7 in the implementation pass.",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
