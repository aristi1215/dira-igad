"""Domain errors. Raised by pure logic; adapters translate them at the edges."""

from __future__ import annotations


class DomainError(Exception):
    """Base class for all domain-rule violations."""


class InvalidTransition(DomainError):
    """A state machine was asked to make a transition that is not permitted."""


class HumanGateViolation(DomainError):
    """An alert would reach a dispatchable state without a human approver."""
