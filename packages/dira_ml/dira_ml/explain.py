"""Deterministic explanation from the top-|SHAP| contributions (E6 template fallback).

Maps feature names to plain-language CONDITIONS (no actors/ethnicities/clans — the features
carry none). This is always available, so the pipeline can explain even when the LLM is down.
"""

from __future__ import annotations

_PHRASES: dict[str, tuple[str, str]] = {
    # feature -> (phrase when it raises risk, phrase when it lowers risk)
    "rain_anom_mean3": ("below-average recent rainfall", "above-average recent rainfall"),
    "rain_anom_mean6": ("a prolonged rainfall deficit", "sustained adequate rainfall"),
    "rain_anom_lag1": ("a recent rainfall shortfall", "recent adequate rainfall"),
    "ndvi_anom_mean3": ("weakening vegetation cover", "healthy vegetation cover"),
    "ndvi_anom_lag1": ("recently weak vegetation", "recently healthy vegetation"),
    "incidents_sum3": ("recent local incident activity", "little recent local incident activity"),
    "incidents_lag1": ("incidents in the last period", "calm in the last period"),
    "incidents_sum6": ("sustained recent incident activity", "a calm recent period"),
    "incident_trend3": ("a rising incident trend", "a falling incident trend"),
    "neigh_incidents_sum3": ("incident activity in neighbouring areas", "calm neighbouring areas"),
    "neigh_rain_anom_mean3": ("dryness in neighbouring areas", "adequate rain nearby"),
    "fatalities_sum3": ("recent harm from incidents", "no recent harm from incidents"),
}


def template_explanation(shap: dict[str, float], top_k: int = 3) -> str:
    """Compose a one-sentence explanation from the strongest contributors."""
    ranked = sorted(shap.items(), key=lambda kv: abs(kv[1]), reverse=True)
    parts: list[str] = []
    for name, value in ranked:
        if value == 0 or name not in _PHRASES:
            continue
        raises, lowers = _PHRASES[name]
        parts.append(raises if value > 0 else lowers)
        if len(parts) >= top_k:
            break
    if not parts:
        return "Current indicators are within normal ranges."
    if len(parts) == 1:
        return f"This assessment is driven mainly by {parts[0]}."
    return "This assessment is driven mainly by " + ", ".join(parts[:-1]) + f", and {parts[-1]}."
