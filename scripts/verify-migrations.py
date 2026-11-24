"""Migration preservation test. Requires a new, explicitly disposable database."""
import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4
import psycopg

url = os.environ.get("DATABASE_URL", "")
if os.environ.get("TEST_DATABASE_CONFIRM") != "disposable" or not urlsplit(url).path.endswith("_test"):
    raise SystemExit("Use an explicitly disposable database ending in _test")
root = Path(__file__).resolve().parents[1]
connection = url.replace("postgresql+psycopg://", "postgresql://", 1)
with psycopg.connect(connection) as db:
    assert not db.execute("SELECT tablename FROM pg_tables WHERE schemaname='public'").fetchall(), "A new empty test database is required; no data was removed"

def migrate(*args):
    subprocess.run([sys.executable, "-m", "alembic", *args], cwd=root / "apps/api-python", check=True)

migrate("upgrade", "0001_initial")
user, workspace, patient, goal = [uuid4() for _ in range(4)]
with psycopg.connect(connection) as db:
    db.execute("INSERT INTO users(id,name,email,password_hash,created_at) VALUES(%s,%s,%s,%s,now())", (user, "Synthetic", f"{user}@example.invalid", "synthetic-not-a-login-hash"))
    db.execute("INSERT INTO workspaces(id,name,kind,created_at) VALUES(%s,%s,%s,now())", (workspace, "Synthetic", "personal"))
    db.execute("INSERT INTO patients(id,workspace_id,created_by,name,email,phone,birth_date,status,profile,created_at) VALUES(%s,%s,%s,%s,'','','','ativo','{}',now())", (patient, workspace, user, "Synthetic"))
    db.execute("INSERT INTO goals(id,workspace_id,patient_id,created_by,description,status,progress) VALUES(%s,%s,%s,%s,%s,'ativa','[]')", (goal, workspace, patient, user, "SYNTHETIC_PRESERVED"))
migrate("upgrade", "head")
migrate("check")
with psycopg.connect(connection) as db:
    row = db.execute("SELECT description,category,due_date FROM goals WHERE id=%s", (goal,)).fetchone()
    assert row == ("SYNTHETIC_PRESERVED", "Hábitos", "")
    assert db.execute("SELECT version_num FROM alembic_version").fetchone()[0] == "0004_query_indexes"
print("PASS: baseline data preserved through 0001 -> 0004; schema matches metadata")
