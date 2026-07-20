"""LLM adapters, prompts, news-signal extraction, and safe text templates."""

from __future__ import annotations

from dira_llm.adapters import AnthropicAdapter, CannedResponseAdapter
from dira_llm.extract import ExtractionFailed, extract_signals
from dira_llm.schema import ExtractionOut, SignalOut
from dira_llm.templates import alert_text

__all__ = [
    "AnthropicAdapter",
    "CannedResponseAdapter",
    "ExtractionFailed",
    "ExtractionOut",
    "SignalOut",
    "alert_text",
    "extract_signals",
]
