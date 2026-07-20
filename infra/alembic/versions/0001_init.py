"""Initial schema — executes the authoritative DDL in infra/migrations/001_init.sql.

The DDL lives in a single SQL file so that Alembic and docker-compose's initdb mount share
one source of truth (DIRA-SPEC.md §5).

Revision ID: 0001_init
Revises:
Create Date: 2026-01-01
"""
from __future__ import annotations

from pathlib import Path

from alembic import op

revision = "0001_init"
down_revision = None
branch_labels = None
depends_on = None

_DDL = Path(__file__).resolve().parents[2] / "migrations" / "001_init.sql"


def upgrade() -> None:
    op.execute(_DDL.read_text())


def downgrade() -> None:
    # Whole-schema teardown (dev only). Order-independent via CASCADE.
    op.execute(
        """
        DROP VIEW IF EXISTS v_map_situations;
        DROP TABLE IF EXISTS deliveries, recipients, alerts, exposure_snapshots, assessments,
            situations, model_versions, news_signals, news_documents, acled_events,
            zone_climate_dekadal, zone_exposure, zone_adjacency, zones, clusters CASCADE;
        DROP FUNCTION IF EXISTS notify_dira_event() CASCADE;
        """
    )
