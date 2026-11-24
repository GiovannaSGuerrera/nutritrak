"""Regressions use synthetic records in a disposable database only."""

import os
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4, UUID
import pytest

if not os.getenv("DATABASE_URL"):
    pytest.skip("Disposable PostgreSQL required", allow_module_level=True)
from fastapi.testclient import TestClient
from app.main import app
from app.database import Base, engine, SessionLocal
from app.models import Membership, Patient


@pytest.fixture(scope="module", autouse=True)
def schema():
    Base.metadata.create_all(engine)


def professional():
    client = TestClient(app, headers={"origin": "http://localhost:8080"})
    response = client.post(
        "/api/register",
        json={
            "name": "Synthetic",
            "email": f"{uuid4().hex}@example.com",
            "password": "synthetic-professional-password",
        },
    )
    assert response.status_code == 201
    return client, response.json()


def patient(client):
    response = client.post(
        "/api/patients",
        json={
            "name": "Synthetic",
            "email": f"{uuid4().hex}@example.com",
            "clinicalNotes": "SYNTHETIC_CONFIDENTIAL",
        },
    )
    assert response.status_code == 201
    return response.json()["patient"]


@pytest.mark.parametrize("role", ["assistant", "operations_admin", "owner_admin"])
def test_admin_projection_excludes_all_clinical_properties(role):
    owner, identity = professional()
    p = patient(owner)
    admin, target = professional()
    ws = UUID(identity["activeWorkspaceId"])
    with SessionLocal() as db:
        db.add(
            Membership(
                user_id=UUID(target["user"]["id"]), workspace_id=ws, roles=[role]
            )
        )
        row = db.get(Patient, UUID(p["id"]))
        row.profile = {**row.profile, "futurePrivateField": "SYNTHETIC_PRIVATE"}
        db.commit()
    assert (
        admin.post(
            "/api/workspaces/select",
            json={"workspaceId": str(ws), "experience": "administrative"},
        ).status_code
        == 200
    )
    for response in [admin.get("/api/patients"), admin.get(f"/api/patients/{p['id']}")]:
        assert response.status_code == 200
        assert "SYNTHETIC_CONFIDENTIAL" not in response.text
        assert "SYNTHETIC_PRIVATE" not in response.text
        assert "clinicalNotes" not in response.text


def test_archive_real_ui_status_revokes_portal_and_two_tenant_mutations():
    owner, _ = professional()
    p = patient(owner)
    invitation = owner.post(f"/api/patients/{p['id']}/invitations").json()
    portal = TestClient(app, headers={"origin": "http://localhost:8080"})
    credentials = {"email": p["email"], "password": "synthetic-patient-password"}
    assert (
        portal.post(
            "/api/patient/activate", json={**credentials, "token": invitation["token"]}
        ).status_code
        == 201
    )
    other, _ = professional()
    assert (
        other.patch(
            f"/api/patients/{p['id']}", json={"name": "Unauthorized"}
        ).status_code
        == 404
    )
    assert other.get(f"/api/patients/{p['id']}").status_code == 404
    assert (
        owner.patch(
            f"/api/patients/{p['id']}", json={"status": "Arquivado"}
        ).status_code
        == 200
    )
    assert portal.get("/api/patient/me").status_code == 401
    assert portal.post("/api/patient/login", json=credentials).status_code == 401


def test_plan_validation_goal_fields_and_real_metrics():
    client, _ = professional()
    p = patient(client)
    for invalid in [
        {},
        {"patientId": "invalid"},
        {"patientId": p["id"], "name": "Plan", "unapproved": "value"},
    ]:
        assert client.post("/api/meal-plans", json=invalid).status_code in {400, 422}
    meal = {
        "name": "Lunch",
        "items": [
            {"food": "Rice", "quantity": 1, "unit": "portion"},
            {"food": "Beans"},
        ],
    }
    plan = client.post(
        "/api/meal-plans", json={"patientId": p["id"], "name": "Plan", "meals": [meal]}
    )
    assert plan.status_code == 201
    assert (
        client.post(
            f"/api/meal-plans/{plan.json()['mealPlan']['id']}/publish",
            json={"expectedRevision": plan.json()["mealPlan"]["revision"]},
        ).status_code
        == 400
    )
    goal = client.post(
        "/api/goals",
        json={
            "patientId": p["id"],
            "description": "Synthetic goal",
            "category": "Hidratação",
            "dueDate": "2026-12-31",
        },
    )
    assert goal.status_code == 201
    assert goal.json()["goal"]["category"] == "Hidratação"
    assert goal.json()["goal"]["dueDate"] == "2026-12-31"
    assert client.get("/api/dashboard").json()["newThisMonth"] == 1


def test_reset_token_is_consumed_once_under_parallel_transactions():
    owner, _ = professional()
    p = patient(owner)
    invitation = owner.post(f"/api/patients/{p['id']}/invitations").json()
    portal = TestClient(app, headers={"origin": "http://localhost:8080"})
    assert (
        portal.post(
            "/api/patient/activate",
            json={
                "token": invitation["token"],
                "email": p["email"],
                "password": "synthetic-patient-password",
            },
        ).status_code
        == 201
    )
    token = owner.post(f"/api/patients/{p['id']}/password-resets").json()["token"]

    def complete(number):
        with TestClient(app, headers={"origin": "http://localhost:8080"}) as client:
            return client.post(
                "/api/patient/password-resets/complete",
                json={"token": token, "password": f"synthetic-new-password-{number}"},
            ).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(complete, [1, 2])) == [200, 400]
    assert portal.get("/api/patient/me").status_code == 401


def test_cookie_origin_and_invalid_body_limits():
    client, _ = professional()
    assert (
        client.post(
            "/api/patients",
            json={"name": "Synthetic"},
            headers={"origin": "https://untrusted.invalid"},
        ).status_code
        == 403
    )
    assert (
        client.post(
            "/api/patients", json={"name": "Synthetic", "unknown": 1}
        ).status_code
        == 422
    )
    assert client.post("/api/patients", content=b"x" * 1000001).status_code == 413


def test_plan_revision_and_reactivation_conflicts():
    from datetime import datetime, timedelta, timezone

    owner, _ = professional()
    p = patient(owner)
    content = {
        "patientId": p["id"],
        "name": "Synthetic plan",
        "meals": [
            {
                "name": "Lunch",
                "items": [{"food": "Rice", "quantity": 1, "unit": "portion"}],
            }
        ],
    }
    plan = owner.post("/api/meal-plans", json=content).json()["mealPlan"]
    route = f"/api/meal-plans/{plan['id']}"
    assert owner.put(route + "/draft", json=content).status_code == 428

    def save(number):
        with TestClient(
            app,
            headers={"origin": "http://localhost:8080"},
            cookies=dict(owner.cookies),
        ) as client:
            return client.put(
                route + "/draft",
                json={
                    **content,
                    "expectedRevision": plan["revision"],
                    "name": f"Synthetic edit {number}",
                },
            ).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(save, [1, 2])) == [200, 409]
    assert (
        owner.post(route + "/publish", json={"expectedRevision": 0}).status_code == 409
    )
    assert (
        owner.post(route + "/publish", json={"expectedRevision": 1}).status_code == 200
    )
    appointment = {
        "patientId": p["id"],
        "start": (datetime.now(timezone.utc) + timedelta(days=2)).isoformat(),
        "duration": 50,
    }
    first = owner.post("/api/appointments", json=appointment).json()["appointment"]
    endpoint = f"/api/appointments/{first['id']}"
    assert owner.patch(endpoint, json={"status": "cancelada"}).status_code == 200
    assert owner.post("/api/appointments", json=appointment).status_code == 201
    assert owner.patch(endpoint, json={"status": "agendada"}).status_code == 409


def test_paginated_patient_queries_preserve_tenant_scope():
    owner, _ = professional()
    patient(owner)
    patient(owner)
    first = owner.get("/api/patients?limit=1&offset=0")
    second = owner.get("/api/patients?limit=1&offset=1")
    assert first.status_code == second.status_code == 200
    assert len(first.json()["patients"]) == len(second.json()["patients"]) == 1
    assert first.json()["patients"][0]["id"] != second.json()["patients"][0]["id"]
    assert first.json()["page"]["nextOffset"] == 1
    other, _ = professional()
    assert other.get("/api/patients?limit=1").json()["patients"] == []
    assert owner.get("/api/patients?limit=50000").status_code == 400
