"""Dispatch daemon entrypoint — two short transactions, external call outside both.

Usage (once implemented):
  python -m dira_worker.dispatch
"""

from __future__ import annotations

import sys


def main() -> int:
    print(
        "[dira-dispatch] Scaffold only — implement LISTEN + 30s poll, "
        "Tx A claim → HTTP call → Tx B result, zombie sweep → needs_review.",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
