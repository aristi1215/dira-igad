"""OpenAI-backed LanguageModel adapter (see DEVIATIONS.md D-010)."""

from __future__ import annotations

import json
import os
from collections.abc import Iterator
from typing import Any

from dira_core.ports import ToolCall, ToolTurn
from openai import OpenAI

DEFAULT_MODEL = "gpt-4o-mini"


class OpenAIAdapter:
    def __init__(
        self,
        api_key: str | None = None,
        model: str | None = None,
        max_tokens: int = 1000,
    ) -> None:
        key = api_key or os.environ.get("OPENAI_API_KEY")
        if not key:
            raise RuntimeError("OPENAI_API_KEY is required for OpenAIAdapter.")
        self.client = OpenAI(api_key=key)
        self.model = model or os.environ.get("OPENAI_MODEL", DEFAULT_MODEL)
        self.max_tokens = max_tokens

    def complete(self, prompt: str, *, system: str | None = None) -> str:
        messages: list[dict[str, str]] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})
        response = self.client.chat.completions.create(
            model=self.model,
            max_tokens=self.max_tokens,
            messages=messages,  # type: ignore[arg-type]
        )
        return response.choices[0].message.content or ""

    def stream(self, prompt: str, *, system: str | None = None) -> Iterator[str]:
        """Yield the completion in deltas as the model produces them.

        Deliberately NOT part of the `LanguageModel` protocol in `dira_core`.
        Streaming is a transport nicety for one interactive surface — the
        advisor drawer — and widening the port would force every adapter,
        including the deterministic canned one the seeded demo depends on, to
        grow a method the pipeline has no use for. Callers probe for it with
        `hasattr` and fall back to `complete()`.
        """
        messages: list[dict[str, str]] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})
        stream = self.client.chat.completions.create(
            model=self.model,
            max_tokens=self.max_tokens,
            messages=messages,  # type: ignore[arg-type]
            stream=True,
        )
        for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta

    def complete_json(self, prompt: str, *, system: str | None = None) -> dict[str, Any]:
        messages: list[dict[str, str]] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})
        response = self.client.chat.completions.create(
            model=self.model,
            max_tokens=self.max_tokens,
            response_format={"type": "json_object"},
            messages=messages,  # type: ignore[arg-type]
        )
        text = response.choices[0].message.content or "{}"
        parsed = json.loads(text)
        if not isinstance(parsed, dict):
            raise ValueError("Model did not return a JSON object")
        return parsed

    def complete_with_tools(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        *,
        system: str | None = None,
    ) -> ToolTurn:
        request_messages: list[dict[str, Any]] = []
        if system:
            request_messages.append({"role": "system", "content": system})
        for message in messages:
            if message.get("role") == "assistant" and message.get("tool_calls"):
                request_messages.append(
                    {
                        **message,
                        "tool_calls": [
                            {
                                "id": call["id"],
                                "type": "function",
                                "function": {
                                    "name": call["name"],
                                    "arguments": json.dumps(call["arguments"]),
                                },
                            }
                            for call in message["tool_calls"]
                        ],
                    }
                )
            else:
                request_messages.append(message)
        response = self.client.chat.completions.create(
            model=self.model,
            max_tokens=self.max_tokens,
            messages=request_messages,  # type: ignore[arg-type]
            tools=tools,  # type: ignore[arg-type]
        )
        message = response.choices[0].message
        calls = tuple(
            ToolCall(
                name=call.function.name,
                arguments=json.loads(call.function.arguments or "{}"),
            )
            for call in (message.tool_calls or [])
        )
        return ToolTurn(text=message.content or "", tool_calls=calls)

    def stream_with_tools(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        *,
        system: str | None = None,
    ) -> Iterator[tuple[str, Any]]:
        """Yield ("delta", text) chunks as they arrive and, once the stream
        ends, exactly one ("tool_calls", tuple[ToolCall, ...]).

        Deliberately NOT part of any `dira_core` protocol — same rationale as
        `stream()` above. OpenAI streams a tool call's arguments as fragments
        keyed by index, so they must be concatenated before they parse as
        JSON; nothing is dispatched until the stream ends and every fragment
        for a given call has arrived.
        """
        request_messages: list[dict[str, Any]] = []
        if system:
            request_messages.append({"role": "system", "content": system})
        for message in messages:
            if message.get("role") == "assistant" and message.get("tool_calls"):
                request_messages.append(
                    {
                        **message,
                        "tool_calls": [
                            {
                                "id": call["id"],
                                "type": "function",
                                "function": {
                                    "name": call["name"],
                                    "arguments": json.dumps(call["arguments"]),
                                },
                            }
                            for call in message["tool_calls"]
                        ],
                    }
                )
            else:
                request_messages.append(message)
        stream = self.client.chat.completions.create(
            model=self.model,
            max_tokens=self.max_tokens,
            messages=request_messages,  # type: ignore[arg-type]
            tools=tools,  # type: ignore[arg-type]
            stream=True,
        )
        pending: dict[int, dict[str, Any]] = {}
        for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            if delta.content:
                yield ("delta", delta.content)
            for call_delta in delta.tool_calls or []:
                entry = pending.setdefault(
                    call_delta.index, {"name": None, "arguments": ""}
                )
                if call_delta.function and call_delta.function.name:
                    entry["name"] = call_delta.function.name
                if call_delta.function and call_delta.function.arguments:
                    entry["arguments"] += call_delta.function.arguments
        calls = tuple(
            ToolCall(name=entry["name"], arguments=json.loads(entry["arguments"] or "{}"))
            for _, entry in sorted(pending.items())
            if entry["name"]
        )
        yield ("tool_calls", calls)
