"""Widen hazard_bulletins.hazard_type to include geological hazards.

Revision ID: 0004_geological_hazards
Revises: 0003_forecast_window_advisor
"""

from __future__ import annotations

from alembic import op

revision: str = "0004_geological_hazards"
down_revision: str | None = "0003_forecast_window_advisor"
branch_labels = None
depends_on = None

_ALL = "('locust', 'flood', 'heat', 'drought', 'earthquake', 'volcanic', 'landslide')"
_OLD = "('locust', 'flood', 'heat', 'drought')"


def upgrade() -> None:
    op.execute(
        "ALTER TABLE hazard_bulletins DROP CONSTRAINT IF EXISTS hazard_bulletins_hazard_type_check"
    )
    op.execute(
        "ALTER TABLE hazard_bulletins ADD CONSTRAINT hazard_bulletins_hazard_type_check "
        f"CHECK (hazard_type IN {_ALL})"
    )


def downgrade() -> None:
    op.execute(
        "DELETE FROM hazard_bulletins "
        "WHERE hazard_type IN ('earthquake', 'volcanic', 'landslide')"
    )
    op.execute(
        "ALTER TABLE hazard_bulletins DROP CONSTRAINT IF EXISTS hazard_bulletins_hazard_type_check"
    )
    op.execute(
        "ALTER TABLE hazard_bulletins ADD CONSTRAINT hazard_bulletins_hazard_type_check "
        f"CHECK (hazard_type IN {_OLD})"
    )
