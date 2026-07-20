"""API request/response contracts (Pydantic v2). The web app mirrors these types."""

from __future__ import annotations

from pydantic import BaseModel, Field


class AlertDraftRequest(BaseModel):
    language: str = "sw"


class AlertDraftResponse(BaseModel):
    id: str
    status: str
    draft_text: str
    language: str


class ApproveRequest(BaseModel):
    # The human gate: an approver is REQUIRED. Absent -> 422 (and the DB CHECK also enforces).
    approved_by: str = Field(min_length=1)


class ApproveResponse(BaseModel):
    alert_id: str
    status: str
    deliveries_created: int


class WebhookResult(BaseModel):
    ok: bool = True
    applied: bool = False
