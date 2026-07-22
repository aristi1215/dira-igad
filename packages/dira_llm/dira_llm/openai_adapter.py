"""OpenAI-backed LanguageModel adapter (see DEVIATIONS.md D-010)."""

from __future__ import annotations

import json
import os
from typing import Any

from openai import OpenAI

DEFAULT_MODEL = "gpt-4o-mini"


class OpenAIAdapter:
    def __init__(self, api_key: str | None = None, model: str | None = None) -> None:
        key = api_key or os.environ.get("OPENAI_API_KEY")
        if not key:
            raise RuntimeError("OPENAI_API_KEY is required for OpenAIAdapter.")
        self.client = OpenAI(api_key=key)
        self.model = model or os.environ.get("OPENAI_MODEL", DEFAULT_MODEL)

    def complete(self, prompt: str, *, system: str | None = None) -> str:
        messages: list[dict[str, str]] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})
        response = self.client.chat.completions.create(
            model=self.model,
            max_tokens=1000,
            messages=messages,  # type: ignore[arg-type]
        )
        return response.choices[0].message.content or ""

    def complete_json(self, prompt: str, *, system: str | None = None) -> dict[str, Any]:
        messages: list[dict[str, str]] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})
        response = self.client.chat.completions.create(
            model=self.model,
            max_tokens=1000,
            response_format={"type": "json_object"},
            messages=messages,  # type: ignore[arg-type]
        )
        text = response.choices[0].message.content or "{}"
        parsed = json.loads(text)
        if not isinstance(parsed, dict):
            raise ValueError("Model did not return a JSON object")
        return parsed
