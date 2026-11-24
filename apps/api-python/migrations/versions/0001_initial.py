"""Initial relational NutriTrack schema."""

from alembic import op

from pathlib import Path

revision = "0001_initial"

down_revision = None

branch_labels = None

depends_on = None


def upgrade():

    sql = Path(__file__).with_name("0001_schema.sql").read_text(encoding="utf-8")

    for statement in sql.split(";"):

        if statement.strip():
            op.execute(statement)


def downgrade():

    # Deliberately non-destructive. Table removal requires an explicit reviewed migration.

    raise RuntimeError(
        "Initial schema downgrade is intentionally disabled; restore a database backup instead."
    )
