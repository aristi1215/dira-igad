"""Anthropic-backed LanguageModel adapter."""

from __future__ import annotations

import json
import os
from typing import Any

from anthropic import Anthropic


class AnthropicAdapter:
    def __init__(self, api_key: str | None = None, model: str = "claude-3-5-haiku-latest") -> None:
        key = api_key or os.environ.get("ANTHROPIC_API_KEY")
        if not key:
            raise RuntimeError("ANTHROPIC_API_KEY is required for AnthropicAdapter.")
        self.client = Anthropic(api_key=key)
        self.model = model

    def complete(self, prompt: str, *, system: str | None = None) -> str:
        response = self.client.messages.create(
            model=self.model,
            max_tokens=1000,
            system=system or "",
            messages=[{"role": "user", "content": prompt}],
        )
        return "".join(
            block.text
            for block in response.content
            if getattr(block, "type", None) == "text"
        )

    def complete_json(self, prompt: str, *, system: str | None = None) -> dict[str, Any]:
        text = self.complete(prompt, system=system)
        return json.loads(text)
