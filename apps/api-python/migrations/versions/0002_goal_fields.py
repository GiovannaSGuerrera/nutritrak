"""Preserve goal fields previously accepted by the API."""

from alembic import op

import sqlalchemy as sa

revision = "0002_goal_fields"

down_revision = "0001_initial"

branch_labels = None

depends_on = None


def upgrade():

    op.add_column(
        "goals",
        sa.Column("category", sa.String(60), nullable=False, server_default="Hábitos"),
    )

    op.add_column(
        "goals", sa.Column("due_date", sa.String(10), nullable=False, server_default="")
    )


def downgrade():

    raise RuntimeError(
        "Preserve goal data: restore a reviewed backup or use a forward migration"
    )
