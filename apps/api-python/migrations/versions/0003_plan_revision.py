"""Optimistic concurrency for clinical plan editing."""

from alembic import op
import sqlalchemy as sa

revision = "0003_plan_revision"
down_revision = "0002_goal_fields"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "meal_plans",
        sa.Column("revision", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade():
    raise RuntimeError("Use a reviewed forward migration or restore")
