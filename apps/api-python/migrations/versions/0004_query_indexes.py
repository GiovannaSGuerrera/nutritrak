"""Indexes for bounded tenant lists and rate counters."""

from alembic import op

revision = "0004_query_indexes"
down_revision = "0003_plan_revision"
branch_labels = None
depends_on = None


def upgrade():
    op.create_index("ix_patients_workspace_name", "patients", ["workspace_id", "name"])
    op.create_index(
        "ix_rate_bucket_created", "rate_limit_hits", ["bucket", "created_at"]
    )


def downgrade():
    op.drop_index("ix_rate_bucket_created", table_name="rate_limit_hits")
    op.drop_index("ix_patients_workspace_name", table_name="patients")
