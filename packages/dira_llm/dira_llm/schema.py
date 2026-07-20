"""Pydantic contracts for LLM I/O. Anything off-schema is invalid (treated as no output)."""

from __future__ import annotations

from pydantic import BaseModel, Field


class SignalOut(BaseModel):
    signal_type: str = Field(min_length=1, max_length=64)
    zone_id: str | None = None
    summary: str = Field(min_length=1, max_length=500)


class ExtractionOut(BaseModel):
    signals: list[SignalOut] = Field(default_factory=list)
