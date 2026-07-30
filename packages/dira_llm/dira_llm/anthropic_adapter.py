"""Anthropic-backed LanguageModel adapter."""

from __future__ import annotations

import json
import os
from typing import Any

from anthropic import Anthropic
from dira_core.ports import ToolCall, ToolTurn


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

    def complete_with_tools(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        *,
        system: str | None = None,
    ) -> ToolTurn:
        anthropic_messages: list[dict[str, Any]] = []
        for message in messages:
            if message.get("role") == "assistant" and message.get("tool_calls"):
                content: list[dict[str, Any]] = []
                if message.get("content"):
                    content.append({"type": "text", "text": message["content"]})
                content.extend(
                    {
                        "type": "tool_use",
                        "id": call["id"],
                        "name": call["name"],
                        "input": call["arguments"],
                    }
                    for call in message["tool_calls"]
                )
                anthropic_messages.append({"role": "assistant", "content": content})
            elif message.get("role") == "tool":
                anthropic_messages.append(
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "tool_result",
                                "tool_use_id": message["tool_call_id"],
                                "content": message.get("content", ""),
                            }
                        ],
                    }
                )
            else:
                anthropic_messages.append(message)
        response = self.client.messages.create(
            model=self.model,
            max_tokens=1000,
            system=system or "",
            messages=anthropic_messages,  # type: ignore[arg-type]
            tools=[
                {
                    "name": spec["function"]["name"],
                    "description": spec["function"].get("description", ""),
                    "input_schema": spec["function"]["parameters"],
                }
                for spec in tools
            ],  # type: ignore[arg-type]
        )
        text = "".join(
            block.text
            for block in response.content
            if getattr(block, "type", None) == "text"
        )
        calls = tuple(
            ToolCall(
                name=block.name,
                arguments=dict(block.input),
            )
            for block in response.content
            if getattr(block, "type", None) == "tool_use"
        )
        return ToolTurn(text=text, tool_calls=calls)
