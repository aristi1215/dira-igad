"""The ONE feature builder (invariant 2). Training and inference both import this — there is
no second implementation, so there is no train/serve skew.

Bitemporality is enforced here and nowhere else: every value is used only if its
``available_at <= cutoff``. A value published after the cutoff is invisible (NULL), whether
we are training on history or serving a live cycle.

The builder reads ONLY climate + conflict-count history + adjacency. It never reads ACLED
``notes``/``actor*`` — there are no actor-derived features (do-no-harm, invariant 7).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Any

from dira_features.dekads import dekad_end, seasonality

# Canonical, ordered feature list. Persisted to model_versions.feature_list; the model and the
# inference path agree on it exactly. NB: no name references notes/actors/ethnicity/clan.
FEATURE_NAMES: list[str] = [
    "rain_anom_lag1",
    "rain_anom_lag2",
    "rain_anom_lag3",
    "rain_anom_mean3",
    "rain_anom_mean6",
    "ndvi_lag1",
    "ndvi_lag2",
    "ndvi_lag3",
    "ndvi_anom_lag1",
    "ndvi_anom_mean3",
    "incidents_lag1",
    "incidents_sum3",
    "incidents_sum6",
    "fatalities_sum3",
    "incident_trend3",
    "neigh_incidents_sum3",
    "neigh_rain_anom_mean3",
    "season_sin",
    "season_cos",
]


def _as_dt(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)
    text = str(value).replace("Z", "+00:00")
    dt = datetime.fromisoformat(text)
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def _as_date(value: Any) -> date:
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    return date.fromisoformat(str(value))


@dataclass(frozen=True)
class _Climate:
    rain_mm: float | None
    rain_anomaly: float | None
    rain_available_at: datetime | None
    ndvi: float | None
    ndvi_anomaly: float | None
    ndvi_available_at: datetime | None


class FeatureBuilder:
    """Build feature rows / labels from in-memory observations. Deterministic and pure."""

    def __init__(
        self,
        climate: list[dict[str, Any]],
        events: list[dict[str, Any]],
        adjacency: list[tuple[str, str]],
        dekads: list[date],
    ) -> None:
        self._climate: dict[tuple[str, date], _Climate] = {}
        for r in climate:
            key = (r["zone_id"], _as_date(r["dekad_start"]))
            self._climate[key] = _Climate(
                rain_mm=r.get("rain_mm"),
                rain_anomaly=r.get("rain_anomaly"),
                rain_available_at=_as_dt(r.get("rain_available_at")),
                ndvi=r.get("ndvi"),
                ndvi_anomaly=r.get("ndvi_anomaly"),
                ndvi_available_at=_as_dt(r.get("ndvi_available_at")),
            )
        # Events per zone: (event_date, available_at, fatalities). No notes/actors kept.
        self._events: dict[str, list[tuple[date, datetime, int]]] = {}
        for e in events:
            zid = e.get("zone_id")
            if zid is None:
                continue  # out-of-zone events never enter zone features
            av = _as_dt(e["available_at"])
            if av is None:
                continue
            self._events.setdefault(zid, []).append(
                (_as_date(e["event_date"]), av, int(e.get("fatalities", 0)))
            )
        self._neighbors: dict[str, list[str]] = {}
        for zid, nid in adjacency:
            self._neighbors.setdefault(zid, []).append(nid)
        self._dekads = sorted(dekads)
        self._pos = {d: i for i, d in enumerate(self._dekads)}

    # --- helpers -------------------------------------------------------------------------
    def _lag_dekad(self, dekad: date, k: int) -> date | None:
        pos = self._pos.get(dekad)
        if pos is None or pos - k < 0:
            return None
        return self._dekads[pos - k]

    def _rain_anom(self, zone_id: str, dekad: date, cutoff: datetime) -> float | None:
        c = self._climate.get((zone_id, dekad))
        if c is None or c.rain_available_at is None or c.rain_available_at > cutoff:
            return None
        return c.rain_anomaly

    def _ndvi(
        self, zone_id: str, dekad: date, cutoff: datetime, anom: bool = False
    ) -> float | None:
        c = self._climate.get((zone_id, dekad))
        if c is None or c.ndvi_available_at is None or c.ndvi_available_at > cutoff:
            return None
        return c.ndvi_anomaly if anom else c.ndvi

    def _incidents_in(self, zone_id: str, start: date, end: date, cutoff: datetime) -> int:
        rows = self._events.get(zone_id, [])
        return sum(1 for d, av, _ in rows if start <= d <= end and av <= cutoff)

    def _fatalities_in(self, zone_id: str, start: date, end: date, cutoff: datetime) -> int:
        rows = self._events.get(zone_id, [])
        return sum(f for d, av, f in rows if start <= d <= end and av <= cutoff)

    def _lag_window(self, dekad: date, k: int) -> tuple[date, date] | None:
        """Range spanning the k dekads immediately before ``dekad`` (lag 1..k)."""
        first = self._lag_dekad(dekad, k)
        last = self._lag_dekad(dekad, 1)
        if first is None or last is None:
            return None
        return first, dekad_end(last)

    # --- public --------------------------------------------------------------------------
    def row(self, zone_id: str, dekad: date, cutoff: datetime) -> dict[str, float | None]:
        f: dict[str, float | None] = {}

        # Rain anomaly lags.
        lags = {}
        for k in (1, 2, 3):
            ld = self._lag_dekad(dekad, k)
            lags[k] = self._rain_anom(zone_id, ld, cutoff) if ld else None
            f[f"rain_anom_lag{k}"] = lags[k]

        def _mean_rain(k: int) -> float | None:
            vals = []
            for j in range(1, k + 1):
                ld = self._lag_dekad(dekad, j)
                v = self._rain_anom(zone_id, ld, cutoff) if ld else None
                if v is None:
                    return None  # insufficient history -> NULL (edge case)
                vals.append(v)
            return sum(vals) / len(vals)

        f["rain_anom_mean3"] = _mean_rain(3)
        f["rain_anom_mean6"] = _mean_rain(6)

        for k in (1, 2, 3):
            ld = self._lag_dekad(dekad, k)
            f[f"ndvi_lag{k}"] = self._ndvi(zone_id, ld, cutoff) if ld else None
        ld1 = self._lag_dekad(dekad, 1)
        f["ndvi_anom_lag1"] = self._ndvi(zone_id, ld1, cutoff, anom=True) if ld1 else None

        ndvi_anoms: list[float] = []
        ndvi_ok = True
        for j in (1, 2, 3):
            ld = self._lag_dekad(dekad, j)
            v = self._ndvi(zone_id, ld, cutoff, anom=True) if ld else None
            if v is None:
                ndvi_ok = False
                break
            ndvi_anoms.append(v)
        f["ndvi_anom_mean3"] = (sum(ndvi_anoms) / 3) if ndvi_ok else None

        # Incident features (bitemporally cut).
        w1 = self._lag_window(dekad, 1)
        w3 = self._lag_window(dekad, 3)
        w6 = self._lag_window(dekad, 6)
        f["incidents_lag1"] = float(self._incidents_in(zone_id, *w1, cutoff)) if w1 else None
        f["incidents_sum3"] = float(self._incidents_in(zone_id, *w3, cutoff)) if w3 else None
        f["incidents_sum6"] = float(self._incidents_in(zone_id, *w6, cutoff)) if w6 else None
        f["fatalities_sum3"] = float(self._fatalities_in(zone_id, *w3, cutoff)) if w3 else None

        # Trend: incidents in the most-recent dekad minus 3 dekads ago.
        ld3 = self._lag_dekad(dekad, 3)
        if w1 and ld3 is not None:
            recent = self._incidents_in(zone_id, *w1, cutoff)
            older = self._incidents_in(zone_id, ld3, dekad_end(ld3), cutoff)
            f["incident_trend3"] = float(recent - older)
        else:
            f["incident_trend3"] = None

        # Neighbourhood aggregates (NULL if the zone has no neighbours — no division by zero).
        neighbors = self._neighbors.get(zone_id, [])
        if neighbors and w3:
            f["neigh_incidents_sum3"] = float(
                sum(self._incidents_in(n, *w3, cutoff) for n in neighbors)
            )
            n_rain = []
            for n in neighbors:
                vals = []
                ok = True
                for j in (1, 2, 3):
                    ld = self._lag_dekad(dekad, j)
                    v = self._rain_anom(n, ld, cutoff) if ld else None
                    if v is None:
                        ok = False
                        break
                    vals.append(v)
                if ok:
                    n_rain.append(sum(vals) / 3)
            f["neigh_rain_anom_mean3"] = (sum(n_rain) / len(n_rain)) if n_rain else None
        else:
            f["neigh_incidents_sum3"] = None
            f["neigh_rain_anom_mean3"] = None

        s_sin, s_cos = seasonality(dekad)
        f["season_sin"] = s_sin
        f["season_cos"] = s_cos
        return {name: f[name] for name in FEATURE_NAMES}

    def label(self, zone_id: str, dekad: date) -> tuple[int, float]:
        """Training label = conflict in the cycle dekad itself (truth, not bitemporally cut)."""
        start, end = dekad, dekad_end(dekad)
        rows = self._events.get(zone_id, [])
        n = sum(1 for d, _, _ in rows if start <= d <= end)
        return (1 if n > 0 else 0, float(n))
