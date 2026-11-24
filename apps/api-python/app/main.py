import os, re, math, json
from datetime import datetime, timedelta, timezone, date as DateValue
from zoneinfo import ZoneInfo
from uuid import UUID
from fastapi import FastAPI, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, Field, ConfigDict
from sqlalchemy import select, func, delete
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from .database import get_db, SessionLocal
from .models import (
    User,
    Workspace,
    Membership,
    Patient,
    PatientAssignment,
    Assessment,
    Appointment,
    Goal,
    MealPlan,
    ServerSession,
    PatientAccount,
    Token,
    RateLimitHit,
)
from .security import (
    hash_password,
    verify_password,
    new_session_id,
    session_expiry,
    utcnow,
    digest_token,
)
import secrets
import hashlib

app = FastAPI(
    title="NutriTrack API",
    version="1.0.0",
    docs_url=None if os.getenv("APP_ENV") == "production" else "/docs",
    redoc_url=None if os.getenv("APP_ENV") == "production" else "/redoc",
    openapi_url=None if os.getenv("APP_ENV") == "production" else "/openapi.json",
)
origins = [
    x.strip()
    for x in os.getenv("CORS_ORIGINS", "http://localhost:8080").split(",")
    if x.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "X-Workspace-Id", "X-CSRF-Token"],
)
COOKIE = "nc_session"
PATIENT_COOKIE = "nt_patient_session"
SECURE = (
    os.getenv(
        "SESSION_COOKIE_SECURE",
        "true" if os.getenv("APP_ENV") == "production" else "false",
    ).lower()
    == "true"
)
if os.getenv("APP_ENV") == "production" and not SECURE:
    raise RuntimeError("SESSION_COOKIE_SECURE must be true in production")
if os.getenv("APP_ENV") == "production" and (
    not os.getenv("CORS_ORIGINS") or "*" in origins
):
    raise RuntimeError("Set explicit CORS_ORIGINS in production")


@app.middleware("http")
async def check_cookie_origin(request: Request, call_next):
    if request.method in {"POST", "PUT", "PATCH", "DELETE"} and request.headers.get(
        "cookie"
    ):
        origin = request.headers.get("origin")
        allowed = set(origins)
        if os.getenv("APP_ENV") != "production":
            allowed.add(f"{request.url.scheme}://{request.url.netloc}")
        if not origin or origin not in allowed:
            return Response(
                content='{"error":"Origem não autorizada."}',
                status_code=403,
                media_type="application/json",
            )
    return await call_next(request)


class StrictInput(BaseModel):
    model_config = ConfigDict(
        extra="forbid", str_strip_whitespace=True, allow_inf_nan=False
    )


class AuthInput(StrictInput):
    email: EmailStr
    password: str = Field(min_length=12, max_length=200)
    name: str | None = Field(default=None, min_length=1, max_length=120)
    profileType: str = "personal"
    workspaceName: str = ""
    clinician: bool = True


class PatientInput(StrictInput):
    name: str = Field(min_length=1, max_length=150)
    email: str = Field(default="", max_length=254)
    phone: str = Field(default="", max_length=80)
    birthDate: str = ""
    status: str = "ativo"
    objective: str = Field(default="", max_length=1000)
    clinicalNotes: str = Field(default="", max_length=4000)
    primaryProfessionalId: UUID | None = None
    supportProfessionalIds: list[UUID] = Field(default_factory=list, max_length=10)


class AssessmentInput(StrictInput):
    patientId: UUID
    date: DateValue | None = None
    weight: float | None = Field(default=None, gt=0, le=500)
    height: float | None = Field(default=None, gt=0, le=280)
    fat: float | None = Field(default=None, ge=0, le=100)
    waist: float | None = Field(default=None, ge=0, le=500)
    hip: float | None = Field(default=None, ge=0, le=500)
    method: str = Field(default="", max_length=200)
    notes: str = Field(default="", max_length=2000)


class AppointmentInput(StrictInput):
    patientId: UUID
    start: datetime
    duration: int = Field(default=50, ge=15, le=240)
    type: str = "Presencial"
    notes: str = Field(default="", max_length=2000)


class GoalInput(StrictInput):
    patientId: UUID
    description: str = Field(min_length=1, max_length=500)
    category: str = Field(default="Hábitos", max_length=60)
    dueDate: str = Field(default="", max_length=10)


def normalize_meals(meals):
    if not isinstance(meals, list) or len(meals) > 12:
        fail(400, "Um plano pode conter até 12 refeições.")
    result = []
    item_count = 0
    for meal in meals:
        if not isinstance(meal, dict):
            fail(400, "Revise as refeições do plano.")
        items = meal.get("items", [])
        if not isinstance(items, list):
            fail(400, "Revise os alimentos do plano.")
        item_count += len(items)
        if item_count > 40:
            fail(400, "Um plano pode conter até 40 alimentos.")
        clean_items = []
        for item in items:
            if not isinstance(item, dict) or not str(item.get("food", "")).strip():
                fail(400, "Informe o alimento em cada item.")
            quantity = item.get("quantity")
            if quantity not in (None, ""):
                try:
                    quantity = float(quantity)
                except (TypeError, ValueError):
                    fail(400, "Quantidade inválida.")
                if not math.isfinite(quantity) or quantity <= 0 or quantity > 100000:
                    fail(400, "Quantidade inválida.")
            clean_items.append(
                {
                    "food": str(item["food"]).strip()[:160],
                    "quantity": quantity if quantity not in (None, "") else None,
                    "unit": str(item.get("unit", ""))[:40],
                    "substitutions": str(item.get("substitutions", ""))[:500],
                }
            )
        result.append(
            {
                "name": str(meal.get("name", "Refeição"))[:100],
                "time": str(meal.get("time", ""))[:10],
                "instructions": str(meal.get("instructions", ""))[:1000],
                "items": clean_items,
            }
        )
    return result


def page_bounds(request):
    try:
        limit = int(request.query_params.get("limit", 200))
        offset = int(request.query_params.get("offset", 0))
    except ValueError:
        fail(400, "Paginação inválida.")
    if limit < 1 or limit > 200 or offset < 0:
        fail(400, "Paginação inválida.")
    return limit, offset


def sql_page(db, query, request):
    limit, offset = page_bounds(request)
    total = (
        db.scalar(select(func.count()).select_from(query.order_by(None).subquery()))
        or 0
    )
    rows = db.scalars(query.offset(offset).limit(limit)).unique().all()
    return rows, {
        "total": total,
        "nextOffset": offset + limit if offset + limit < total else None,
    }


def paged_result(name, rows, request):
    limit, offset = page_bounds(request)
    page = rows[offset : offset + limit]
    return {
        name: page,
        "page": {
            "collection": name,
            "total": len(rows),
            "nextOffset": offset + limit if offset + limit < len(rows) else None,
        },
    }


def canonical_status(value):
    result = {"ativo": "Ativo", "em pausa": "Em pausa", "arquivado": "Arquivado"}.get(
        str(value).strip().lower()
    )
    if not result:
        fail(400, "Status inválido.")
    return result


def plan_payload(payload, create=False):
    allowed = {
        "patientId",
        "name",
        "objective",
        "startDate",
        "reviewDate",
        "generalInstructions",
        "meals",
        "expectedRevision",
    }
    if set(payload) - allowed:
        fail(422, "Campos de plano não reconhecidos.")
    if create:
        try:
            UUID(str(payload.get("patientId", "")))
        except (ValueError, TypeError):
            fail(422, "Paciente inválido.")
    for key, limit in [
        ("name", 120),
        ("objective", 1000),
        ("startDate", 10),
        ("reviewDate", 10),
        ("generalInstructions", 5000),
    ]:
        if key in payload and (
            not isinstance(payload[key], str) or len(payload[key]) > limit
        ):
            fail(422, "Campo de plano inválido.")
    return {k: v for k, v in payload.items() if k in allowed - {"expectedRevision"}}


def fail(status=401, message="Não autorizado."):
    raise HTTPException(status, message)


def rate_limit(db: Session, key: str, maximum=10):
    bucket = hashlib.sha256(key.strip().lower().encode()).hexdigest()
    since = utcnow() - timedelta(minutes=15)
    db.execute(
        select(func.pg_advisory_xact_lock(func.hashtextextended("rate:" + bucket, 0)))
    )
    db.execute(delete(RateLimitHit).where(RateLimitHit.created_at < since))
    count = (
        db.scalar(
            select(func.count(RateLimitHit.id)).where(
                RateLimitHit.bucket == bucket, RateLimitHit.created_at >= since
            )
        )
        or 0
    )
    if count >= maximum:
        fail(429, "Tente novamente mais tarde.")
    db.add(RateLimitHit(bucket=bucket))
    db.commit()


def principal(request: Request, db: Session = Depends(get_db)):
    sid = request.cookies.get(COOKIE)
    row = db.get(ServerSession, sid) if sid else None
    if not row or row.revoked_at or row.expires_at <= utcnow() or not row.user_id:
        fail()
    user = db.get(User, row.user_id)
    if not user:
        fail()
    membership = db.scalar(
        select(Membership).where(
            Membership.user_id == user.id,
            Membership.workspace_id == row.workspace_id,
            Membership.active.is_(True),
        )
    )
    if not user or not membership:
        fail()
    requested = request.headers.get("x-workspace-id")
    if requested and str(row.workspace_id) != requested:
        fail(403, "Workspace não autorizado.")
    roles = set(membership.roles or [])
    return user, row, membership, roles


def patient_access(db, user, membership, patient_id, write=False):
    p = db.scalar(
        select(Patient).where(
            Patient.id == patient_id, Patient.workspace_id == membership.workspace_id
        )
    )
    if not p:
        fail(404, "Paciente não encontrado.")
    roles = set(membership.roles or [])
    assigned = db.scalar(
        select(PatientAssignment.id).where(
            PatientAssignment.patient_id == p.id,
            PatientAssignment.workspace_id == p.workspace_id,
            PatientAssignment.user_id == user.id,
        )
    )
    if not assigned:
        fail(404, "Paciente não encontrado.")
    if write and "clinician" not in roles:
        fail(403, "Permissão clínica necessária.")
    return p


def new_login(db, user, workspace, response):
    sid = new_session_id()
    db.add(
        ServerSession(
            id=sid,
            user_id=user.id,
            workspace_id=workspace.id,
            expires_at=session_expiry(),
        )
    )
    db.commit()
    response.set_cookie(
        COOKIE,
        sid,
        httponly=True,
        secure=SECURE,
        samesite="strict",
        max_age=int(os.getenv("SESSION_TTL_HOURS", "8")) * 3600,
        path="/",
    )


def portal_session(db, account, response):
    sid = new_session_id()
    db.add(
        ServerSession(
            id=sid, patient_account_id=account.id, expires_at=session_expiry()
        )
    )
    db.commit()
    response.set_cookie(
        PATIENT_COOKIE,
        sid,
        httponly=True,
        secure=SECURE,
        samesite="strict",
        max_age=int(os.getenv("SESSION_TTL_HOURS", "8")) * 3600,
        path="/",
    )


def portal_principal(request: Request, db: Session):
    sid = request.cookies.get(PATIENT_COOKIE)
    row = db.get(ServerSession, sid) if sid else None
    if (
        not row
        or row.revoked_at
        or row.expires_at <= utcnow()
        or not row.patient_account_id
    ):
        fail()
    account = db.get(PatientAccount, row.patient_account_id)
    if not account or account.access_state != "active":
        fail()
    patient = db.get(Patient, account.patient_id)
    if not patient or canonical_status(patient.status) == "Arquivado":
        fail()
    return account, patient


def portal_dto(db, account, patient):
    plans = db.scalars(
        select(MealPlan).where(
            MealPlan.patient_id == patient.id,
            MealPlan.workspace_id == patient.workspace_id,
        )
    ).all()
    result = []
    for plan in plans:
        version = next(
            (
                v
                for v in plan.versions or []
                if v.get("id") == plan.published_version_id
                and v.get("status") == "published"
            ),
            None,
        )
        if version:
            result.append({"id": str(plan.id), "name": plan.name, "version": version})
    professional = db.get(User, patient.created_by)
    return {
        "patient": {"id": str(patient.id), "name": patient.name},
        "professional": {
            "name": professional.name if professional else "Equipe NutriTrack"
        },
        "mealPlans": result,
    }


@app.get("/health")
def health(db: Session = Depends(get_db)):
    db.execute(select(1))
    return {"status": "ok"}


@app.post("/api/register", status_code=201)
def register(payload: AuthInput, response: Response, db: Session = Depends(get_db)):
    if not payload.name or not payload.name.strip():
        fail(400, "Informe seu nome.")
    rate_limit(db, str(payload.email), 5)
    email = str(payload.email).strip().lower()
    if db.scalar(select(User.id).where(User.email == email)):
        fail(409, "Não foi possível criar a conta.")
    user = User(
        name=(payload.name or "").strip(),
        email=email,
        password_hash=hash_password(payload.password),
    )
    workspace = Workspace(
        name=(
            payload.workspaceName.strip()[:160]
            if payload.workspaceName.strip()
            else f"Consultório de {user.name}"
        ),
        kind=(
            payload.profileType
            if payload.profileType in {"personal", "clinic"}
            else "personal"
        ),
    )
    roles = ["owner_admin"] + (["clinician"] if payload.clinician else [])
    db.add_all([user, workspace])
    db.flush()
    membership = Membership(user_id=user.id, workspace_id=workspace.id, roles=roles)
    db.add(membership)
    db.flush()
    sid = new_session_id()
    db.add(
        ServerSession(
            id=sid,
            user_id=user.id,
            workspace_id=workspace.id,
            expires_at=session_expiry(),
        )
    )
    db.commit()
    response.set_cookie(
        COOKIE,
        sid,
        httponly=True,
        secure=SECURE,
        samesite="strict",
        max_age=28800,
        path="/",
    )
    return {
        "user": {"id": str(user.id), "name": user.name, "email": user.email},
        "workspaces": [
            {"id": str(workspace.id), "name": workspace.name, "roles": membership.roles}
        ],
        "activeWorkspaceId": str(workspace.id),
    }


@app.post("/api/login")
def login(payload: AuthInput, response: Response, db: Session = Depends(get_db)):
    rate_limit(db, str(payload.email))
    user = db.scalar(
        select(User).where(User.email == str(payload.email).strip().lower())
    )
    if not user or not verify_password(user.password_hash, payload.password):
        fail(401, "E-mail ou senha incorretos.")
    membership = db.scalar(
        select(Membership).where(
            Membership.user_id == user.id, Membership.active.is_(True)
        )
    )
    if not membership:
        fail(403, "Conta sem workspace ativo.")
    workspace = db.get(Workspace, membership.workspace_id)
    new_login(db, user, workspace, response)
    return {
        "user": {"id": str(user.id), "name": user.name, "email": user.email},
        "workspaces": [
            {"id": str(workspace.id), "name": workspace.name, "roles": membership.roles}
        ],
        "activeWorkspaceId": str(workspace.id),
    }


@app.post("/api/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    sid = request.cookies.get(COOKIE)
    row = db.get(ServerSession, sid) if sid else None
    if row:
        row.revoked_at = utcnow()
        db.commit()
    response.delete_cookie(
        COOKIE, path="/", secure=SECURE, httponly=True, samesite="strict"
    )
    return {"ok": True}


@app.get("/api/me")
def me(ctx=Depends(principal), db: Session = Depends(get_db)):
    user, row, membership, roles = ctx
    ws = db.get(Workspace, row.workspace_id)
    memberships = db.scalars(
        select(Membership).where(
            Membership.user_id == user.id, Membership.active.is_(True)
        )
    ).all()
    return {
        "user": {"id": str(user.id), "name": user.name, "email": user.email},
        "workspaces": [
            {
                "id": str(m.workspace_id),
                "name": db.get(Workspace, m.workspace_id).name,
                "roles": m.roles,
            }
            for m in memberships
        ],
        "activeWorkspaceId": str(ws.id),
        "roles": list(roles),
    }


@app.get("/api/workspaces/legacy-preview")
def legacy_preview(ctx=Depends(principal)):
    return {"hasLegacyRecords": False, "patients": []}


@app.post("/api/workspaces/select")
def select_workspace(
    payload: dict,
    response: Response,
    ctx=Depends(principal),
    db: Session = Depends(get_db),
):
    user, row, membership, roles = ctx
    try:
        workspace_id = UUID(str(payload.get("workspaceId")))
    except ValueError:
        fail(400, "Workspace inválido.")
    target = db.scalar(
        select(Membership).where(
            Membership.user_id == user.id,
            Membership.workspace_id == workspace_id,
            Membership.active.is_(True),
        )
    )
    if not target:
        fail(403, "Workspace não autorizado.")
    if payload.get("experience") not in {"clinical", "administrative"}:
        fail(400, "Perfil inválido.")
    if payload["experience"] == "clinical" and "clinician" not in (target.roles or []):
        fail(403, "Perfil clínico não autorizado.")
    if payload["experience"] == "administrative" and not set(target.roles or []) & {
        "owner_admin",
        "operations_admin",
        "assistant",
    }:
        fail(403, "Perfil administrativo não autorizado.")
    row.workspace_id = workspace_id
    db.commit()
    ws = db.get(Workspace, workspace_id)
    return {
        "workspace": {"id": str(ws.id), "name": ws.name},
        "membership": {"roles": target.roles},
        "experience": payload["experience"],
    }


@app.get("/api/dashboard")
def dashboard(ctx=Depends(principal), db: Session = Depends(get_db)):
    user, row, membership, roles = ctx
    ws = membership.workspace_id
    patients = db.scalars(select(Patient).where(Patient.workspace_id == ws)).all()
    assigned = set(
        db.scalars(
            select(PatientAssignment.patient_id).where(
                PatientAssignment.user_id == user.id,
                PatientAssignment.workspace_id == ws,
            )
        ).all()
    )
    patients = [p for p in patients if p.id in assigned]
    appointments = db.scalars(
        select(Appointment)
        .where(Appointment.workspace_id == ws, Appointment.start_at >= utcnow())
        .order_by(Appointment.start_at)
    ).all()
    appointments = [a for a in appointments if a.patient_id in assigned][:10]
    total_assessments = (
        db.scalar(
            select(func.count(Assessment.id)).where(
                Assessment.workspace_id == ws, Assessment.patient_id.in_(assigned)
            )
        )
        if assigned
        else 0
    )
    total_assessments = total_assessments or 0
    active = sum(1 for p in patients if canonical_status(p.status) == "Ativo")
    assessed = (
        set(
            db.scalars(
                select(Assessment.patient_id).where(
                    Assessment.workspace_id == ws, Assessment.patient_id.in_(assigned)
                )
            ).all()
        )
        if assigned
        else set()
    )
    names = {p.id: p.name for p in patients}
    current = utcnow()
    month = current.strftime("%Y-%m")
    months = []
    for delta in range(5, -1, -1):
        index = current.year * 12 + current.month - 1 - delta
        year, mi = divmod(index, 12)
        key = f"{year:04}-{mi+1:02}"
        months.append(
            {
                "month": key,
                "label": [
                    "jan",
                    "fev",
                    "mar",
                    "abr",
                    "mai",
                    "jun",
                    "jul",
                    "ago",
                    "set",
                    "out",
                    "nov",
                    "dez",
                ][mi],
                "total": sum(p.created_at.strftime("%Y-%m") == key for p in patients),
            }
        )
    return {
        "patients": len(patients),
        "activePatients": active,
        "totalAssessments": total_assessments,
        "activeWithoutAssessment": sum(
            1
            for p in patients
            if canonical_status(p.status) == "Ativo" and p.id not in assessed
        ),
        "newThisMonth": sum(p.created_at.strftime("%Y-%m") == month for p in patients),
        "newPatientsByMonth": months,
        "upcoming": [
            {
                "id": str(a.id),
                "patientId": str(a.patient_id),
                "patientName": names.get(a.patient_id, ""),
                "start": a.start_at.isoformat(),
                "end": a.end_at.isoformat(),
                "status": a.status,
                "type": a.data.get("type", "Presencial"),
            }
            for a in appointments
        ],
        "recent": [
            {
                "id": str(p.id),
                "action": "patient_created",
                "type": "patient",
                "at": p.created_at.isoformat(),
            }
            for p in sorted(patients, key=lambda p: p.created_at, reverse=True)[:8]
        ],
    }


@app.get("/api/clinicians")
def list_clinicians(ctx=Depends(principal), db: Session = Depends(get_db)):
    user, row, membership, roles = ctx
    if not roles & {"owner_admin", "operations_admin"}:
        fail(403, "Permissão de gestão necessária.")
    members = db.scalars(
        select(Membership).where(
            Membership.workspace_id == membership.workspace_id,
            Membership.active.is_(True),
        )
    ).all()
    clinicians = []
    for member in members:
        if "clinician" in (member.roles or []):
            person = db.get(User, member.user_id)
            if person:
                clinicians.append(
                    {"id": str(person.id), "name": person.name, "email": person.email}
                )
    return {"clinicians": clinicians}


@app.get("/api/patients")
def list_patients(
    request: Request, ctx=Depends(principal), db: Session = Depends(get_db)
):
    user, row, membership, roles = ctx
    q = select(Patient).where(Patient.workspace_id == membership.workspace_id)
    if "clinician" in roles:
        q = q.join(PatientAssignment, PatientAssignment.patient_id == Patient.id).where(
            PatientAssignment.workspace_id == membership.workspace_id,
            PatientAssignment.user_id == user.id,
        )
    elif roles & {"owner_admin", "operations_admin", "assistant"}:
        pass
    else:
        fail(403, "Permissão de pacientes necessária.")
    rows, page = sql_page(db, q.order_by(Patient.name), request)
    return {
        "patients": [patient_dto(p, "clinician" in roles) for p in rows],
        "page": {**page, "collection": "patients"},
    }


def patient_dto(p, clinical=True):
    profile = (
        {
            k: v
            for k, v in (p.profile or {}).items()
            if k in {"objective", "clinicalNotes"}
        }
        if clinical
        else {}
    )
    return {
        "id": str(p.id),
        "workspaceId": str(p.workspace_id),
        "userId": str(p.created_by),
        "name": p.name,
        "email": p.email,
        "phone": p.phone,
        "birthDate": p.birth_date,
        "status": canonical_status(p.status),
        **profile,
    }


@app.post("/api/patients", status_code=201)
def create_patient(
    payload: PatientInput, ctx=Depends(principal), db: Session = Depends(get_db)
):
    user, row, membership, roles = ctx
    if not roles & {"owner_admin", "operations_admin", "assistant", "clinician"}:
        fail(403, "Permissão para cadastrar pacientes necessária.")
    profile = (
        {
            "objective": payload.objective[:1000],
            "clinicalNotes": payload.clinicalNotes[:4000],
        }
        if "clinician" in roles
        else {}
    )
    p = Patient(
        workspace_id=membership.workspace_id,
        created_by=user.id,
        name=payload.name.strip(),
        email=payload.email[:254],
        phone=payload.phone[:80],
        birth_date=payload.birthDate[:10],
        status=canonical_status(payload.status),
        profile=profile,
    )
    db.add(p)
    db.flush()
    target = payload.primaryProfessionalId or (
        user.id if "clinician" in roles else None
    )
    support = list(dict.fromkeys(payload.supportProfessionalIds))
    if target != user.id or support:
        if not roles & {"owner_admin", "operations_admin"}:
            fail(403, "Permissão de atribuição necessária.")
    for uid, kind in [
        (target, "primary"),
        *[(uid, "support") for uid in support if uid != target],
    ]:
        if uid is None:
            continue
        member = db.scalar(
            select(Membership).where(
                Membership.workspace_id == p.workspace_id,
                Membership.user_id == uid,
                Membership.active.is_(True),
            )
        )
        if not member or "clinician" not in member.roles:
            fail(400, "Profissional inválido.")
        db.add(
            PatientAssignment(
                workspace_id=p.workspace_id,
                patient_id=p.id,
                user_id=uid,
                assignment_type=kind,
            )
        )
    db.commit()
    return {"patient": patient_dto(p, "clinician" in roles)}


@app.get("/api/patients/{patient_id}")
def get_patient(
    patient_id: UUID, ctx=Depends(principal), db: Session = Depends(get_db)
):
    user, row, membership, roles = ctx
    p = db.scalar(
        select(Patient).where(
            Patient.id == patient_id, Patient.workspace_id == membership.workspace_id
        )
    )
    if not p:
        fail(404, "Paciente não encontrado.")
    assigned = (
        db.scalar(
            select(PatientAssignment.id).where(
                PatientAssignment.patient_id == p.id,
                PatientAssignment.user_id == user.id,
                PatientAssignment.workspace_id == p.workspace_id,
            )
        )
        is not None
    )
    manager = bool(set(roles) & {"owner_admin", "operations_admin", "assistant"})
    if not assigned and not manager:
        fail(404, "Paciente não encontrado.")
    assessments = db.scalars(
        select(Assessment)
        .where(Assessment.patient_id == p.id, Assessment.workspace_id == p.workspace_id)
        .order_by(Assessment.date.desc())
    ).all()
    goals = db.scalars(
        select(Goal).where(Goal.patient_id == p.id, Goal.workspace_id == p.workspace_id)
    ).all()
    appts = db.scalars(
        select(Appointment)
        .where(
            Appointment.patient_id == p.id, Appointment.workspace_id == p.workspace_id
        )
        .order_by(Appointment.start_at)
    ).all()
    clinical = "clinician" in roles and assigned
    account = db.scalar(select(PatientAccount).where(PatientAccount.patient_id == p.id))
    portal = {
        "exists": bool(account),
        "status": account.access_state if account else None,
    }
    return {
        "patient": patient_dto(p, clinical),
        "clinicalAccess": clinical,
        "portal": portal,
        "assessments": [assessment_dto(a) for a in assessments] if clinical else [],
        "goals": [goal_dto(g) for g in goals] if clinical else [],
        "appointments": [
            (
                {
                    **appointment_dto(a),
                    "notes": appointment_dto(a)["notes"] if clinical else "",
                }
            )
            for a in appts
        ],
    }


@app.patch("/api/patients/{patient_id}")
def update_patient(
    patient_id: UUID,
    payload: dict,
    ctx=Depends(principal),
    db: Session = Depends(get_db),
):
    user, row, membership, roles = ctx
    p = db.scalar(
        select(Patient).where(
            Patient.id == patient_id, Patient.workspace_id == membership.workspace_id
        )
    )
    if not p:
        fail(404, "Paciente não encontrado.")
    assigned = (
        db.scalar(
            select(PatientAssignment.id).where(
                PatientAssignment.patient_id == p.id,
                PatientAssignment.user_id == user.id,
                PatientAssignment.workspace_id == p.workspace_id,
            )
        )
        is not None
    )
    manager = bool(set(roles) & {"owner_admin", "operations_admin", "assistant"})
    if not assigned and not manager:
        fail(404, "Paciente não encontrado.")
    clinical = "clinician" in roles and assigned
    if "name" in payload and not str(payload["name"]).strip():
        fail(400, "Nome inválido.")
    if "status" in payload:
        payload["status"] = canonical_status(payload["status"])
    for key, col, maxlen in [
        ("name", "name", 150),
        ("email", "email", 254),
        ("phone", "phone", 80),
        ("birthDate", "birth_date", 10),
        ("status", "status", 32),
    ]:
        if key in payload and (manager or clinical):
            setattr(p, col, str(payload[key])[:maxlen])
    for key in ("objective", "clinicalNotes"):
        if key in payload:
            if not clinical:
                fail(
                    403, "Somente o profissional atribuído pode editar dados clínicos."
                )
            p.profile = {**(p.profile or {}), key: str(payload[key])[:4000]}
    if canonical_status(p.status) == "Arquivado":
        account = db.scalar(
            select(PatientAccount).where(PatientAccount.patient_id == p.id)
        )
        if account:
            for session in db.scalars(
                select(ServerSession).where(
                    ServerSession.patient_account_id == account.id
                )
            ).all():
                session.revoked_at = utcnow()
    db.commit()
    return {"patient": patient_dto(p, clinical)}


@app.put("/api/patients/{patient_id}/assignments")
def update_assignments(
    patient_id: UUID,
    payload: dict,
    ctx=Depends(principal),
    db: Session = Depends(get_db),
):
    user, row, membership, roles = ctx
    if not set(roles) & {"owner_admin", "operations_admin"}:
        fail(403, "Permissão de atribuição necessária.")
    patient = db.scalar(
        select(Patient).where(
            Patient.id == patient_id, Patient.workspace_id == membership.workspace_id
        )
    )
    if not patient:
        fail(404, "Paciente não encontrado.")
    ids = []
    primary = payload.get("primaryProfessionalId")
    if primary:
        ids.append((str(primary), "primary"))
    for support in payload.get("supportProfessionalIds", []):
        if str(support) not in [item[0] for item in ids]:
            ids.append((str(support), "support"))
    if len(ids) > 10:
        fail(400, "Limite de profissionais excedido.")
    for professional_id, _kind in ids:
        try:
            member = db.scalar(
                select(Membership).where(
                    Membership.workspace_id == membership.workspace_id,
                    Membership.user_id == UUID(professional_id),
                    Membership.active.is_(True),
                )
            )
        except ValueError:
            member = None
        if not member or "clinician" not in (member.roles or []):
            fail(400, "Atribua somente profissionais clínicos ativos deste workspace.")
    for assignment in db.scalars(
        select(PatientAssignment).where(
            PatientAssignment.patient_id == patient.id,
            PatientAssignment.workspace_id == membership.workspace_id,
        )
    ).all():
        db.delete(assignment)
    for professional_id, kind in ids:
        db.add(
            PatientAssignment(
                workspace_id=membership.workspace_id,
                patient_id=patient.id,
                user_id=UUID(professional_id),
                assignment_type=kind,
            )
        )
    db.commit()
    return {"assignments": [{"professionalId": pid, "type": kind} for pid, kind in ids]}


@app.post("/api/patients/{patient_id}/invitations")
def create_portal_invitation(
    patient_id: UUID, ctx=Depends(principal), db: Session = Depends(get_db)
):
    user, row, membership, roles = ctx
    patient = patient_access(db, user, membership, patient_id, True)
    rate_limit(db, f"invite:{user.id}:{patient.id}", 5)
    if not patient.email:
        fail(400, "Cadastre o e-mail do paciente antes de convidar.")
    if db.scalar(
        select(PatientAccount.id).where(PatientAccount.patient_id == patient.id)
    ):
        fail(409, "Este paciente já possui uma conta do portal.")
    token = secrets.token_urlsafe(32)
    expires = utcnow() + timedelta(days=7)
    db.add(
        Token(
            patient_id=patient.id,
            purpose="invite",
            token_hash=digest_token(token),
            expires_at=expires,
        )
    )
    db.commit()
    return {"token": token, "expiresAt": expires.isoformat()}


@app.post("/api/patients/{patient_id}/password-resets")
def create_portal_reset(
    patient_id: UUID, ctx=Depends(principal), db: Session = Depends(get_db)
):
    user, row, membership, roles = ctx
    patient = patient_access(db, user, membership, patient_id, True)
    rate_limit(db, f"reset-request:{user.id}:{patient.id}", 5)
    if not db.scalar(
        select(PatientAccount.id).where(PatientAccount.patient_id == patient.id)
    ):
        fail(404, "Conta do portal não encontrada.")
    for old in db.scalars(
        select(Token).where(
            Token.patient_id == patient.id,
            Token.purpose == "reset",
            Token.used_at.is_(None),
        )
    ).all():
        old.used_at = utcnow()
    token = secrets.token_urlsafe(32)
    expires = utcnow() + timedelta(hours=24)
    db.add(
        Token(
            patient_id=patient.id,
            purpose="reset",
            token_hash=digest_token(token),
            expires_at=expires,
        )
    )
    db.commit()
    return {"token": token, "expiresAt": expires.isoformat()}


@app.post("/api/patient/invitations/validate")
def validate_portal_invitation(
    payload: dict, request: Request, db: Session = Depends(get_db)
):
    rate_limit(
        db,
        f"invite-validate:{request.client.host if request.client else 'unknown'}",
        30,
    )
    token = str(payload.get("token", ""))
    row = db.scalar(
        select(Token).where(
            Token.token_hash == digest_token(token), Token.purpose == "invite"
        )
    )
    if not row or row.used_at or row.expires_at <= utcnow():
        fail(400, "Convite inválido ou expirado.")
    patient = db.get(Patient, row.patient_id)
    professional = db.get(User, patient.created_by)
    return {
        "invitation": {
            "patientName": patient.name,
            "professionalName": professional.name if professional else "NutriTrack",
        }
    }


@app.post("/api/patient/activate", status_code=201)
def activate_portal(
    payload: dict, request: Request, response: Response, db: Session = Depends(get_db)
):
    rate_limit(
        db,
        f"invite-activate:{request.client.host if request.client else 'unknown'}",
        10,
    )
    token = str(payload.get("token", ""))
    token_row = db.scalar(
        select(Token)
        .where(Token.token_hash == digest_token(token), Token.purpose == "invite")
        .with_for_update()
    )
    email = str(payload.get("email", " ")).strip().lower()
    password = str(payload.get("password", ""))
    if len(password) < 12 or len(password) > 200:
        fail(400, "A senha deve ter de 12 a 200 caracteres.")
    if not token_row or token_row.used_at or token_row.expires_at <= utcnow():
        fail(400, "Convite inválido ou expirado.")
    patient = db.get(Patient, token_row.patient_id)
    if (
        not patient
        or patient.email.strip().lower() != email
        or db.scalar(
            select(PatientAccount.id).where(PatientAccount.patient_id == patient.id)
        )
    ):
        fail(400, "Não foi possível ativar este convite.")
    account = PatientAccount(
        patient_id=patient.id, email=email, password_hash=hash_password(password)
    )
    token_row.used_at = utcnow()
    db.add(account)
    db.flush()
    portal_session(db, account, response)
    return {"portal": portal_dto(db, account, patient)}


@app.post("/api/patient/login")
def patient_login(payload: dict, response: Response, db: Session = Depends(get_db)):
    email = str(payload.get("email", " ")).strip().lower()
    password = str(payload.get("password", ""))
    account = db.scalar(select(PatientAccount).where(PatientAccount.email == email))
    rate_limit(db, email)
    if (
        not account
        or account.access_state != "active"
        or not verify_password(account.password_hash, password)
    ):
        fail(401, "E-mail ou senha incorretos.")
    patient = db.get(Patient, account.patient_id)
    if not patient or canonical_status(patient.status) == "Arquivado":
        fail(401, "E-mail ou senha incorretos.")
    portal_session(db, account, response)
    return {"portal": portal_dto(db, account, patient)}


@app.get("/api/patient/me")
def patient_me(request: Request, db: Session = Depends(get_db)):
    account, patient = portal_principal(request, db)
    return {"portal": portal_dto(db, account, patient)}


@app.post("/api/patient/logout")
def patient_logout(request: Request, response: Response, db: Session = Depends(get_db)):
    sid = request.cookies.get(PATIENT_COOKIE)
    row = db.get(ServerSession, sid) if sid else None
    if row:
        row.revoked_at = utcnow()
        db.commit()
    response.delete_cookie(
        PATIENT_COOKIE, path="/", secure=SECURE, httponly=True, samesite="strict"
    )
    return {"ok": True}


@app.post("/api/patient/password-resets/validate")
def validate_portal_reset(
    payload: dict, request: Request, db: Session = Depends(get_db)
):
    rate_limit(
        db, f"reset-validate:{request.client.host if request.client else 'unknown'}", 20
    )
    token_row = db.scalar(
        select(Token).where(
            Token.token_hash == digest_token(str(payload.get("token", ""))),
            Token.purpose == "reset",
        )
    )
    if not token_row or token_row.used_at or token_row.expires_at <= utcnow():
        fail(400, "Link inválido ou expirado.")
    patient = db.get(Patient, token_row.patient_id)
    return {"reset": {"patientName": patient.name}}


@app.post("/api/patient/password-resets/complete")
def complete_portal_reset(
    payload: dict, request: Request, db: Session = Depends(get_db)
):
    rate_limit(
        db, f"reset-complete:{request.client.host if request.client else 'unknown'}", 10
    )
    token_row = db.scalar(
        select(Token)
        .where(
            Token.token_hash == digest_token(str(payload.get("token", ""))),
            Token.purpose == "reset",
        )
        .with_for_update()
    )
    password = str(payload.get("password", ""))
    if len(password) < 12 or len(password) > 200:
        fail(400, "A senha deve ter de 12 a 200 caracteres.")
    if not token_row or token_row.used_at or token_row.expires_at <= utcnow():
        fail(400, "Link inválido ou expirado.")
    account = db.scalar(
        select(PatientAccount).where(PatientAccount.patient_id == token_row.patient_id)
    )
    if not account:
        fail(400, "Link inválido ou expirado.")
    account.password_hash = hash_password(password)
    account.session_version += 1
    token_row.used_at = utcnow()
    for session in db.scalars(
        select(ServerSession).where(
            ServerSession.patient_account_id == account.id,
            ServerSession.revoked_at.is_(None),
        )
    ).all():
        session.revoked_at = utcnow()
    db.commit()
    return {"ok": True}


@app.patch("/api/patients/{patient_id}/portal-access")
def update_portal_access(
    patient_id: UUID,
    payload: dict,
    ctx=Depends(principal),
    db: Session = Depends(get_db),
):
    user, row, membership, roles = ctx
    patient = patient_access(db, user, membership, patient_id, True)
    status = payload.get("status")
    account = db.scalar(
        select(PatientAccount).where(PatientAccount.patient_id == patient.id)
    )
    if not account:
        fail(404, "Conta do portal não encontrada.")
    if status not in {"active", "suspended", "revoked"}:
        fail(400, "Estado inválido.")
    if account.access_state == "revoked" and status != "revoked":
        fail(409, "O acesso revogado é terminal.")
    account.access_state = status
    if status != "active":
        for session in db.scalars(
            select(ServerSession).where(
                ServerSession.patient_account_id == account.id,
                ServerSession.revoked_at.is_(None),
            )
        ).all():
            session.revoked_at = utcnow()
    db.commit()
    return {"status": status}


@app.post("/api/assessments", status_code=201)
def create_assessment(
    payload: AssessmentInput, ctx=Depends(principal), db: Session = Depends(get_db)
):
    user, row, membership, roles = ctx
    p = patient_access(db, user, membership, payload.patientId, True)
    bmi = (
        round(payload.weight / (payload.height / 100) ** 2, 1)
        if payload.weight and payload.height
        else None
    )
    a = Assessment(
        workspace_id=p.workspace_id,
        patient_id=p.id,
        created_by=user.id,
        date=payload.date or DateValue.today(),
        weight=payload.weight,
        height=payload.height,
        bmi=bmi,
        fat=payload.fat,
        measurements={
            "waist": payload.waist,
            "hip": payload.hip,
            "method": payload.method[:200],
        },
        notes=payload.notes[:2000],
    )
    db.add(a)
    db.commit()
    return {"assessment": assessment_dto(a)}


def assessment_dto(a):
    return {
        "id": str(a.id),
        "workspaceId": str(a.workspace_id),
        "patientId": str(a.patient_id),
        "date": str(a.date),
        "weight": a.weight,
        "height": a.height,
        "weightUnit": "kg",
        "heightUnit": "cm",
        "bmi": a.bmi,
        "fat": a.fat,
        "waist": a.measurements.get("waist"),
        "hip": a.measurements.get("hip"),
        "method": a.measurements.get("method", ""),
        "notes": a.notes,
    }


def appointment_dto(a):
    return {
        "id": str(a.id),
        "workspaceId": str(a.workspace_id),
        "patientId": str(a.patient_id),
        "start": a.start_at.isoformat(),
        "end": a.end_at.isoformat(),
        "duration": int((a.end_at - a.start_at).total_seconds() / 60),
        "status": a.status,
        "type": a.data.get("type", "Presencial"),
        "notes": a.data.get("notes", ""),
    }


def goal_dto(g):
    return {
        "id": str(g.id),
        "patientId": str(g.patient_id),
        "description": g.description,
        "category": g.category,
        "dueDate": g.due_date,
        "status": g.status,
        "progress": g.progress,
    }


@app.get("/api/assessments")
def list_assessments(
    request: Request, ctx=Depends(principal), db: Session = Depends(get_db)
):
    user, row, membership, roles = ctx
    if "clinician" not in roles:
        fail(403, "Permissão clínica necessária.")
    assigned = select(PatientAssignment.patient_id).where(
        PatientAssignment.workspace_id == membership.workspace_id,
        PatientAssignment.user_id == user.id,
    )
    rows, page = sql_page(
        db,
        select(Assessment)
        .where(
            Assessment.workspace_id == membership.workspace_id,
            Assessment.patient_id.in_(assigned),
        )
        .order_by(Assessment.date.desc(), Assessment.id),
        request,
    )
    names = {
        p.id: p.name
        for p in db.scalars(
            select(Patient).where(
                Patient.id.in_([a.patient_id for a in rows]),
                Patient.workspace_id == membership.workspace_id,
            )
        ).all()
    }
    return {
        "assessments": [
            {**assessment_dto(a), "patientName": names.get(a.patient_id, "")}
            for a in rows
        ],
        "page": {**page, "collection": "assessments"},
    }


def can_read_patient(db, user, membership, pid, roles):
    return (
        "clinician" in roles
        and db.scalar(
            select(PatientAssignment.id).where(
                PatientAssignment.patient_id == pid,
                PatientAssignment.workspace_id == membership.workspace_id,
                PatientAssignment.user_id == user.id,
            )
        )
        is not None
    )


@app.post("/api/appointments", status_code=201)
def create_appointment(
    payload: AppointmentInput, ctx=Depends(principal), db: Session = Depends(get_db)
):
    user, row, membership, roles = ctx
    p = patient_access(db, user, membership, payload.patientId, True)
    local_zone = ZoneInfo(os.getenv("APP_TIMEZONE", "America/Sao_Paulo"))
    start = (
        payload.start
        if payload.start.tzinfo
        else payload.start.replace(tzinfo=local_zone)
    )
    start = start.astimezone(timezone.utc)
    end = start + timedelta(minutes=payload.duration)
    # Serialize same-provider scheduling transactions so simultaneous requests cannot both pass the overlap check.
    db.execute(
        select(
            func.pg_advisory_xact_lock(
                func.hashtextextended(f"{membership.workspace_id}:{user.id}", 0)
            )
        )
    )
    conflict = db.scalar(
        select(Appointment.id).where(
            Appointment.workspace_id == p.workspace_id,
            Appointment.created_by == user.id,
            Appointment.status == "agendada",
            Appointment.start_at < end,
            Appointment.end_at > start,
        )
    )
    if conflict:
        fail(409, "Já existe uma consulta nesse horário.")
    a = Appointment(
        workspace_id=p.workspace_id,
        patient_id=p.id,
        created_by=user.id,
        start_at=start,
        end_at=end,
        status="agendada",
        data={"type": payload.type[:60], "notes": payload.notes[:2000]},
    )
    db.add(a)
    db.commit()
    return {"appointment": appointment_dto(a)}


@app.get("/api/appointments")
def list_appointments(
    request: Request, ctx=Depends(principal), db: Session = Depends(get_db)
):
    user, row, membership, roles = ctx
    assigned = (
        set(
            db.scalars(
                select(PatientAssignment.patient_id).where(
                    PatientAssignment.workspace_id == membership.workspace_id,
                    PatientAssignment.user_id == user.id,
                )
            ).all()
        )
        if "clinician" in roles
        else set()
    )
    manage = bool(roles & {"owner_admin", "operations_admin", "assistant"})
    query = select(Appointment).where(
        Appointment.workspace_id == membership.workspace_id
    )
    if not manage:
        query = query.where(Appointment.patient_id.in_(assigned))
    rows, page = sql_page(
        db, query.order_by(Appointment.start_at, Appointment.id), request
    )
    names = {
        p.id: p.name
        for p in db.scalars(
            select(Patient).where(
                Patient.id.in_([a.patient_id for a in rows]),
                Patient.workspace_id == membership.workspace_id,
            )
        ).all()
    }
    return {
        "appointments": [
            {
                **appointment_dto(a),
                "patientName": names.get(a.patient_id, ""),
                "notes": (
                    appointment_dto(a)["notes"] if a.patient_id in assigned else ""
                ),
            }
            for a in rows
        ],
        "page": {**page, "collection": "appointments"},
    }


@app.patch("/api/appointments/{appointment_id}")
def update_appointment(
    appointment_id: UUID,
    payload: dict,
    ctx=Depends(principal),
    db: Session = Depends(get_db),
):
    user, row, membership, roles = ctx
    a = db.scalar(
        select(Appointment).where(
            Appointment.id == appointment_id,
            Appointment.workspace_id == membership.workspace_id,
        )
    )
    if (
        not a
        or not can_read_patient(db, user, membership, a.patient_id, roles)
        or "clinician" not in roles
    ):
        fail(404, "Consulta não encontrada.")
    if payload.get("status") not in {"agendada", "realizada", "cancelada", "falta"}:
        fail(400, "Status inválido.")
    if payload["status"] == "agendada":
        db.execute(
            select(
                func.pg_advisory_xact_lock(
                    func.hashtextextended(f"{a.workspace_id}:{a.created_by}", 0)
                )
            )
        )
        conflict = db.scalar(
            select(Appointment.id).where(
                Appointment.id != a.id,
                Appointment.workspace_id == a.workspace_id,
                Appointment.created_by == a.created_by,
                Appointment.status == "agendada",
                Appointment.start_at < a.end_at,
                Appointment.end_at > a.start_at,
            )
        )
        if conflict:
            fail(409, "Já existe uma consulta nesse horário.")
    a.status = payload["status"]
    db.commit()
    return {"appointment": appointment_dto(a)}


@app.post("/api/goals", status_code=201)
def create_goal(
    payload: GoalInput, ctx=Depends(principal), db: Session = Depends(get_db)
):
    user, row, membership, roles = ctx
    p = patient_access(db, user, membership, payload.patientId, True)
    g = Goal(
        workspace_id=p.workspace_id,
        patient_id=p.id,
        created_by=user.id,
        description=payload.description.strip(),
        category=payload.category,
        due_date=payload.dueDate,
        progress=[],
    )
    db.add(g)
    db.commit()
    return {"goal": goal_dto(g)}


@app.patch("/api/goals/{goal_id}")
def update_goal(
    goal_id: UUID, payload: dict, ctx=Depends(principal), db: Session = Depends(get_db)
):
    user, row, membership, roles = ctx
    g = db.scalar(
        select(Goal).where(
            Goal.id == goal_id, Goal.workspace_id == membership.workspace_id
        )
    )
    if (
        not g
        or not can_read_patient(db, user, membership, g.patient_id, roles)
        or "clinician" not in roles
    ):
        fail(404, "Meta não encontrada.")
    if payload.get("status") not in {"ativa", "concluida", "pausada"}:
        fail(400, "Status inválido.")
    g.status = payload["status"]
    if payload.get("note"):
        g.progress = [
            *(g.progress or []),
            {"note": str(payload["note"])[:1000], "at": utcnow().isoformat()},
        ]
    db.commit()
    return {"goal": goal_dto(g)}


@app.get("/api/meal-plans")
def list_meal_plans(
    request: Request, ctx=Depends(principal), db: Session = Depends(get_db)
):
    user, row, membership, roles = ctx
    if "clinician" not in roles:
        fail(403, "Permissão clínica necessária.")
    assigned = select(PatientAssignment.patient_id).where(
        PatientAssignment.workspace_id == membership.workspace_id,
        PatientAssignment.user_id == user.id,
    )
    rows, page = sql_page(
        db,
        select(MealPlan)
        .where(
            MealPlan.workspace_id == membership.workspace_id,
            MealPlan.patient_id.in_(assigned),
        )
        .order_by(MealPlan.id),
        request,
    )
    names = {
        p.id: p.name
        for p in db.scalars(
            select(Patient).where(
                Patient.id.in_([a.patient_id for a in rows]),
                Patient.workspace_id == membership.workspace_id,
            )
        ).all()
    }
    return {
        "mealPlans": [
            {
                "id": str(p.id),
                "revision": p.revision,
                "patientId": str(p.patient_id),
                "patientName": names.get(p.patient_id, ""),
                "name": p.name,
                "status": (p.versions or [{}])[-1].get("status", "draft"),
                "versionCount": len(p.versions or []),
                "latestVersion": {
                    **(p.versions or [{}])[-1],
                    "mealCount": len((p.versions or [{}])[-1].get("meals", [])),
                },
                "publishedVersion": next(
                    (
                        v.get("number")
                        for v in p.versions or []
                        if v.get("id") == p.published_version_id
                    ),
                    None,
                ),
            }
            for p in rows
        ],
        "page": {**page, "collection": "mealPlans"},
    }


@app.get("/api/goals")
def list_goals(request: Request, ctx=Depends(principal), db: Session = Depends(get_db)):
    user, row, membership, roles = ctx
    if "clinician" not in roles:
        fail(403, "Permissão clínica necessária.")
    assigned = select(PatientAssignment.patient_id).where(
        PatientAssignment.workspace_id == membership.workspace_id,
        PatientAssignment.user_id == user.id,
    )
    rows, page = sql_page(
        db,
        select(Goal)
        .where(
            Goal.workspace_id == membership.workspace_id, Goal.patient_id.in_(assigned)
        )
        .order_by(Goal.id),
        request,
    )
    names = {
        p.id: p.name
        for p in db.scalars(
            select(Patient).where(
                Patient.id.in_([g.patient_id for g in rows]),
                Patient.workspace_id == membership.workspace_id,
            )
        ).all()
    }
    return {
        "goals": [
            {**goal_dto(g), "patientName": names.get(g.patient_id, "")} for g in rows
        ],
        "page": {**page, "collection": "goals"},
    }


@app.post("/api/meal-plans", status_code=201)
def create_meal_plan(
    payload: dict, ctx=Depends(principal), db: Session = Depends(get_db)
):
    payload = plan_payload(payload, True)
    user, row, membership, roles = ctx
    p = patient_access(db, user, membership, UUID(payload["patientId"]), True)
    name = str(payload.get("name", "")).strip()
    if not name:
        fail(400, "Informe o nome do plano.")
    meals = normalize_meals(payload.get("meals", []))
    version = {
        **payload,
        "id": str(__import__("uuid").uuid4()),
        "number": 1,
        "status": "draft",
        "createdAt": utcnow().isoformat(),
        "meals": meals,
    }
    plan = MealPlan(
        workspace_id=p.workspace_id,
        patient_id=p.id,
        created_by=user.id,
        name=name[:120],
        versions=[version],
    )
    db.add(plan)
    db.commit()
    return {"mealPlan": plan_dto(plan)}


def plan_dto(p):
    return {
        "id": str(p.id),
        "revision": p.revision,
        "patientId": str(p.patient_id),
        "name": p.name,
        "versions": p.versions,
        "publishedVersionId": p.published_version_id,
    }


@app.get("/api/meal-plans/{plan_id}")
def get_meal_plan(plan_id: UUID, ctx=Depends(principal), db: Session = Depends(get_db)):
    user, row, membership, roles = ctx
    p = db.scalar(
        select(MealPlan)
        .where(MealPlan.id == plan_id, MealPlan.workspace_id == membership.workspace_id)
        .with_for_update()
    )
    if not p or not can_read_patient(db, user, membership, p.patient_id, roles):
        fail(404, "Plano alimentar não encontrado.")
    return {
        "mealPlan": {**plan_dto(p), "patientName": db.get(Patient, p.patient_id).name}
    }


@app.put("/api/meal-plans/{plan_id}/draft")
def update_meal_plan(
    plan_id: UUID, payload: dict, ctx=Depends(principal), db: Session = Depends(get_db)
):
    user, row, membership, roles = ctx
    p = db.scalar(
        select(MealPlan)
        .where(MealPlan.id == plan_id, MealPlan.workspace_id == membership.workspace_id)
        .with_for_update()
    )
    if not p or not can_read_patient(db, user, membership, p.patient_id, roles):
        fail(404, "Plano alimentar não encontrado.")
    if type(payload.get("expectedRevision")) is not int:
        fail(428, "Atualize o plano antes de salvar.")
    if payload["expectedRevision"] != p.revision:
        fail(409, "Plano alterado. Atualize antes de salvar.")
    payload = plan_payload(payload)
    name = str(payload.get("name", p.name)).strip()
    if not name:
        fail(400, "Informe o nome do plano.")
    versions = list(p.versions or [])
    current = versions[-1] if versions else None
    v = {
        **payload,
        "id": (
            current["id"]
            if current and current.get("status") == "draft"
            else str(__import__("uuid").uuid4())
        ),
        "number": (
            current["number"]
            if current and current.get("status") == "draft"
            else (current["number"] + 1 if current else 1)
        ),
        "status": "draft",
        "createdAt": (
            current.get("createdAt", utcnow().isoformat())
            if current and current.get("status") == "draft"
            else utcnow().isoformat()
        ),
        "meals": normalize_meals(payload.get("meals", [])),
    }
    if current and current.get("status") == "draft":
        versions[-1] = v
    else:
        versions.append(v)
    p.revision += 1
    p.name = name[:120]
    p.versions = versions
    db.commit()
    return {"mealPlan": plan_dto(p)}


@app.post("/api/meal-plans/{plan_id}/publish")
def publish_meal_plan(
    plan_id: UUID, payload: dict, ctx=Depends(principal), db: Session = Depends(get_db)
):
    user, row, membership, roles = ctx
    p = db.scalar(
        select(MealPlan)
        .where(MealPlan.id == plan_id, MealPlan.workspace_id == membership.workspace_id)
        .with_for_update()
    )
    if (
        not p
        or not can_read_patient(db, user, membership, p.patient_id, roles)
        or "clinician" not in roles
    ):
        fail(404, "Plano alimentar não encontrado.")
    if type(payload.get("expectedRevision")) is not int:
        fail(428, "Atualize o plano antes de publicar.")
    if payload["expectedRevision"] != p.revision:
        fail(409, "Plano alterado. Atualize antes de publicar.")
    versions = list(p.versions or [])
    v = versions[-1] if versions else None
    if not v or v.get("status") != "draft":
        fail(409, "Crie uma nova versão antes de publicar novamente.")
    if not v.get("meals") or not all(
        m.get("items")
        and all(
            item.get("quantity") and str(item.get("unit", "")).strip()
            for item in m["items"]
        )
        for m in v["meals"]
    ):
        fail(
            400,
            "Adicione refeições e alimentos com quantidade e unidade antes de publicar.",
        )
    v = {**v, "status": "published", "publishedAt": utcnow().isoformat()}
    versions[-1] = v
    p.revision += 1
    p.versions = versions
    p.published_version_id = v["id"]
    db.commit()
    return {"mealPlan": plan_dto(p)}


@app.exception_handler(HTTPException)
async def http_error(request, exc):
    return JSONResponse(
        {"error": str(exc.detail)}, status_code=exc.status_code, headers=exc.headers
    )


@app.exception_handler(RequestValidationError)
async def validation_error(request, exc):
    return JSONResponse({"error": "Revise os campos enviados."}, status_code=422)


@app.exception_handler(IntegrityError)
async def integrity_error(request, exc):
    return JSONResponse({"error": "Operação em conflito."}, status_code=409)


@app.middleware("http")
async def security_headers(request, call_next):
    raw = bytearray()
    async for chunk in request.stream():
        raw.extend(chunk)
        if len(raw) > 1_000_000:
            return JSONResponse({"error": "Corpo muito grande."}, status_code=413)
    if request.method in {"POST", "PATCH", "PUT", "DELETE"} and raw:
        try:
            data = json.loads(raw)
        except (ValueError, UnicodeDecodeError):
            return JSONResponse({"error": "JSON inválido."}, status_code=400)
        if not isinstance(data, dict):
            return JSONResponse({"error": "Envie um objeto JSON."}, status_code=422)
        route = request.url.path
        allowed = None
        if route.startswith("/api/patient/"):
            allowed = {"token", "email", "password"}
            if any(
                k in data
                and (
                    not isinstance(data[k], str)
                    or len(data[k]) > (200 if k == "password" else 512)
                )
                for k in allowed
            ):
                return JSONResponse({"error": "Campo inválido."}, status_code=422)
        elif request.method == "PATCH" and route.startswith("/api/patients/"):
            allowed = (
                {"status"}
                if route.endswith("/portal-access")
                else {
                    "name",
                    "email",
                    "phone",
                    "birthDate",
                    "status",
                    "objective",
                    "clinicalNotes",
                }
            )
        elif route.endswith("/assignments"):
            allowed = {"primaryProfessionalId", "supportProfessionalIds"}
            if "supportProfessionalIds" in data and (
                not isinstance(data["supportProfessionalIds"], list)
                or len(data["supportProfessionalIds"]) > 10
            ):
                return JSONResponse(
                    {"error": "Atribuições inválidas."}, status_code=422
                )
        elif request.method == "PATCH" and route.startswith("/api/appointments/"):
            allowed = {"status"}
        elif request.method == "PATCH" and route.startswith("/api/goals/"):
            allowed = {"status", "note"}
        elif route == "/api/workspaces/select":
            allowed = {"workspaceId", "experience"}
        if request.method == "PATCH" and (
            route.startswith("/api/patients/") or route.startswith("/api/goals/")
        ):
            bounds = {
                "name": 150,
                "email": 254,
                "phone": 80,
                "birthDate": 10,
                "status": 32,
                "objective": 1000,
                "clinicalNotes": 4000,
                "note": 1000,
            }
            if any(
                key in bounds
                and (not isinstance(value, str) or len(value) > bounds[key])
                for key, value in data.items()
            ):
                return JSONResponse({"error": "Campo inválido."}, status_code=422)
        if allowed is not None and set(data) - allowed:
            return JSONResponse({"error": "Campos não reconhecidos."}, status_code=422)

    def global_limit():
        with SessionLocal() as db:
            rate_limit(
                db, "ip:" + (request.client.host if request.client else "unknown"), 1000
            )

    if request.url.path.startswith("/api/"):
        try:
            await run_in_threadpool(global_limit)
        except HTTPException as exc:
            return JSONResponse({"error": str(exc.detail)}, status_code=exc.status_code)
    request._body = bytes(raw)
    response = await call_next(request)
    for name, value in {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "no-referrer",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    }.items():
        response.headers[name] = value
    if SECURE:
        response.headers["Strict-Transport-Security"] = "max-age=31536000"
    return response
