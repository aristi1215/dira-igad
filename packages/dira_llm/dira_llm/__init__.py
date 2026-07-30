"""LLM adapters, prompts, embeddings, and news signal extraction."""

from __future__ import annotations

from dira_llm.anthropic_adapter import AnthropicAdapter
from dira_llm.canned import CannedResponseAdapter
from dira_llm.embeddings import (
    EMBEDDING_DIM,
    LocalBgeM3Adapter,
    OpenAIEmbeddingAdapter,
    PrecomputedEmbeddingsAdapter,
)
from dira_llm.factory import get_embedding_model, get_language_model
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
    "OpenAIEmbeddingAdapter",
    "PrecomputedEmbeddingsAdapter",
    "SignalExtractionResponse",
    "extract_signals",
    "get_language_model",
    "get_embedding_model",
]
