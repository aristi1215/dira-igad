"""News → signals extraction with Pydantic validation. Invalid output → 1 retry → discard.

Prompt-injection safe: the article is passed as data and the schema is enforced; any attempt
by the article to change behaviour just yields off-schema/no output, which is discarded.
"""

from __future__ import annotations

import json
import logging

from dira_core.ports import LanguageModel
from pydantic import ValidationError

from dira_llm.prompts import EXTRACTION_SYSTEM, extraction_user
from dira_llm.schema import ExtractionOut, SignalOut

log = logging.getLogger("dira.llm.extract")


class ExtractionFailed(Exception):
    """Extraction produced invalid output after the allowed retries."""


def extract_signals(
    title: str, body: str, lm: LanguageModel, *, retries: int = 1
) -> list[SignalOut]:
    prompt = extraction_user(title, body)
    last_err: Exception | None = None
    for attempt in range(retries + 1):
        try:
            raw = lm.complete_json(prompt, system=EXTRACTION_SYSTEM)
            return ExtractionOut.model_validate(raw).signals
        except (json.JSONDecodeError, ValidationError, ValueError, TypeError) as exc:
            last_err = exc
            log.warning("extraction attempt %d failed: %s", attempt + 1, exc)
    raise ExtractionFailed(str(last_err))
