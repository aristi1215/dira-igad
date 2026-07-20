"""Data adapters: seeded (disk) + live (network), swapped together by DATA_MODE.

Ingestion adapters return raw rows carrying their bitemporal ``available_at`` so E1 can upsert
first-write-wins. The pure model/LLM/voice ports live in ``dira_core.ports``.
"""
