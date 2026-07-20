"""Deterministic LLM adapter for seeded mode and tests."""

from __future__ import annotations

import json
import re
from typing import Any


class CannedResponseAdapter:
    """Return stable JSON for signal extraction and do-no-harm alert drafting."""

    def complete(self, prompt: str, *, system: str | None = None) -> str:
        return json.dumps(self.complete_json(prompt, system=system), sort_keys=True)

    def complete_json(self, prompt: str, *, system: str | None = None) -> dict[str, Any]:
        system_lower = (system or "").lower()
        # Prefer system-prompt intent over body text (news may contain the word "alert").
        if "do-no-harm public alert" in system_lower or "draft do-no-harm" in system_lower:
            return {
                "language": "sw",
                "body_text": (
                    "Tahadhari: ukame unaongeza presha kwenye maji na malisho. "
                    "Tumia ratiba ya maji, safiri mchana, na ripoti njia zilizofungwa "
                    "kwa kamati za usuluhishi."
                ),
            }
        if "draft alert" in prompt.lower() and "document:" not in prompt.lower():
            return {
                "language": "sw",
                "body_text": (
                    "Tahadhari: ukame unaongeza presha kwenye maji na malisho. "
                    "Tumia ratiba ya maji, safiri mchana, na ripoti njia zilizofungwa "
                    "kwa kamati za usuluhishi."
                ),
            }
        return {"signals": self._signals(prompt)}

    def _signals(self, prompt: str) -> list[dict[str, Any]]:
        zone_ids = _extract_zone_ids(prompt)
        confidence = 0.35
        signal_type = "monitoring"
        prompt_lower = prompt.lower()
        if any(term in prompt_lower for term in ("dry", "drought", "rainfall", "vegetation")):
            confidence = 0.72
            signal_type = "dryness_pressure"
        elif any(term in prompt_lower for term in ("water", "borehole", "wells", "pasture")):
            confidence = 0.64
            signal_type = "resource_pressure"
        elif any(term in prompt_lower for term in ("road", "checkpoint", "route")):
            confidence = 0.55
            signal_type = "movement_disruption"

        return [
            {
                "zone_id": zone_id,
                "signal_type": signal_type,
                "confidence": confidence,
                "excerpt": _safe_excerpt(prompt),
            }
            for zone_id in zone_ids
        ]


def _extract_zone_ids(prompt: str) -> list[str]:
    match = re.search(r"zone_ids\s*=\s*\[([^\]]*)\]", prompt)
    if not match:
        return []
    return re.findall(r"[a-z][a-z0-9_]*", match.group(1))


def _safe_excerpt(prompt: str) -> str:
    compact = " ".join(prompt.split())
    marker = "Document:"
    if marker in compact:
        compact = compact.split(marker, 1)[1].strip()
    return compact[:180]
