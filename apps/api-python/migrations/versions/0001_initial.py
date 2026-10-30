"""Initial relational NutriTrack schema."""
from alembic import op
from app import models
from app.database import Base

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None

def upgrade():
    # Tables are declared in SQLAlchemy metadata; this creates only missing tables.
    Base.metadata.create_all(bind=op.get_bind())

def downgrade():
    # Deliberately non-destructive. Table removal requires an explicit reviewed migration.
    raise RuntimeError("Initial schema downgrade is intentionally disabled; restore a database backup instead.")
