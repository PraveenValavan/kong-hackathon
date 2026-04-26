import os, tempfile, datetime, pytest
from fastapi.testclient import TestClient

# Point DB at a temp file before importing the app
_tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
os.environ["DB_PATH"] = _tmp.name

from main import app, init_db, get_db  # noqa: E402

init_db(_tmp.name)
client = TestClient(app)

# ── Fixtures ──────────────────────────────────────────────────────────────────

def _event(
    event_id="req-001",
    user_id="engineer-001",
    team_id="nlp-platform",
    department="R&D",
    session_id="sess-aaa",
    model="claude-haiku-4-5-20251001",
    provider="anthropic",
    prompt_tokens=10,
    completion_tokens=20,
    cost=0,
    status=200,
) -> dict:
    return {
        "request":              {"id": event_id, "headers": {}},
        "authenticated_entity": {"id": user_id},
        "user_id":    user_id,
        "team_id":    team_id,
        "department": department,
        "session_id": session_id,
        "started_at": 1_700_000_000_000,
        "latencies":  {"request": 500},
        "response":   {"status": status},
        "ai": {
            "ai-proxy": {
                "meta":  {"provider_name": provider, "response_model": model},
                "usage": {
                    "prompt_tokens":     prompt_tokens,
                    "completion_tokens": completion_tokens,
                    "total_tokens":      prompt_tokens + completion_tokens,
                    "cost":              cost,
                },
            }
        },
    }


def _clear():
    with get_db(_tmp.name) as conn:
        conn.execute("DELETE FROM usage_events")
        conn.commit()


# ── Tests ─────────────────────────────────────────────────────────────────────

def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_ingest_stores_event():
    _clear()
    r = client.post("/ingest/event", json=_event())
    assert r.status_code == 204

    rows = client.get("/usage/events").json()
    assert len(rows) == 1
    row = rows[0]
    assert row["user_id"] == "engineer-001"
    assert row["department"] == "R&D"
    assert row["session_id"] == "sess-aaa"
    assert row["model"] == "claude-haiku-4-5-20251001"
    assert row["total_tokens"] == 30


def test_ingest_idempotent():
    _clear()
    client.post("/ingest/event", json=_event(event_id="dup-001"))
    client.post("/ingest/event", json=_event(event_id="dup-001"))

    rows = client.get("/usage/events").json()
    assert len(rows) == 1, "duplicate event_id must not create two rows"


def test_ingest_calculates_cost_from_model():
    _clear()
    # haiku pricing: in=0.80, out=4.00 per 1M tokens
    # 100 prompt + 200 completion = (100*0.80 + 200*4.00) / 1_000_000 = 0.00088
    client.post("/ingest/event", json=_event(
        event_id="cost-001", prompt_tokens=100, completion_tokens=200, cost=0
    ))
    row = client.get("/usage/events").json()[0]
    assert abs(row["cost_usd"] - 0.00088) < 1e-9


def test_ingest_uses_kong_cost_when_provided():
    _clear()
    client.post("/ingest/event", json=_event(
        event_id="kong-cost-001", prompt_tokens=100, completion_tokens=200, cost=0.999
    ))
    row = client.get("/usage/events").json()[0]
    assert row["cost_usd"] == 0.999


def test_summary_by_user():
    _clear()
    client.post("/ingest/event", json=_event(event_id="u1", user_id="alice", prompt_tokens=10, completion_tokens=10))
    client.post("/ingest/event", json=_event(event_id="u2", user_id="bob",   prompt_tokens=50, completion_tokens=50))

    data = client.get("/usage/summary?group_by=user_id").json()
    users = {r["user_id"]: r for r in data}
    assert "alice" in users and "bob" in users
    assert users["bob"]["total_tokens"] > users["alice"]["total_tokens"]


def test_summary_by_department():
    _clear()
    client.post("/ingest/event", json=_event(event_id="d1", department="Finance", prompt_tokens=100, completion_tokens=100))
    client.post("/ingest/event", json=_event(event_id="d2", department="R&D",     prompt_tokens=10,  completion_tokens=10))

    data = client.get("/usage/summary?group_by=department").json()
    depts = {r["department"]: r for r in data}
    assert depts["Finance"]["total_tokens"] == 200
    assert depts["R&D"]["total_tokens"] == 20


def test_events_filter_by_user():
    _clear()
    client.post("/ingest/event", json=_event(event_id="f1", user_id="alice"))
    client.post("/ingest/event", json=_event(event_id="f2", user_id="bob"))

    data = client.get("/usage/events?user_id=alice").json()
    assert all(r["user_id"] == "alice" for r in data)
    assert len(data) == 1


def test_sessions_groups_by_session_id():
    _clear()
    client.post("/ingest/event", json=_event(event_id="s1", session_id="sess-xyz", prompt_tokens=10, completion_tokens=5))
    client.post("/ingest/event", json=_event(event_id="s2", session_id="sess-xyz", prompt_tokens=20, completion_tokens=10))
    client.post("/ingest/event", json=_event(event_id="s3", session_id="sess-abc", prompt_tokens=5,  completion_tokens=5))

    sessions = client.get("/usage/sessions").json()
    by_id = {s["session_id"]: s for s in sessions}

    assert "sess-xyz" in by_id
    assert by_id["sess-xyz"]["requests"] == 2
    assert by_id["sess-xyz"]["total_tokens"] == 45  # (10+5) + (20+10)


def test_get_session_detail():
    _clear()
    client.post("/ingest/event", json=_event(event_id="det-1", session_id="sess-detail"))
    client.post("/ingest/event", json=_event(event_id="det-2", session_id="sess-detail", prompt_tokens=50, completion_tokens=50))

    r = client.get("/usage/sessions/sess-detail")
    assert r.status_code == 200
    data = r.json()
    assert data["session_id"] == "sess-detail"
    assert data["requests"] == 2
    assert len(data["events"]) == 2


def test_get_session_not_found():
    r = client.get("/usage/sessions/does-not-exist")
    assert r.status_code == 404


# ── Cost by user ──────────────────────────────────────────────────────────────

def test_cost_by_user_lists_all():
    _clear()
    client.post("/ingest/event", json=_event(event_id="cu1", user_id="alice", department="R&D",     prompt_tokens=100, completion_tokens=100))
    client.post("/ingest/event", json=_event(event_id="cu2", user_id="bob",   department="Finance", prompt_tokens=50,  completion_tokens=50))

    data = client.get("/usage/cost/by-user").json()
    users = {r["user_id"]: r for r in data}
    assert "alice" in users and "bob" in users
    # alice used more tokens so higher cost — result ordered by cost desc
    assert data[0]["user_id"] == "alice"


def test_cost_by_user_filter_department():
    _clear()
    client.post("/ingest/event", json=_event(event_id="cd1", user_id="alice", department="R&D"))
    client.post("/ingest/event", json=_event(event_id="cd2", user_id="bob",   department="Finance"))

    data = client.get("/usage/cost/by-user?department=R%26D").json()
    assert len(data) == 1
    assert data[0]["user_id"] == "alice"


def test_cost_for_user_detail():
    _clear()
    client.post("/ingest/event", json=_event(event_id="ud1", user_id="alice", prompt_tokens=10, completion_tokens=10))
    client.post("/ingest/event", json=_event(event_id="ud2", user_id="alice", prompt_tokens=20, completion_tokens=20))

    data = client.get("/usage/cost/by-user/alice").json()
    assert data["user_id"] == "alice"
    assert data["requests"] == 2
    assert data["total_tokens"] == 60
    assert len(data["by_day"]) >= 1
    assert len(data["by_model"]) >= 1


def test_cost_for_user_not_found():
    r = client.get("/usage/cost/by-user/nobody")
    assert r.status_code == 404


# ── Cost by department ────────────────────────────────────────────────────────

def test_cost_by_department_lists_all():
    _clear()
    client.post("/ingest/event", json=_event(event_id="dp1", user_id="alice", department="R&D",     prompt_tokens=200, completion_tokens=200))
    client.post("/ingest/event", json=_event(event_id="dp2", user_id="bob",   department="Finance", prompt_tokens=10,  completion_tokens=10))

    data = client.get("/usage/cost/by-department").json()
    depts = {r["department"]: r for r in data}
    assert "R&D" in depts and "Finance" in depts
    assert depts["R&D"]["total_tokens"] == 400
    assert data[0]["department"] == "R&D"  # ordered by cost desc


def test_cost_for_department_detail():
    _clear()
    client.post("/ingest/event", json=_event(event_id="dd1", user_id="alice", department="R&D", prompt_tokens=50, completion_tokens=50))
    client.post("/ingest/event", json=_event(event_id="dd2", user_id="bob",   department="R&D", prompt_tokens=30, completion_tokens=30))

    data = client.get("/usage/cost/by-department/R%26D").json()
    assert data["department"] == "R&D"
    assert data["unique_users"] == 2
    assert data["requests"] == 2
    assert len(data["by_user"]) == 2
    assert len(data["by_model"]) >= 1


def test_cost_for_department_not_found():
    r = client.get("/usage/cost/by-department/Unknown")
    assert r.status_code == 404


def test_dashboard_structure_and_filters():
    _clear()
    client.post("/ingest/event", json=_event(event_id="dsh1", user_id="alice", department="R&D",     session_id="s1", prompt_tokens=100, completion_tokens=50))
    client.post("/ingest/event", json=_event(event_id="dsh2", user_id="bob",   department="Finance", session_id="s2", prompt_tokens=20,  completion_tokens=10))
    client.post("/ingest/event", json=_event(event_id="dsh3", user_id="alice", department="R&D",     session_id="s1", prompt_tokens=30,  completion_tokens=20))

    data = client.get("/usage/dashboard").json()

    assert data["totals"]["total_requests"] == 3
    assert data["totals"]["unique_users"] == 2
    assert data["totals"]["total_tokens"] == 230  # (150+30+50) = 230

    users = {r["user_id"]: r for r in data["by_user"]}
    assert "alice" in users and "bob" in users
    assert users["alice"]["requests"] == 2

    depts = {r["department"]: r for r in data["by_department"]}
    assert "R&D" in depts and "Finance" in depts

    assert len(data["by_model"]) >= 1
    assert len(data["by_day"]) >= 1

    # Filter by department
    filtered = client.get("/usage/dashboard?department=Finance").json()
    assert filtered["totals"]["total_requests"] == 1
    assert filtered["by_department"][0]["department"] == "Finance"

    # Filter by user
    filtered = client.get("/usage/dashboard?user_id=alice").json()
    assert filtered["totals"]["unique_users"] == 1
    assert filtered["totals"]["total_requests"] == 2


def test_cost_date_range_filter():
    _clear()
    today = datetime.date.today().isoformat()
    today_ts = int(datetime.datetime.now().timestamp() * 1000)

    # Old event inserted directly with a past date
    with get_db(_tmp.name) as conn:
        conn.execute("""
            INSERT INTO usage_events
                (event_id, ts, session_date, user_id, department, provider, model,
                 prompt_tokens, completion_tokens, total_tokens, cost_usd, latency_ms, status)
            VALUES ('old-1','2024-01-01T00:00:00','2024-01-01','alice','R&D','anthropic',
                    'claude-haiku-4-5-20251001',100,100,200,0.00096,500,200)
        """)
        conn.commit()

    # Today's event — override started_at so session_date resolves to today
    payload = _event(event_id="new-1", user_id="alice", department="R&D")
    payload["started_at"] = today_ts
    client.post("/ingest/event", json=payload)

    data = client.get(f"/usage/cost/by-user?since={today}").json()
    row = next((r for r in data if r["user_id"] == "alice"), None)
    assert row is not None
    assert row["requests"] == 1  # only the today event


# ── Forecast ──────────────────────────────────────────────────────────────────

from unittest.mock import patch, MagicMock

def _mock_claude(text: str):
    msg = MagicMock()
    msg.content = [MagicMock(text=text)]
    return msg

FORECAST_JSON = '{"narrative":"Test forecast.","projected_eom":100.0,"potential_saving":20.0,"risk_teams":["nlp-platform"]}'

def test_forecast_returns_expected_shape():
    _clear()
    client.post("/ingest/event", json=_event())
    with patch("main.anthropic") as mock_anthropic:
        mock_anthropic.Anthropic.return_value.messages.create.return_value = _mock_claude(FORECAST_JSON)
        resp = client.get("/forecast")
    assert resp.status_code == 200
    data = resp.json()
    assert "narrative" in data
    assert "projected_eom" in data
    assert "potential_saving" in data
    assert "risk_teams" in data
    assert "generated_at" in data
    assert data["department"] is None

def test_forecast_department_filter():
    _clear()
    client.post("/ingest/event", json=_event(department="R&D"))
    rd_json = '{"narrative":"R&D forecast.","projected_eom":50.0,"potential_saving":10.0,"risk_teams":["nlp-platform"]}'
    with patch("main.anthropic") as mock_anthropic:
        mock_anthropic.Anthropic.return_value.messages.create.return_value = _mock_claude(rd_json)
        resp = client.get("/forecast?department=R%26D")
    assert resp.status_code == 200
    data = resp.json()
    assert data["department"] == "R&D"
    assert data["narrative"] == "R&D forecast."

def test_forecast_handles_no_data():
    _clear()
    with patch("main.anthropic") as mock_anthropic:
        mock_anthropic.Anthropic.return_value.messages.create.return_value = _mock_claude(
            '{"narrative":"No data.","projected_eom":0.0,"potential_saving":0.0,"risk_teams":[]}'
        )
        resp = client.get("/forecast")
    assert resp.status_code == 200
