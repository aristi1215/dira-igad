"""Which wording each recipient gets.

A pure rule, tested without a database — the same reason `combine_scores` lives
in core rather than in the API.
"""

from __future__ import annotations

from dira_core.alerts import AlertVariant, resolve_alert_body

ALERT_BODY = "Tahadhari ya hali."


def _resolve(
    variants: list[AlertVariant],
    *,
    language: str | None = "sw",
    role: str | None = None,
    alert_language: str = "sw",
):
    return resolve_alert_body(
        variants,
        recipient_language=language,
        recipient_role=role,
        alert_language=alert_language,
        alert_body_text=ALERT_BODY,
    )


def test_language_and_role_beats_language_alone() -> None:
    resolved = _resolve(
        [
            AlertVariant("so", "Digniin guud"),
            AlertVariant("so", "Digniin xoolaha", role="livestock_officer"),
        ],
        language="so",
        role="livestock_officer",
    )

    assert resolved.body_text == "Digniin xoolaha"
    assert resolved.matched == "language+role"


def test_role_without_a_match_falls_back_to_the_language() -> None:
    resolved = _resolve(
        [AlertVariant("so", "Digniin guud")], language="so", role="chief"
    )

    assert resolved.body_text == "Digniin guud"
    assert resolved.matched == "language"


def test_unknown_language_falls_back_to_the_alert_language_variant() -> None:
    resolved = _resolve(
        [AlertVariant("sw", "Toleo la Kiswahili")],
        language="am",
        alert_language="sw",
    )

    assert resolved.body_text == "Toleo la Kiswahili"
    assert resolved.matched == "alert-language"


def test_no_variants_at_all_behaves_exactly_as_before_variants_existed() -> None:
    resolved = _resolve([], language="so")

    assert resolved.body_text == ALERT_BODY
    assert resolved.matched == "default"
    assert resolved.is_fallback is True


def test_the_alerts_own_language_is_not_a_fallback() -> None:
    """A Swahili speaker receiving the Swahili body is served, not shortchanged.

    Treating this as a fallback would flag every recipient of every fresh alert,
    and a warning that is always on is not a warning.
    """
    resolved = _resolve([], language="sw", alert_language="sw")

    assert resolved.matched == "default"
    assert resolved.is_fallback is False


def test_a_recipient_with_no_language_uses_the_alert_language() -> None:
    resolved = _resolve(
        [AlertVariant("sw", "Toleo la Kiswahili"), AlertVariant("en", "English")],
        language=None,
        alert_language="sw",
    )

    assert resolved.body_text == "Toleo la Kiswahili"
    assert resolved.matched == "language"


def test_region_suffixes_do_not_defeat_matching() -> None:
    """'sw-KE' and 'sw' are the same language for wording purposes."""
    resolved = _resolve([AlertVariant("sw-KE", "Toleo")], language="sw")

    assert resolved.matched == "language"
    assert resolved.body_text == "Toleo"


def test_a_role_variant_is_never_served_to_a_recipient_without_that_role() -> None:
    """Otherwise a livestock briefing could reach a health worker."""
    resolved = _resolve(
        [AlertVariant("so", "Digniin xoolaha", role="livestock_officer")],
        language="so",
        role="health_worker",
        alert_language="sw",
    )

    assert resolved.body_text == ALERT_BODY
    assert resolved.matched == "default"
