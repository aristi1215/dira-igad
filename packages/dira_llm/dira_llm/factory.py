"""Language-model selection: OpenAI > Anthropic > canned fallback.

The pipeline and API must keep working with zero keys (seeded demo insurance),
so the factory silently degrades to CannedResponseAdapter.
"""

from __future__ import annotations

import logging
import os

from dira_core.ports import EmbeddingModel, LanguageModel

from dira_llm.canned import CannedResponseAdapter
from dira_llm.embeddings import OpenAIEmbeddingAdapter, PrecomputedEmbeddingsAdapter

logger = logging.getLogger("dira.llm")


def get_language_model(
    openai_api_key: str | None = None,
    anthropic_api_key: str | None = None,
) -> LanguageModel:
    if os.environ.get("DATA_MODE", "seeded") != "live":
        return CannedResponseAdapter()
    openai_key = openai_api_key or os.environ.get("OPENAI_API_KEY")
    if openai_key:
        try:
            from dira_llm.openai_adapter import OpenAIAdapter

            return OpenAIAdapter(api_key=openai_key)
        except Exception:
            logger.exception("OpenAI adapter unavailable; falling back")
    anthropic_key = anthropic_api_key or os.environ.get("ANTHROPIC_API_KEY")
    if anthropic_key:
        try:
            from dira_llm.anthropic_adapter import AnthropicAdapter

            return AnthropicAdapter(api_key=anthropic_key)
        except Exception:
            logger.exception("Anthropic adapter unavailable; falling back")
    return CannedResponseAdapter()


def get_embedding_model(
    openai_api_key: str | None = None,
    *,
    data_mode: str | None = None,
) -> EmbeddingModel:
    """Select a network-free seeded adapter or the live OpenAI adapter."""
    mode = data_mode or os.environ.get("DATA_MODE", "seeded")
    key = openai_api_key or os.environ.get("OPENAI_API_KEY")
    if mode == "live" and key:
        try:
            return OpenAIEmbeddingAdapter(api_key=key)
        except Exception:
            logger.exception("OpenAI embedding adapter unavailable; falling back")
    return PrecomputedEmbeddingsAdapter()
