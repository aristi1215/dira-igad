"""In-memory voice dispatcher for seeded demos and tests."""

from __future__ import annotations

import logging
import threading
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from dira_core.ports import ProviderRef

logger = logging.getLogger(__name__)


@dataclass
class MockCall:
    phone: str
    audio_url: str
    idem_key: str
    provider_message_id: str


@dataclass
class MockDispatcher:
    """VoiceChannel that records calls and can simulate asynchronous acks."""

    ack_callback: Callable[[ProviderRef], None] | None = None
    ack_delay_seconds: float | None = None
    database_url: str | None = None
    calls: list[MockCall] = field(default_factory=list)

    def call(self, phone: str, audio_url: str, idem_key: str) -> ProviderRef:
        provider_message_id = f"mock-{uuid.uuid5(uuid.NAMESPACE_URL, idem_key)}"
        call = MockCall(
            phone=phone,
            audio_url=audio_url,
            idem_key=idem_key,
            provider_message_id=provider_message_id,
        )
        self.calls.append(call)
        ref = ProviderRef(provider_message_id=provider_message_id, raw=_raw(call))

        # When database_url is set, the dispatch worker schedules _db_ack AFTER
        # provider_message_id is durable — so call() itself does not auto-ack.
        callback = self.ack_callback
        if callback is not None:
            if self.ack_delay_seconds is None or self.ack_delay_seconds <= 0:
                callback(ref)
            else:
                timer = threading.Timer(self.ack_delay_seconds, callback, args=(ref,))
                timer.daemon = True
                timer.start()
        return ref

    def _db_ack(self, ref: ProviderRef) -> None:
        """Simulate keypad '1' ack after a successful seeded call."""
        assert self.database_url is not None
        try:
            import psycopg

            with psycopg.connect(self.database_url) as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        UPDATE deliveries
                        SET ack_status = 'acknowledged',
                            ack_method = 'dtmf_1',
                            status = 'delivered',
                            updated_at = now()
                        WHERE provider_message_id = %s
                        """,
                        (ref.provider_message_id,),
                    )
                conn.commit()
            logger.info("Mock ack written for %s", ref.provider_message_id)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Mock ack failed: %s", exc)


def _raw(call: MockCall) -> dict[str, Any]:
    return {
        "phone": call.phone,
        "audio_url": call.audio_url,
        "idem_key": call.idem_key,
        "provider_message_id": call.provider_message_id,
    }
