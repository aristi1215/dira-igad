"""Pipeline stages E3–E7.

  E3 news → signals (LLM; degradable — never aborts the pipeline)
  E4 features (shared builder; in memory)
  E5 predict (RiskModel: seeded TransparentIndex / live LightGBM; in memory)
  E6 combine + explain (pure rule + deterministic template; in memory)
  E7 storefront (one transaction PER ZONE; SQL only — no network inside)

Invariants preserved: no network call inside any open transaction (E3 fetch/LLM happen
before the writes); the storefront is written atomically per zone.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Any

import psycopg
from dira_core import RiskBand, SituationDecision, SituationStatus, combine, decide_situation
from dira_core.ports import FeatureRow, LanguageModel
from dira_data import fixtures
from dira_data.adapters.factory import data_mode
from dira_data.repositories import models
from dira_data.repositories import news as news_repo
from dira_data.repositories import situations as sit_repo
from dira_features import FEATURE_NAMES
from dira_llm import CannedResponseAdapter, extract_signals
from dira_ml import TransparentIndexAdapter
from dira_ml.explain import template_explanation

from dira_worker import features_io

if TYPE_CHECKING:
    from dira_worker.pipeline import PipelineResult

log = logging.getLogger("dira.pipeline")

HAZARD = "conflict"
_ARTIFACTS = Path(__file__).resolve().parents[3] / "artifacts"
_RESOLVE_AFTER = 3
_HIGH = RiskBand.ORANGE
_LOW = RiskBand.YELLOW


def _seeded_lm() -> LanguageModel:
    """Canned extractor keyed by document title (deterministic; nothing external can fail)."""
    json_map: dict[str, dict[str, Any]] = {}
    for doc in fixtures.load_json("news.json"):
        json_map[doc["title"]] = {"signals": doc.get("signals", [])}
    return CannedResponseAdapter(json_map=json_map)


def _language_model() -> LanguageModel:
    if data_mode() == "live":
        from dira_llm import AnthropicAdapter

        return AnthropicAdapter()
    return _seeded_lm()


def stage_e3_news(
    conn: psycopg.Connection,
    cutoff: datetime,
    result: PipelineResult,
    lm: LanguageModel | None,
) -> None:
    """Extract signals from available documents. Failures degrade (do not abort)."""
    lm = lm or _language_model()
    docs = news_repo.read_documents_available(conn, cutoff)
    created = 0
    for doc in docs:
        try:
            # Any LLM failure (invalid output OR adapter error: timeout/network/API) degrades:
            # the cycle finishes with corroboration 0 and a template explanation (invariant 6).
            signals = extract_signals(doc["title"], doc["body"], lm)
        except Exception as exc:
            result.degraded = True
            result.warnings.append(f"E3 extraction failed for {doc['id']}: {exc}")
            log.warning("E3 extraction failed for %s: %s", doc["id"], exc)
            continue
        with conn.transaction():
            news_repo.insert_signals_for_document(
                conn, doc["id"], [s.model_dump() for s in signals], doc["available_at"]
            )
        created += len(signals)
    result.stats["e3"] = {"documents": len(docs), "signals": created, "degraded": result.degraded}


def _risk_model_and_version(conn: psycopg.Connection, override: Any) -> tuple[Any, str]:
    if override is not None:
        kind = getattr(override, "kind", "transparent_index")
        if kind == "transparent_index":
            return override, models.ensure_transparent_index(conn, FEATURE_NAMES)
        vid = models.latest_id(conn, kind) or models.register(
            conn, kind=kind, path=None, feature_list=FEATURE_NAMES, metrics={}
        )
        return override, vid

    if data_mode() == "live" and (_ARTIFACTS / "model_v1.lgb").exists():
        from dira_ml.lightgbm_adapter import LightGBMAdapter

        model = LightGBMAdapter(_ARTIFACTS)
        vid = models.latest_id(conn, "lightgbm")
        if vid is None:
            import json

            card = json.loads((_ARTIFACTS / "model_card.json").read_text())
            vid = models.register(
                conn, kind="lightgbm", path=str(_ARTIFACTS / "model_v1.lgb"),
                feature_list=card["feature_list"], metrics=card["metrics"],
            )
        return model, vid

    return TransparentIndexAdapter(), models.ensure_transparent_index(conn, FEATURE_NAMES)


def _consecutive_below(prior: list[str]) -> int:
    cnt = 0
    for b in prior:
        if RiskBand(b).rank < _LOW.rank:
            cnt += 1
        else:
            break
    return cnt


def _e7_zone(
    conn: psycopg.Connection,
    zone_id: str,
    cycle: date,
    cutoff: datetime,
    assessment_row: dict[str, Any],
    operational_band: RiskBand,
) -> None:
    """One atomic transaction: situation lifecycle + assessment + exposure snapshot."""
    with conn.transaction():
        current = sit_repo.get_open_situation(conn, zone_id, HAZARD)
        status = SituationStatus(current["status"]) if current else None
        prior = sit_repo.prior_bands(conn, current["id"], cycle) if current else []
        decision, new_count = decide_situation(
            operational_band=operational_band,
            current_status=status,
            cycles_below_threshold=_consecutive_below(prior),
            high_band=_HIGH,
            low_band=_LOW,
            resolve_after_cycles_below=_RESOLVE_AFTER,
        )
        if decision is SituationDecision.HOLD:
            return  # nothing visible for this zone

        if current is None:
            situation_id = sit_repo.open_situation(conn, zone_id, HAZARD, cutoff, status="open")
        else:
            situation_id = current["id"]
            if decision is SituationDecision.OPEN and status is SituationStatus.MONITORING:
                sit_repo.set_status(conn, situation_id, "open")
            elif decision is SituationDecision.MONITOR and status is SituationStatus.OPEN:
                sit_repo.set_status(conn, situation_id, "monitoring")

        assessment_row["situation_id"] = situation_id
        assessment_id = sit_repo.upsert_assessment(conn, assessment_row)
        sit_repo.upsert_exposure_snapshot(conn, assessment_id, zone_id)

        if decision is SituationDecision.RESOLVE:
            sit_repo.set_status(
                conn, situation_id, "resolved", cycles_below=new_count, resolved_at=cutoff
            )
        else:
            sit_repo.set_status(conn, situation_id, status.value if status else "open",
                                cycles_below=new_count)


def run_e3_to_e7(
    conn: psycopg.Connection,
    cycle: date,
    cutoff: datetime,
    result: PipelineResult,
    *,
    lm: LanguageModel | None = None,
    risk_model: Any | None = None,
) -> None:
    # E3 (LLM outside the storefront writes).
    stage_e3_news(conn, cutoff, result, lm)

    # E4 features (in memory). Extend the dekad calendar to the cycle so lags resolve.
    builder, zone_ids = features_io.build_feature_builder(conn, up_to=cycle)

    # E5 model + version (registered once, before the per-zone loop).
    with conn.transaction():
        model, model_version_id = _risk_model_and_version(conn, risk_model)

    since = cutoff - timedelta(days=60)
    assessments = 0
    for zid in zone_ids:
        # E4/E5: features + prediction.
        features = builder.row(zid, cycle, cutoff)
        assessment = model.assess(FeatureRow(zone_id=zid, dekad_start=cycle, values=features))
        # E6: corroboration (confirmed news only) + combination rule + explanation.
        corroboration = min(1.0, 0.34 * news_repo.count_confirmed_signals(conn, zid, cutoff, since))
        combination = combine(assessment.model_risk, corroboration)
        explanation = template_explanation(assessment.shap)
        operational_band = RiskBand(combination.operational_band)

        row = {
            "cycle": cycle,
            "data_cutoff": cutoff,
            "prob_conflict": assessment.prob_conflict,
            "expected_incidents": assessment.expected_incidents,
            "model_risk": assessment.model_risk,
            "model_band": assessment.model_band,
            "corroboration": corroboration,
            "operational_band": combination.operational_band,
            "combination_rule": combination.rule,
            "explanation": explanation,
            "shap": assessment.shap,
            "model_version_id": model_version_id,
        }
        # E7: atomic per-zone storefront write.
        _e7_zone(conn, zid, cycle, cutoff, row, operational_band)
        assessments += 1
    result.stats["e5_e7"] = {"zones": assessments}
