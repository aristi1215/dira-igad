from __future__ import annotations

from dira_dispatch.mock import MockDispatcher


def test_mock_dispatcher_records_deterministic_calls() -> None:
    dispatcher = MockDispatcher()

    first = dispatcher.call("+254700000001", "file:///tmp/alert.wav", "idem-1")
    second = dispatcher.call("+254700000001", "file:///tmp/alert.wav", "idem-1")

    assert first.provider_message_id == second.provider_message_id
    assert len(dispatcher.calls) == 2
    assert dispatcher.calls[0].idem_key == "idem-1"
