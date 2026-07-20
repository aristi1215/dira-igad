"""Schema-validated news signal extraction."""

from __future__ import annotations

import logging
from collections.abc import Mapping, Sequence
from datetime import date
from typing import Any

from dira_core.ports import LanguageModel
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from dira_llm.prompts import NEWS_EXTRACTION_SYSTEM

log = logging.getLogger(__name__)


class ExtractedSignal(BaseModel):
    model_config = ConfigDict(extra="forbid")

    zone_id: str
    signal_type: str
    confidence: float = Field(ge=0.0, le=1.0)
    excerpt: str | None = None

    @field_validator("signal_type")
    @classmethod
    def signal_type_must_be_nonempty(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("signal_type must be nonempty")
        return value


class SignalExtractionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    signals: list[ExtractedSignal] = Field(default_factory=list)


def extract_signals(
    documents: Sequence[Mapping[str, Any]],
    llm: LanguageModel,
    zone_ids: list[str],
    cycle: date,
) -> list[dict[str, Any]]:
    """Extract unconfirmed news signals, retrying invalid LLM JSON once."""

    allowed_zones = set(zone_ids)
    out: list[dict[str, Any]] = []
    for document in documents:
        prompt = _prompt(document, zone_ids, cycle)
        document_id = document.get("id") or document.get("external_id")
        parsed = _complete_with_retry(llm, prompt, document_id)
        if parsed is None:
            continue
        for signal in parsed.signals:
            if signal.zone_id not in allowed_zones:
                continue
            out.append(
                {
                    "document_id": document.get("id"),
                    "zone_id": signal.zone_id,
                    "signal_type": signal.signal_type,
                    "confidence": signal.confidence,
                    "status": "unconfirmed",
                    "excerpt": signal.excerpt,
                    "cycle": cycle,
                }
            )
    return out


def _complete_with_retry(
    llm: LanguageModel, prompt: str, document_id: object
) -> SignalExtractionResponse | None:
    for attempt in range(2):
        try:
            payload = llm.complete_json(prompt, system=NEWS_EXTRACTION_SYSTEM)
            return SignalExtractionResponse.model_validate(payload)
        except (ValidationError, ValueError, TypeError) as exc:
            if attempt == 0:
                log.warning(
                    "Invalid signal extraction for document %s; retrying: %s",
                    document_id,
                    exc,
                )
                continue
            log.warning(
                "Discarding invalid signal extraction for document %s: %s",
                document_id,
                exc,
            )
            return None
    return None


def _prompt(document: Mapping[str, Any], zone_ids: list[str], cycle: date) -> str:
    return (
        "Extract news signals as JSON with shape "
        '{"signals":[{"zone_id":"...","signal_type":"...","confidence":0.0,"excerpt":"..."}]}. '
        f"cycle={cycle.isoformat()} zone_ids={zone_ids}. "
        f"Title: {document.get('title', '')}. Document: {document.get('body', '')}"
    )
