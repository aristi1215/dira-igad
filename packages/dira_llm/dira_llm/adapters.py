"""LanguageModel adapters: Anthropic (live) and canned (seeded/deterministic)."""

from __future__ import annotations

import json
import os
from typing import Any


class AnthropicAdapter:
    """Live LanguageModel via the Anthropic API. Behind the LanguageModel port."""

    def __init__(self, api_key: str | None = None, model: str = "claude-3-5-sonnet-latest"):
        self.api_key = api_key or os.environ.get("ANTHROPIC_API_KEY")
        self.model = model

    def _client(self) -> Any:
        import anthropic

        if not self.api_key:
            raise RuntimeError("ANTHROPIC_API_KEY missing for live LLM")
        return anthropic.Anthropic(api_key=self.api_key)

    def complete(self, prompt: str, *, system: str | None = None) -> str:
        msg = self._client().messages.create(
            model=self.model,
            max_tokens=512,
            system=system or "",
            messages=[{"role": "user", "content": prompt}],
        )
        return "".join(block.text for block in msg.content if getattr(block, "type", "") == "text")

    def complete_json(self, prompt: str, *, system: str | None = None) -> dict[str, Any]:
        text = self.complete(prompt, system=system)
        return json.loads(text)  # may raise; caller handles retry/discard


class CannedResponseAdapter:
    """Seeded LanguageModel. Deterministic; nothing external can fail (invariant 6).

    ``json_map`` maps a substring found in the prompt to a canned JSON object; ``text_fn``
    generates a deterministic completion for free-text prompts (e.g. alert drafts).
    """

    def __init__(
        self,
        json_map: dict[str, dict[str, Any]] | None = None,
        text_fn: Any = None,
    ) -> None:
        self.json_map = json_map or {}
        self.text_fn = text_fn

    def complete(self, prompt: str, *, system: str | None = None) -> str:
        if self.text_fn is not None:
            return str(self.text_fn(prompt, system))
        return ""

    def complete_json(self, prompt: str, *, system: str | None = None) -> dict[str, Any]:
        for key, value in self.json_map.items():
            if key in prompt:
                return value
        return {"signals": []}
