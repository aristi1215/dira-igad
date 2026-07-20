"""LLM adapters, prompts, embeddings, and news signal extraction."""

from __future__ import annotations

from dira_llm.anthropic_adapter import AnthropicAdapter
from dira_llm.canned import CannedResponseAdapter
from dira_llm.embeddings import EMBEDDING_DIM, LocalBgeM3Adapter, PrecomputedEmbeddingsAdapter
from dira_llm.prompts import ALERT_DRAFT_SYSTEM, NEWS_EXTRACTION_SYSTEM
from dira_llm.signals import ExtractedSignal, SignalExtractionResponse, extract_signals

__all__ = [
    "ALERT_DRAFT_SYSTEM",
    "EMBEDDING_DIM",
    "NEWS_EXTRACTION_SYSTEM",
    "AnthropicAdapter",
    "CannedResponseAdapter",
    "ExtractedSignal",
    "LocalBgeM3Adapter",
    "PrecomputedEmbeddingsAdapter",
    "SignalExtractionResponse",
    "extract_signals",
]
