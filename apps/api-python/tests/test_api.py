"""Integration checks run against the PostgreSQL service configured by DATABASE_URL."""
import os
import pytest
from uuid import uuid4
from datetime import datetime, timedelta, timezone
from fastapi.testclient import TestClient

if not os.getenv("DATABASE_URL"):
    pytest.skip("Set DATABASE_URL to a disposable PostgreSQL test database", allow_module_level=True)
from app.main import app
from app.database import Base, engine, SessionLocal
from app.models import ServerSession
from app.security import utcnow

@pytest.fixture(scope="module", autouse=True)
def schema():
    Base.metadata.create_all(engine)
    yield

def test_register_cookie_patients_and_logout():
    client=TestClient(app,headers={"origin":"http://localhost:8080"})
    email=f"{uuid4().hex}@example.com"
    response=client.post("/api/register",json={"name":"Teste Sintético","email":email,"password":"senha-ficticia-longa-123"})
    assert response.status_code==201
    assert "httponly" in response.headers["set-cookie"].lower()
    assert client.post("/api/login",json={"email":email,"password":"senha-incorreta-longa"}).status_code==401
    patient=client.post("/api/patients",json={"name":"Paciente Fictício","email":"paciente@example.invalid"})
    assert patient.status_code==201
    pid=patient.json()["patient"]["id"]
    assert client.get(f"/api/patients/{pid}").status_code==200
    assert client.post("/api/logout").status_code==200
    assert client.get("/api/patients").status_code==401

def test_login_rejects_wrong_password():
    client=TestClient(app)
    response=client.post("/api/login",json={"email":f"{uuid4().hex}@example.com","password":"senha-incorreta-longa"})
    assert response.status_code==401

def test_expired_server_session_is_rejected():
    client=TestClient(app,headers={"origin":"http://localhost:8080"})
    client.post("/api/register",json={"name":"Sessão Sintética","email":f"{uuid4().hex}@example.com","password":"senha-sintetica-longa-004"})
    sid=client.cookies.get("nc_session")
    with SessionLocal() as db:
        session=db.get(ServerSession,sid)
        session.expires_at=utcnow()-timedelta(seconds=1)
        db.commit()
    assert client.get("/api/me").status_code==401

def test_workspace_isolation_and_appointment_conflict():
    client=TestClient(app,headers={"origin":"http://localhost:8080"})
    client2=TestClient(app,headers={"origin":"http://localhost:8080"})
    client.post("/api/register",json={"name":"Profissional Um","email":f"{uuid4().hex}@example.com","password":"senha-sintetica-longa-001"})
    patient=client.post("/api/patients",json={"name":"Paciente Sintético"}).json()["patient"]
    foreign=client2.post("/api/register",json={"name":"Profissional Dois","email":f"{uuid4().hex}@example.com","password":"senha-sintetica-longa-002"})
    assert foreign.status_code==201
    assert client2.get(f"/api/patients/{patient['id']}").status_code==404
    assert client2.get(f"/api/patients/{patient['id']}",headers={"x-workspace-id":patient["workspaceId"]}).status_code==403
    start=(datetime.now(timezone.utc)+timedelta(days=3)).isoformat()
    body={"patientId":patient["id"],"start":start,"duration":50}
    assert client.post("/api/appointments",json=body).status_code==201
    assert client.post("/api/appointments",json=body).status_code==409

def test_portal_published_plan_and_terminal_revocation():
    professional=TestClient(app,headers={"origin":"http://localhost:8080"})
    professional.post("/api/register",json={"name":"Nutricionista Sintética","email":f"{uuid4().hex}@example.com","password":"senha-sintetica-longa-003"})
    email=f"{uuid4().hex}@example.com"
    patient=professional.post("/api/patients",json={"name":"Paciente Portal","email":email}).json()["patient"]
    invitation=professional.post(f"/api/patients/{patient['id']}/invitations").json()
    portal=TestClient(app,headers={"origin":"http://localhost:8080"})
    assert portal.post("/api/patient/invitations/validate",json={"token":invitation["token"]}).status_code==200
    activated=portal.post("/api/patient/activate",json={"token":invitation["token"],"email":email,"password":"senha-do-portal-sintetica"})
    assert activated.status_code==201
    assert portal.get("/api/patient/me").json()["portal"]["mealPlans"]==[]
    plan=professional.post("/api/meal-plans",json={"patientId":patient["id"],"name":"Plano teste","meals":[{"name":"Almoço","items":[{"food":"Arroz","quantity":1,"unit":"porção"}]}]})
    assert plan.status_code==201
    plan_id=plan.json()["mealPlan"]["id"]
    assert professional.post(f"/api/meal-plans/{plan_id}/publish").status_code==200
    assert len(portal.get("/api/patient/me").json()["portal"]["mealPlans"])==1
    assert professional.patch(f"/api/patients/{patient['id']}/portal-access",json={"status":"suspended"}).status_code==200
    assert portal.get("/api/patient/me").status_code==401
    assert professional.patch(f"/api/patients/{patient['id']}/portal-access",json={"status":"active"}).status_code==200
    assert portal.post("/api/patient/login",json={"email":email,"password":"senha-do-portal-sintetica"}).status_code==200
    assert professional.patch(f"/api/patients/{patient['id']}/portal-access",json={"status":"revoked"}).status_code==200
    assert professional.patch(f"/api/patients/{patient['id']}/portal-access",json={"status":"active"}).status_code==409
