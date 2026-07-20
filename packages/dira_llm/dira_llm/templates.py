"""Deterministic, do-no-harm text templates (used as seeded generation + safe fallback).

These NEVER name actors, ethnicities, clans or communities — conditions and actions only.
"""

from __future__ import annotations

_BAND_INTRO = {
    "red": "Conditions in your area indicate a high level of concern.",
    "orange": "Conditions in your area indicate a raised level of concern.",
    "yellow": "Conditions in your area are being monitored.",
    "green": "Conditions in your area are currently calm.",
}

_ACTIONS = (
    "Please stay informed through local officials, avoid unnecessary travel in affected areas, "
    "keep water and essential supplies ready, and report urgent needs to community leaders."
)


def alert_text(zone_name: str, band: str, explanation: str) -> str:
    """A safe voice-alert message. Structure: condition summary + protective actions."""
    intro = _BAND_INTRO.get(band, _BAND_INTRO["yellow"])
    return f"{intro} {explanation} {_ACTIONS}"
