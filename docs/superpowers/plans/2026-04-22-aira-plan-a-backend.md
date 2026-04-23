# AIRA Plan A — Infrastructure & Backend API

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the AIRA FastAPI backend with TimescaleDB, wire Kong to emit usage events to it, and expose REST endpoints for cost, chargeback, and team data that Plans B/C/D consume.

**Architecture:** Kong's HTTP log plugin POSTs every AI call event to `/ingest/event`. The FastAPI backend normalises the event, applies model pricing, and writes to TimescaleDB. REST endpoints aggregate this data for the dashboard and client. Auth is JWT — the same token Kong validates is forwarded as a header to the backend.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2 + asyncpg, TimescaleDB (PostgreSQL extension), Alembic, pytest + httpx, Docker Compose

---

## File Map

```
aira-backend/
├── pyproject.toml                  # deps: fastapi, uvicorn, sqlalchemy[asyncio], asyncpg, alembic, pytest, httpx
├── alembic.ini
├── alembic/
│   └── versions/
│       └── 001_initial_schema.py   # creates all tables + hypertable
├── app/
│   ├── main.py                     # FastAPI app, mounts routers
│   ├── config.py                   # settings from env vars
│   ├── db.py                       # async engine + session factory
│   ├── models.py                   # SQLAlchemy ORM models
│   ├── pricing.py                  # model → $/token lookup table
│   ├── routers/
│   │   ├── ingest.py               # POST /ingest/event  (called by Kong)
│   │   ├── costs.py                # GET /costs/...      (dashboard)
│   │   ├── chargeback.py           # GET /chargeback/... (dashboard)
│   │   └── teams.py                # GET/POST /teams/... (admin)
│   └── schemas.py                  # Pydantic request/response models
└── tests/
    ├── conftest.py                  # test DB setup, async client fixture
    ├── test_ingest.py
    ├── test_costs.py
    ├── test_chargeback.py
    └── test_pricing.py
kong/
├── docker-compose.yml              # ADD: timescaledb, redis, aira-backend services
└── kong.yml                        # ADD: http-log plugin → aira-backend /ingest/event
```

---

## Task 1: Project scaffold + dependencies

**Files:**
- Create: `aira-backend/pyproject.toml`
- Create: `aira-backend/app/__init__.py` (empty)
- Create: `aira-backend/app/config.py`

- [ ] **Step 1: Create pyproject.toml**

```toml
[project]
name = "aira-backend"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.30",
    "sqlalchemy[asyncio]>=2.0",
    "asyncpg>=0.29",
    "alembic>=1.13",
    "pydantic-settings>=2.0",
    "httpx>=0.27",
]

[project.optional-dependencies]
dev = ["pytest>=8", "pytest-asyncio>=0.23", "pytest-cov"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
```

- [ ] **Step 2: Create app/config.py**

```python
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://aira:aira@localhost:5432/aira"
    jwt_issuer: str = "http://localhost:8080/default"
    model_config = {"env_file": ".env"}

settings = Settings()
```

- [ ] **Step 3: Install deps**

```bash
cd aira-backend
pip install -e ".[dev]"
```

Expected: installs without errors.

- [ ] **Step 4: Commit**

```bash
git add aira-backend/
git commit -m "feat(backend): scaffold FastAPI project"
```

---

## Task 2: Database schema + migrations

**Files:**
- Create: `aira-backend/app/models.py`
- Create: `aira-backend/alembic.ini`
- Create: `aira-backend/alembic/versions/001_initial_schema.py`

- [ ] **Step 1: Create app/models.py**

```python
from datetime import datetime
from sqlalchemy import String, Numeric, Integer, DateTime, ForeignKey
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

class Base(DeclarativeBase):
    pass

class Team(Base):
    __tablename__ = "teams"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    department: Mapped[str] = mapped_column(String(100), nullable=False)
    monthly_budget_usd: Mapped[float] = mapped_column(Numeric(10, 4), default=0)

class UsageEvent(Base):
    __tablename__ = "usage_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    user_id: Mapped[str] = mapped_column(String(100), nullable=False)
    team_id: Mapped[str] = mapped_column(String(100), nullable=False)
    department: Mapped[str] = mapped_column(String(100), nullable=False)
    provider: Mapped[str] = mapped_column(String(50), nullable=False)   # openai | anthropic | gemini
    model: Mapped[str] = mapped_column(String(100), nullable=False)
    prompt_tokens: Mapped[int] = mapped_column(Integer, nullable=False)
    completion_tokens: Mapped[int] = mapped_column(Integer, nullable=False)
    cost_usd: Mapped[float] = mapped_column(Numeric(10, 6), nullable=False)
    latency_ms: Mapped[int] = mapped_column(Integer, nullable=True)
    request_id: Mapped[str] = mapped_column(String(200), nullable=True)
```

- [ ] **Step 2: Initialise Alembic**

```bash
cd aira-backend
alembic init alembic
```

Update `alembic.ini` — set `sqlalchemy.url = postgresql+asyncpg://aira:aira@localhost:5432/aira`

Update `alembic/env.py` — add at top:
```python
from app.models import Base
target_metadata = Base.metadata
```

- [ ] **Step 3: Create migration**

```bash
alembic revision --autogenerate -m "initial schema"
```

Open the generated file and add TimescaleDB hypertable creation after the table is created:

```python
def upgrade() -> None:
    op.create_table('teams', ...)   # autogenerated
    op.create_table('usage_events', ...)  # autogenerated
    # Convert usage_events to a hypertable partitioned by timestamp
    op.execute("SELECT create_hypertable('usage_events', 'timestamp')")
```

- [ ] **Step 4: Commit**

```bash
git add aira-backend/app/models.py aira-backend/alembic/
git commit -m "feat(backend): database schema with TimescaleDB hypertable"
```

---

## Task 3: Docker Compose — add TimescaleDB, Redis, backend

**Files:**
- Modify: `kong/docker-compose.yml`
- Create: `aira-backend/Dockerfile`

- [ ] **Step 1: Create aira-backend/Dockerfile**

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml .
RUN pip install -e ".[dev]"
COPY . .
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8002", "--reload"]
```

- [ ] **Step 2: Add services to kong/docker-compose.yml**

Add to the `services:` block:

```yaml
  timescaledb:
    image: timescale/timescaledb:latest-pg16
    container_name: aira-db
    environment:
      POSTGRES_USER: aira
      POSTGRES_PASSWORD: aira
      POSTGRES_DB: aira
    ports:
      - "5432:5432"
    networks:
      - aira-kong

  redis:
    image: redis:7-alpine
    container_name: aira-redis
    ports:
      - "6379:6379"
    networks:
      - aira-kong

  aira-backend:
    build:
      context: ../aira-backend
    container_name: aira-backend
    depends_on:
      - timescaledb
    environment:
      DATABASE_URL: postgresql+asyncpg://aira:aira@timescaledb:5432/aira
    ports:
      - "8002:8002"
    networks:
      - aira-kong
```

- [ ] **Step 3: Start and verify**

```bash
cd kong
docker compose up -d timescaledb redis aira-backend
docker compose logs aira-backend
```

Expected: `Application startup complete.`

- [ ] **Step 4: Run migration inside container**

```bash
docker compose exec aira-backend alembic upgrade head
```

Expected: `Running upgrade -> 001_initial_schema, initial schema`

- [ ] **Step 5: Commit**

```bash
git add kong/docker-compose.yml aira-backend/Dockerfile
git commit -m "feat(infra): add TimescaleDB, Redis, backend to Docker Compose"
```

---

## Task 4: Pricing table

**Files:**
- Create: `aira-backend/app/pricing.py`
- Create: `aira-backend/tests/test_pricing.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_pricing.py
from app.pricing import cost_usd

def test_gpt4o_cost():
    usd = cost_usd("openai", "gpt-4o", prompt_tokens=1000, completion_tokens=500)
    assert usd == pytest.approx(0.005 + 0.0075, rel=1e-3)  # $5/M + $15/M

def test_claude_haiku_cost():
    usd = cost_usd("anthropic", "claude-haiku-4-5-20251001", prompt_tokens=1000, completion_tokens=500)
    assert usd == pytest.approx(0.00025 + 0.000625, rel=1e-3)  # $0.25/M + $1.25/M

def test_unknown_model_raises():
    with pytest.raises(ValueError, match="Unknown model"):
        cost_usd("openai", "gpt-999", prompt_tokens=100, completion_tokens=50)
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/test_pricing.py -v
```

Expected: `3 failed` — `ImportError: cannot import name 'cost_usd'`

- [ ] **Step 3: Implement pricing.py**

```python
# Prices in USD per 1M tokens
_PRICING: dict[tuple[str, str], tuple[float, float]] = {
    ("openai",    "gpt-4o"):                         (5.00,  15.00),
    ("openai",    "gpt-4o-mini"):                    (0.15,   0.60),
    ("openai",    "gpt-4-turbo"):                    (10.00, 30.00),
    ("anthropic", "claude-opus-4-7"):                (15.00, 75.00),
    ("anthropic", "claude-sonnet-4-6"):              (3.00,  15.00),
    ("anthropic", "claude-haiku-4-5-20251001"):      (0.25,   1.25),
    ("google",    "gemini-1.5-pro"):                 (3.50,  10.50),
    ("google",    "gemini-1.5-flash"):               (0.075,  0.30),
}

def cost_usd(provider: str, model: str, prompt_tokens: int, completion_tokens: int) -> float:
    key = (provider.lower(), model.lower())
    if key not in _PRICING:
        raise ValueError(f"Unknown model: {provider}/{model}")
    prompt_price, completion_price = _PRICING[key]
    return (prompt_tokens * prompt_price + completion_tokens * completion_price) / 1_000_000
```

- [ ] **Step 4: Run tests**

```bash
pytest tests/test_pricing.py -v
```

Expected: `3 passed`

- [ ] **Step 5: Commit**

```bash
git add aira-backend/app/pricing.py aira-backend/tests/test_pricing.py
git commit -m "feat(backend): model pricing table with tests"
```

---

## Task 5: Database connection + session

**Files:**
- Create: `aira-backend/app/db.py`
- Create: `aira-backend/tests/conftest.py`

- [ ] **Step 1: Create app/db.py**

```python
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from app.config import settings

engine = create_async_engine(settings.database_url, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)

async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session
```

- [ ] **Step 2: Create tests/conftest.py**

```python
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.main import app
from app.db import get_db
from app.models import Base

TEST_DB = "postgresql+asyncpg://aira:aira@localhost:5432/aira_test"

@pytest_asyncio.fixture(scope="session")
async def test_engine():
    engine = create_async_engine(TEST_DB)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()

@pytest_asyncio.fixture
async def db_session(test_engine):
    session_factory = async_sessionmaker(test_engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session
        await session.rollback()

@pytest_asyncio.fixture
async def client(db_session):
    async def override_get_db():
        yield db_session
    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()
```

- [ ] **Step 3: Create test database**

```bash
docker compose exec timescaledb psql -U aira -c "CREATE DATABASE aira_test;"
```

- [ ] **Step 4: Commit**

```bash
git add aira-backend/app/db.py aira-backend/tests/conftest.py
git commit -m "feat(backend): async DB session + test fixtures"
```

---

## Task 6: Pydantic schemas

**Files:**
- Create: `aira-backend/app/schemas.py`

- [ ] **Step 1: Create schemas.py**

```python
from datetime import datetime
from pydantic import BaseModel

# ── Ingest ──────────────────────────────────────────────────────────────────

class KongLogEvent(BaseModel):
    """Shape of the payload Kong's http-log plugin sends."""
    request: dict        # contains headers with JWT claims forwarded by Kong
    response: dict       # contains status, headers (including token counts)
    latencies: dict      # { proxy: int } latency in ms
    route: dict          # { name: str }
    service: dict        # { name: str }
    started_at: int      # unix ms

class IngestResponse(BaseModel):
    ok: bool
    event_id: int

# ── Costs ───────────────────────────────────────────────────────────────────

class DailySpend(BaseModel):
    date: str            # YYYY-MM-DD
    total_usd: float

class TeamSpend(BaseModel):
    team_id: str
    department: str
    total_usd: float
    total_tokens: int
    budget_usd: float

# ── Chargeback ───────────────────────────────────────────────────────────────

class ChargebackRow(BaseModel):
    department: str
    team_id: str
    total_tokens: int
    total_usd: float
    budget_usd: float
    utilisation_pct: float
    status: str          # "on_track" | "near_limit" | "over_budget"

class ChargebackReport(BaseModel):
    month: str           # YYYY-MM
    rows: list[ChargebackRow]
    total_usd: float
    total_budget_usd: float

# ── Teams ────────────────────────────────────────────────────────────────────

class TeamCreate(BaseModel):
    name: str
    department: str
    monthly_budget_usd: float

class TeamOut(TeamCreate):
    id: int
    model_config = {"from_attributes": True}
```

- [ ] **Step 2: Commit**

```bash
git add aira-backend/app/schemas.py
git commit -m "feat(backend): Pydantic request/response schemas"
```

---

## Task 7: Ingest endpoint

**Files:**
- Create: `aira-backend/app/routers/ingest.py`
- Create: `aira-backend/tests/test_ingest.py`

- [ ] **Step 1: Write failing test**

```python
# tests/test_ingest.py
import pytest
import time

KONG_EVENT = {
    "request": {
        "headers": {
            "x-user-id": "user-001",
            "x-team-id": "nlp-platform",
            "x-department": "R&D",
        }
    },
    "response": {
        "status": 200,
        "headers": {
            "x-kong-upstream-latency": "342",
        },
        "body": '{"usage":{"prompt_tokens":500,"completion_tokens":200}}',
    },
    "latencies": {"proxy": 342},
    "route": {"name": "openai-route"},
    "service": {"name": "openai-service"},
    "started_at": int(time.time() * 1000),
}

@pytest.mark.asyncio
async def test_ingest_event(client):
    # Mock the request body to include model info
    event = dict(KONG_EVENT)
    event["request"]["body"] = '{"model":"gpt-4o","messages":[]}'
    response = await client.post("/ingest/event", json=event)
    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is True
    assert "event_id" in data

@pytest.mark.asyncio
async def test_ingest_missing_user_header_returns_422(client):
    bad_event = dict(KONG_EVENT)
    bad_event["request"]["headers"] = {}   # no x-user-id
    response = await client.post("/ingest/event", json=bad_event)
    assert response.status_code == 422
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/test_ingest.py -v
```

Expected: `2 failed` — app not yet created.

- [ ] **Step 3: Create app/main.py**

```python
from fastapi import FastAPI
from app.routers import ingest, costs, chargeback, teams

app = FastAPI(title="AIRA Backend", version="0.1.0")
app.include_router(ingest.router)
app.include_router(costs.router)
app.include_router(chargeback.router)
app.include_router(teams.router)

@app.get("/health")
async def health():
    return {"ok": True}
```

- [ ] **Step 4: Create app/routers/ingest.py**

```python
import json
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.db import get_db
from app.models import UsageEvent
from app.pricing import cost_usd
from app.schemas import KongLogEvent, IngestResponse

router = APIRouter(prefix="/ingest")

@router.post("/event", response_model=IngestResponse)
async def ingest_event(payload: KongLogEvent, db: AsyncSession = Depends(get_db)):
    headers = payload.request.get("headers", {})
    user_id = headers.get("x-user-id")
    team_id = headers.get("x-team-id")
    department = headers.get("x-department")
    if not user_id or not team_id or not department:
        raise HTTPException(status_code=422, detail="Missing identity headers from Kong")

    # Parse model from request body
    req_body = payload.request.get("body", "{}")
    try:
        req_json = json.loads(req_body) if isinstance(req_body, str) else req_body
    except json.JSONDecodeError:
        req_json = {}
    model = req_json.get("model", "unknown")

    # Parse token usage from response body
    resp_body = payload.response.get("body", "{}")
    try:
        resp_json = json.loads(resp_body) if isinstance(resp_body, str) else resp_body
    except json.JSONDecodeError:
        resp_json = {}
    usage = resp_json.get("usage", {})
    prompt_tokens = usage.get("prompt_tokens", 0)
    completion_tokens = usage.get("completion_tokens", 0)

    # Determine provider from service name
    service_name = payload.service.get("name", "")
    provider = service_name.split("-")[0] if "-" in service_name else service_name

    # Calculate cost
    try:
        usd = cost_usd(provider, model, prompt_tokens, completion_tokens)
    except ValueError:
        usd = 0.0

    event = UsageEvent(
        timestamp=datetime.fromtimestamp(payload.started_at / 1000, tz=timezone.utc),
        user_id=user_id,
        team_id=team_id,
        department=department,
        provider=provider,
        model=model,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        cost_usd=usd,
        latency_ms=payload.latencies.get("proxy"),
        request_id=payload.request.get("headers", {}).get("x-request-id"),
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)
    return IngestResponse(ok=True, event_id=event.id)
```

Create empty `__init__.py` files: `app/routers/__init__.py`

- [ ] **Step 5: Run tests**

```bash
pytest tests/test_ingest.py -v
```

Expected: `2 passed`

- [ ] **Step 6: Commit**

```bash
git add aira-backend/app/ aira-backend/tests/test_ingest.py
git commit -m "feat(backend): /ingest/event endpoint with cost calculation"
```

---

## Task 8: Cost & chargeback endpoints

**Files:**
- Create: `aira-backend/app/routers/costs.py`
- Create: `aira-backend/app/routers/chargeback.py`
- Create: `aira-backend/tests/test_costs.py`
- Create: `aira-backend/tests/test_chargeback.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_costs.py
import pytest

@pytest.mark.asyncio
async def test_daily_spend_returns_list(client):
    response = await client.get("/costs/daily?days=7")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    # Each row has date and total_usd
    for row in data:
        assert "date" in row
        assert "total_usd" in row

@pytest.mark.asyncio
async def test_team_spend_returns_list(client):
    response = await client.get("/costs/by-team?month=2026-04")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
```

```python
# tests/test_chargeback.py
import pytest

@pytest.mark.asyncio
async def test_chargeback_report_shape(client):
    response = await client.get("/chargeback?month=2026-04")
    assert response.status_code == 200
    data = response.json()
    assert "month" in data
    assert "rows" in data
    assert "total_usd" in data

@pytest.mark.asyncio
async def test_chargeback_status_labels(client, db_session):
    # Seed a team with a tight budget
    from app.models import Team, UsageEvent
    from datetime import datetime, timezone
    team = Team(name="test-team", department="Test", monthly_budget_usd=1.0)
    db_session.add(team)
    event = UsageEvent(
        timestamp=datetime(2026, 4, 15, tzinfo=timezone.utc),
        user_id="u1", team_id="test-team", department="Test",
        provider="openai", model="gpt-4o",
        prompt_tokens=100000, completion_tokens=50000,
        cost_usd=2.25,  # over the $1 budget
    )
    db_session.add(event)
    await db_session.commit()

    response = await client.get("/chargeback?month=2026-04")
    assert response.status_code == 200
    rows = response.json()["rows"]
    test_row = next((r for r in rows if r["team_id"] == "test-team"), None)
    assert test_row is not None
    assert test_row["status"] == "over_budget"
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/test_costs.py tests/test_chargeback.py -v
```

Expected: all failed — routers not implemented.

- [ ] **Step 3: Implement app/routers/costs.py**

```python
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession
from app.db import get_db
from app.models import UsageEvent
from app.schemas import DailySpend, TeamSpend

router = APIRouter(prefix="/costs")

@router.get("/daily", response_model=list[DailySpend])
async def daily_spend(days: int = Query(30, ge=1, le=90), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        text("""
            SELECT date_trunc('day', timestamp)::date::text AS date,
                   COALESCE(SUM(cost_usd), 0) AS total_usd
            FROM usage_events
            WHERE timestamp >= NOW() - INTERVAL ':days days'
            GROUP BY 1 ORDER BY 1
        """).bindparams(days=days)
    )
    return [DailySpend(date=row.date, total_usd=float(row.total_usd)) for row in result]

@router.get("/by-team", response_model=list[TeamSpend])
async def spend_by_team(month: str = Query(..., pattern=r"^\d{4}-\d{2}$"), db: AsyncSession = Depends(get_db)):
    from app.models import Team
    result = await db.execute(
        text("""
            SELECT e.team_id, e.department,
                   COALESCE(SUM(e.cost_usd), 0) AS total_usd,
                   COALESCE(SUM(e.prompt_tokens + e.completion_tokens), 0) AS total_tokens,
                   COALESCE(MAX(t.monthly_budget_usd), 0) AS budget_usd
            FROM usage_events e
            LEFT JOIN teams t ON t.name = e.team_id
            WHERE to_char(e.timestamp AT TIME ZONE 'UTC', 'YYYY-MM') = :month
            GROUP BY e.team_id, e.department
            ORDER BY total_usd DESC
        """).bindparams(month=month)
    )
    return [
        TeamSpend(team_id=r.team_id, department=r.department,
                  total_usd=float(r.total_usd), total_tokens=int(r.total_tokens),
                  budget_usd=float(r.budget_usd))
        for r in result
    ]
```

- [ ] **Step 4: Implement app/routers/chargeback.py**

```python
from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.db import get_db
from app.schemas import ChargebackReport, ChargebackRow

router = APIRouter(prefix="/chargeback")

def _status(spent: float, budget: float) -> str:
    if budget <= 0:
        return "on_track"
    pct = spent / budget
    if pct >= 1.0:
        return "over_budget"
    if pct >= 0.8:
        return "near_limit"
    return "on_track"

@router.get("", response_model=ChargebackReport)
async def chargeback_report(month: str = Query(..., pattern=r"^\d{4}-\d{2}$"), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        text("""
            SELECT e.department, e.team_id,
                   COALESCE(SUM(e.prompt_tokens + e.completion_tokens), 0) AS total_tokens,
                   COALESCE(SUM(e.cost_usd), 0) AS total_usd,
                   COALESCE(MAX(t.monthly_budget_usd), 0) AS budget_usd
            FROM usage_events e
            LEFT JOIN teams t ON t.name = e.team_id
            WHERE to_char(e.timestamp AT TIME ZONE 'UTC', 'YYYY-MM') = :month
            GROUP BY e.department, e.team_id
            ORDER BY total_usd DESC
        """).bindparams(month=month)
    )
    rows = []
    total_usd = 0.0
    total_budget = 0.0
    for r in result:
        spent = float(r.total_usd)
        budget = float(r.budget_usd)
        pct = (spent / budget * 100) if budget > 0 else 0.0
        rows.append(ChargebackRow(
            department=r.department, team_id=r.team_id,
            total_tokens=int(r.total_tokens), total_usd=spent,
            budget_usd=budget, utilisation_pct=round(pct, 1),
            status=_status(spent, budget),
        ))
        total_usd += spent
        total_budget += budget
    return ChargebackReport(month=month, rows=rows, total_usd=total_usd, total_budget_usd=total_budget)
```

- [ ] **Step 5: Run tests**

```bash
pytest tests/test_costs.py tests/test_chargeback.py -v
```

Expected: all passed.

- [ ] **Step 6: Commit**

```bash
git add aira-backend/app/routers/costs.py aira-backend/app/routers/chargeback.py \
        aira-backend/tests/test_costs.py aira-backend/tests/test_chargeback.py
git commit -m "feat(backend): cost and chargeback API endpoints"
```

---

## Task 9: Teams endpoint

**Files:**
- Create: `aira-backend/app/routers/teams.py`

- [ ] **Step 1: Implement app/routers/teams.py**

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.db import get_db
from app.models import Team
from app.schemas import TeamCreate, TeamOut

router = APIRouter(prefix="/teams")

@router.get("", response_model=list[TeamOut])
async def list_teams(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Team).order_by(Team.name))
    return result.scalars().all()

@router.post("", response_model=TeamOut, status_code=201)
async def create_team(body: TeamCreate, db: AsyncSession = Depends(get_db)):
    team = Team(**body.model_dump())
    db.add(team)
    await db.commit()
    await db.refresh(team)
    return team

@router.patch("/{team_id}/budget", response_model=TeamOut)
async def update_budget(team_id: int, monthly_budget_usd: float, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Team).where(Team.id == team_id))
    team = result.scalar_one_or_none()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    team.monthly_budget_usd = monthly_budget_usd
    await db.commit()
    await db.refresh(team)
    return team
```

- [ ] **Step 2: Run all tests**

```bash
pytest -v --cov=app --cov-report=term-missing
```

Expected: all pass, coverage >70%.

- [ ] **Step 3: Commit**

```bash
git add aira-backend/app/routers/teams.py
git commit -m "feat(backend): teams CRUD endpoint"
```

---

## Task 10: Smoke test Kong AI Gateway → backend end-to-end

> **Note:** `kong.yml` is already updated with Kong AI Gateway plugins (`ai-proxy`, `ai-rate-limiting-advanced`, `ai-prompt-guard`, `http-log`, `openid-connect` with claim forwarding). This task only verifies the wiring is working end-to-end.

**Files:** None to create or modify.

- [ ] **Step 1: Start all services**

```bash
cd kong
docker compose up -d
```

- [ ] **Step 2: Get a token with team claims**

```bash
TOKEN=$(curl -s -X POST "http://localhost:8080/default/token?claims=%7B%22team_id%22%3A%22nlp-platform%22%2C%22department%22%3A%22R%26D%22%7D" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=aira-local&client_secret=aira-secret&scope=openid" \
  | jq -r .access_token)
echo $TOKEN
```

Expected: a JWT string.

- [ ] **Step 3: Make an AI call through Kong**

```bash
curl -s -o /dev/null -w "%{http_code}" \
  -X POST http://localhost:8000/openai/v1/chat/completions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"Hello"}]}'
```

Expected: `200` (with real API key) or `401` from upstream (no key) — either way Kong processed the request.

- [ ] **Step 4: Verify event was ingested**

```bash
curl "http://localhost:8002/costs/daily?days=1"
```

Expected: JSON list with today's date and a non-zero `total_usd`.

- [ ] **Step 5: Verify PII guard blocks sensitive content**

```bash
curl -s -w "\n%{http_code}" \
  -X POST http://localhost:8000/openai/v1/chat/completions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"My SSN is 123-45-6789, help me"}]}'
```

Expected: `400` blocked by `ai-prompt-guard`.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "test(kong): verify AI Gateway end-to-end smoke test"
```

---

## Task 11: Seed script for demo data

**Files:**
- Create: `aira-backend/scripts/seed_demo.py`

- [ ] **Step 1: Create seed script**

```python
#!/usr/bin/env python3
"""Seed 90 days of realistic demo data for the AIRA dashboard."""
import asyncio
import random
from datetime import datetime, timedelta, timezone
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.models import Base, Team, UsageEvent
from app.pricing import cost_usd

DB = "postgresql+asyncpg://aira:aira@localhost:5432/aira"

TEAMS = [
    ("nlp-platform",  "R&D",     8000.0),
    ("data-science",  "R&D",     6000.0),
    ("product-ai",    "Product", 3000.0),
    ("customer-ops",  "CX",      4000.0),
]

MODELS = [
    ("openai",    "gpt-4o",                    0.6),
    ("openai",    "gpt-4o-mini",               0.2),
    ("anthropic", "claude-sonnet-4-6",         0.1),
    ("anthropic", "claude-haiku-4-5-20251001", 0.1),
]

async def main():
    engine = create_async_engine(DB)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False)
    async with Session() as session:
        # Create teams
        for name, dept, budget in TEAMS:
            session.add(Team(name=name, department=dept, monthly_budget_usd=budget))
        await session.commit()

        # Seed 90 days of events
        now = datetime.now(tz=timezone.utc)
        events = []
        for day_offset in range(90):
            day = now - timedelta(days=90 - day_offset)
            for team_name, dept, _ in TEAMS:
                daily_calls = random.randint(80, 400)
                for _ in range(daily_calls):
                    provider, model, _ = random.choices(MODELS, weights=[m[2] for m in MODELS])[0]
                    prompt_tok = random.randint(200, 2000)
                    comp_tok = random.randint(50, 800)
                    try:
                        usd = cost_usd(provider, model, prompt_tok, comp_tok)
                    except ValueError:
                        usd = 0.0
                    events.append(UsageEvent(
                        timestamp=day.replace(
                            hour=random.randint(8, 20),
                            minute=random.randint(0, 59),
                        ),
                        user_id=f"user-{random.randint(1, 10):03d}",
                        team_id=team_name,
                        department=dept,
                        provider=provider,
                        model=model,
                        prompt_tokens=prompt_tok,
                        completion_tokens=comp_tok,
                        cost_usd=usd,
                        latency_ms=random.randint(200, 2000),
                    ))
        session.add_all(events)
        await session.commit()
        print(f"Seeded {len(events)} events across {len(TEAMS)} teams.")
    await engine.dispose()

if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 2: Run seed script**

```bash
cd aira-backend
python scripts/seed_demo.py
```

Expected: `Seeded ~108000 events across 4 teams.`

- [ ] **Step 3: Verify data**

```bash
curl "http://localhost:8002/chargeback?month=$(date +%Y-%m)"
```

Expected: JSON with 4 rows, all with non-zero spend.

- [ ] **Step 4: Commit**

```bash
git add aira-backend/scripts/seed_demo.py
git commit -m "feat(backend): demo data seed script"
```

---

## Verification Checklist

- [ ] `pytest -v` — all tests pass
- [ ] `docker compose up -d` → all 5 containers healthy (`kong`, `mock-oauth2`, `timescaledb`, `redis`, `aira-backend`)
- [ ] `curl http://localhost:8002/health` → `{"ok": true}`
- [ ] `curl http://localhost:8002/chargeback?month=2026-04` → returns 4 team rows
- [ ] Make an AI call through Kong → check `curl http://localhost:8002/costs/daily?days=1` shows today's spend increased

---

## Next Plans

- **Plan B** — `2026-04-22-aira-plan-b-forecast.md` — Claude Sonnet forecast service + anomaly detector
- **Plan C** — `2026-04-22-aira-plan-c-client.md` — AIRA Client chat UI (Next.js)
- **Plan D** — `2026-04-22-aira-plan-d-dashboard.md` — AIRA Dashboard governance views (Next.js)
