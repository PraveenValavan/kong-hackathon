from fastapi import FastAPI, HTTPException
from typing import Any, Optional
import sqlite3, os, datetime

app = FastAPI(title="AIRA Usage Backend")

DB_PATH = os.getenv("DB_PATH", "/data/aira-usage.db")

MODEL_COSTS: dict[str, tuple[float, float]] = {
    "claude-haiku-4-5-20251001": (0.80,  4.00),
    "claude-sonnet-4-6":         (3.00,  15.00),
    "claude-opus-4-7":           (15.00, 75.00),
    "gpt-4o":                    (2.50,  10.00),
    "gemini-2.5-flash":          (0.075, 0.30),
}


# ── DB ────────────────────────────────────────────────────────────────────────

def get_db(path: str = DB_PATH):
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn


def init_db(path: str = DB_PATH):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with get_db(path) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS usage_events (
                id                INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id          TEXT UNIQUE,
                ts                TEXT NOT NULL,
                session_date      TEXT NOT NULL,
                session_id        TEXT,
                user_id           TEXT,
                team_id           TEXT,
                department        TEXT,
                provider          TEXT,
                model             TEXT,
                prompt_tokens     INTEGER DEFAULT 0,
                completion_tokens INTEGER DEFAULT 0,
                total_tokens      INTEGER DEFAULT 0,
                cost_usd          REAL    DEFAULT 0,
                latency_ms        INTEGER DEFAULT 0,
                status            INTEGER
            )
        """)
        # Migrate existing tables that predate the session_id column
        cols = {r[1] for r in conn.execute("PRAGMA table_info(usage_events)")}
        if "session_id" not in cols:
            conn.execute("ALTER TABLE usage_events ADD COLUMN session_id TEXT")
        conn.commit()


@app.on_event("startup")
def startup():
    init_db()


# ── Ingest ────────────────────────────────────────────────────────────────────

@app.post("/ingest/event", status_code=204)
async def ingest_event(payload: dict[str, Any]):
    ai      = payload.get("ai", {}).get("ai-proxy", {})
    usage   = ai.get("usage", {})
    meta    = ai.get("meta", {})
    entity  = payload.get("authenticated_entity", {})
    req     = payload.get("request", {})
    headers = req.get("headers", {})

    user_id    = payload.get("user_id") or entity.get("id")
    team_id    = payload.get("team_id") or headers.get("x-team-id")
    department = payload.get("department") or headers.get("x-department")
    session_id = payload.get("session_id") or headers.get("x-session-id")
    provider   = meta.get("provider_name")
    model      = meta.get("response_model")

    prompt_tokens     = usage.get("prompt_tokens", 0) or 0
    completion_tokens = usage.get("completion_tokens", 0) or 0
    total_tokens      = usage.get("total_tokens", 0) or 0

    cost_usd = usage.get("cost") or 0
    if not cost_usd and model and model in MODEL_COSTS:
        in_rate, out_rate = MODEL_COSTS[model]
        cost_usd = (prompt_tokens * in_rate + completion_tokens * out_rate) / 1_000_000

    started_at   = payload.get("started_at", 0)
    ts           = datetime.datetime.utcfromtimestamp(started_at / 1000).isoformat() if started_at else datetime.datetime.utcnow().isoformat()
    session_date = ts[:10]
    event_id     = req.get("id")
    latency_ms   = payload.get("latencies", {}).get("request", 0)
    status       = payload.get("response", {}).get("status")

    with get_db() as conn:
        conn.execute("""
            INSERT OR IGNORE INTO usage_events
                (event_id, ts, session_date, session_id, user_id, team_id,
                 department, provider, model, prompt_tokens, completion_tokens,
                 total_tokens, cost_usd, latency_ms, status)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (event_id, ts, session_date, session_id, user_id, team_id,
              department, provider, model, prompt_tokens, completion_tokens,
              total_tokens, cost_usd, latency_ms, status))
        conn.commit()


# ── Query ─────────────────────────────────────────────────────────────────────

@app.get("/usage/events")
def list_events(
    user_id: Optional[str] = None,
    department: Optional[str] = None,
    session_id: Optional[str] = None,
    session_date: Optional[str] = None,
    limit: int = 50,
):
    filters, params = [], []
    if user_id:
        filters.append("user_id = ?");     params.append(user_id)
    if department:
        filters.append("department = ?");  params.append(department)
    if session_id:
        filters.append("session_id = ?");  params.append(session_id)
    if session_date:
        filters.append("session_date = ?"); params.append(session_date)

    where = ("WHERE " + " AND ".join(filters)) if filters else ""
    params.append(limit)

    with get_db() as conn:
        rows = conn.execute(
            f"SELECT * FROM usage_events {where} ORDER BY ts DESC LIMIT ?", params
        ).fetchall()
    return [dict(r) for r in rows]


@app.get("/usage/summary")
def usage_summary(
    group_by: str = "user_id",
    session_date: Optional[str] = None,
    department: Optional[str] = None,
):
    allowed = {"user_id", "department", "model", "provider", "session_date", "team_id", "session_id"}
    if group_by not in allowed:
        raise HTTPException(400, f"group_by must be one of {allowed}")

    filters, params = ["status = 200"], []
    if session_date:
        filters.append("session_date = ?"); params.append(session_date)
    if department:
        filters.append("department = ?");   params.append(department)

    where = "WHERE " + " AND ".join(filters)

    with get_db() as conn:
        rows = conn.execute(f"""
            SELECT
                {group_by},
                COUNT(*)                AS requests,
                SUM(prompt_tokens)      AS prompt_tokens,
                SUM(completion_tokens)  AS completion_tokens,
                SUM(total_tokens)       AS total_tokens,
                ROUND(SUM(cost_usd), 6) AS total_cost_usd,
                ROUND(AVG(latency_ms))  AS avg_latency_ms
            FROM usage_events
            {where}
            GROUP BY {group_by}
            ORDER BY total_cost_usd DESC
        """, params).fetchall()
    return [dict(r) for r in rows]


@app.get("/usage/sessions")
def list_sessions(user_id: Optional[str] = None, limit: int = 30):
    filters, params = ["status = 200", "session_id IS NOT NULL"], []
    if user_id:
        filters.append("user_id = ?"); params.append(user_id)

    where = "WHERE " + " AND ".join(filters)
    params.append(limit)

    with get_db() as conn:
        rows = conn.execute(f"""
            SELECT
                session_id,
                session_date,
                user_id,
                department,
                COUNT(*)                AS requests,
                SUM(total_tokens)       AS total_tokens,
                ROUND(SUM(cost_usd), 6) AS total_cost_usd,
                GROUP_CONCAT(DISTINCT model) AS models_used
            FROM usage_events
            {where}
            GROUP BY session_id
            ORDER BY session_date DESC, session_id
            LIMIT ?
        """, params).fetchall()
    return [dict(r) for r in rows]


@app.get("/usage/sessions/{session_id}")
def get_session(session_id: str):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM usage_events WHERE session_id = ? ORDER BY ts",
            (session_id,)
        ).fetchall()
    if not rows:
        raise HTTPException(404, "session not found")
    events = [dict(r) for r in rows]
    return {
        "session_id":   session_id,
        "user_id":      events[0]["user_id"],
        "department":   events[0]["department"],
        "requests":     len(events),
        "total_tokens": sum(e["total_tokens"] for e in events),
        "total_cost_usd": round(sum(e["cost_usd"] for e in events), 6),
        "models_used":  list({e["model"] for e in events if e["model"]}),
        "events":       events,
    }


@app.get("/usage/cost/by-user")
def cost_by_user(
    department: Optional[str] = None,
    since: Optional[str] = None,   # YYYY-MM-DD
    until: Optional[str] = None,   # YYYY-MM-DD
):
    filters, params = ["status = 200"], []
    if department:
        filters.append("department = ?");    params.append(department)
    if since:
        filters.append("session_date >= ?"); params.append(since)
    if until:
        filters.append("session_date <= ?"); params.append(until)

    where = "WHERE " + " AND ".join(filters)

    with get_db() as conn:
        rows = conn.execute(f"""
            SELECT
                user_id,
                team_id,
                department,
                COUNT(*)                        AS requests,
                SUM(prompt_tokens)              AS prompt_tokens,
                SUM(completion_tokens)          AS completion_tokens,
                SUM(total_tokens)               AS total_tokens,
                ROUND(SUM(cost_usd), 6)         AS total_cost_usd,
                ROUND(AVG(latency_ms))          AS avg_latency_ms,
                GROUP_CONCAT(DISTINCT model)    AS models_used,
                MIN(session_date)               AS first_seen,
                MAX(session_date)               AS last_seen
            FROM usage_events
            {where}
            GROUP BY user_id
            ORDER BY total_cost_usd DESC
        """, params).fetchall()
    return [dict(r) for r in rows]


@app.get("/usage/cost/by-user/{user_id}")
def cost_for_user(
    user_id: str,
    since: Optional[str] = None,
    until: Optional[str] = None,
):
    filters, params = ["status = 200", "user_id = ?"], [user_id]
    if since:
        filters.append("session_date >= ?"); params.append(since)
    if until:
        filters.append("session_date <= ?"); params.append(until)

    where = "WHERE " + " AND ".join(filters)

    with get_db() as conn:
        totals = conn.execute(f"""
            SELECT
                user_id, team_id, department,
                COUNT(*)                     AS requests,
                SUM(prompt_tokens)           AS prompt_tokens,
                SUM(completion_tokens)       AS completion_tokens,
                SUM(total_tokens)            AS total_tokens,
                ROUND(SUM(cost_usd), 6)      AS total_cost_usd,
                ROUND(AVG(latency_ms))       AS avg_latency_ms,
                MIN(session_date)            AS first_seen,
                MAX(session_date)            AS last_seen
            FROM usage_events {where}
            GROUP BY user_id
        """, params).fetchone()

        if not totals:
            raise HTTPException(404, f"no data for user {user_id!r}")

        by_day = conn.execute(f"""
            SELECT
                session_date,
                COUNT(*)               AS requests,
                SUM(total_tokens)      AS total_tokens,
                ROUND(SUM(cost_usd),6) AS cost_usd
            FROM usage_events {where}
            GROUP BY session_date
            ORDER BY session_date DESC
        """, params).fetchall()

        by_model = conn.execute(f"""
            SELECT
                model,
                COUNT(*)               AS requests,
                SUM(total_tokens)      AS total_tokens,
                ROUND(SUM(cost_usd),6) AS cost_usd
            FROM usage_events {where}
            GROUP BY model
            ORDER BY cost_usd DESC
        """, params).fetchall()

    return {
        **dict(totals),
        "by_day":   [dict(r) for r in by_day],
        "by_model": [dict(r) for r in by_model],
    }


@app.get("/usage/cost/by-department")
def cost_by_department(
    since: Optional[str] = None,
    until: Optional[str] = None,
):
    filters, params = ["status = 200"], []
    if since:
        filters.append("session_date >= ?"); params.append(since)
    if until:
        filters.append("session_date <= ?"); params.append(until)

    where = "WHERE " + " AND ".join(filters)

    with get_db() as conn:
        rows = conn.execute(f"""
            SELECT
                department,
                COUNT(DISTINCT user_id)         AS unique_users,
                COUNT(*)                        AS requests,
                SUM(prompt_tokens)              AS prompt_tokens,
                SUM(completion_tokens)          AS completion_tokens,
                SUM(total_tokens)               AS total_tokens,
                ROUND(SUM(cost_usd), 6)         AS total_cost_usd,
                ROUND(AVG(latency_ms))          AS avg_latency_ms,
                GROUP_CONCAT(DISTINCT model)    AS models_used
            FROM usage_events
            {where}
            GROUP BY department
            ORDER BY total_cost_usd DESC
        """, params).fetchall()
    return [dict(r) for r in rows]


@app.get("/usage/cost/by-department/{department}")
def cost_for_department(
    department: str,
    since: Optional[str] = None,
    until: Optional[str] = None,
):
    filters, params = ["status = 200", "department = ?"], [department]
    if since:
        filters.append("session_date >= ?"); params.append(since)
    if until:
        filters.append("session_date <= ?"); params.append(until)

    where = "WHERE " + " AND ".join(filters)

    with get_db() as conn:
        totals = conn.execute(f"""
            SELECT
                department,
                COUNT(DISTINCT user_id)      AS unique_users,
                COUNT(*)                     AS requests,
                SUM(total_tokens)            AS total_tokens,
                ROUND(SUM(cost_usd), 6)      AS total_cost_usd,
                MIN(session_date)            AS first_seen,
                MAX(session_date)            AS last_seen
            FROM usage_events {where}
            GROUP BY department
        """, params).fetchone()

        if not totals:
            raise HTTPException(404, f"no data for department {department!r}")

        by_user = conn.execute(f"""
            SELECT
                user_id,
                COUNT(*)               AS requests,
                SUM(total_tokens)      AS total_tokens,
                ROUND(SUM(cost_usd),6) AS cost_usd
            FROM usage_events {where}
            GROUP BY user_id
            ORDER BY cost_usd DESC
        """, params).fetchall()

        by_model = conn.execute(f"""
            SELECT
                model,
                COUNT(*)               AS requests,
                SUM(total_tokens)      AS total_tokens,
                ROUND(SUM(cost_usd),6) AS cost_usd
            FROM usage_events {where}
            GROUP BY model
            ORDER BY cost_usd DESC
        """, params).fetchall()

    return {
        **dict(totals),
        "by_user":  [dict(r) for r in by_user],
        "by_model": [dict(r) for r in by_model],
    }


@app.get("/usage/dashboard")
def dashboard(
    since: Optional[str] = None,        # YYYY-MM-DD
    until: Optional[str] = None,        # YYYY-MM-DD
    department: Optional[str] = None,
    user_id: Optional[str] = None,
    provider: Optional[str] = None,
):
    filters, params = ["status = 200"], []
    if since:
        filters.append("session_date >= ?"); params.append(since)
    if until:
        filters.append("session_date <= ?"); params.append(until)
    if department:
        filters.append("department = ?");   params.append(department)
    if user_id:
        filters.append("user_id = ?");      params.append(user_id)
    if provider:
        filters.append("provider = ?");     params.append(provider)

    where = "WHERE " + " AND ".join(filters)

    with get_db() as conn:
        totals = conn.execute(f"""
            SELECT
                COUNT(*)                        AS total_requests,
                COUNT(DISTINCT user_id)         AS unique_users,
                COUNT(DISTINCT session_id)      AS unique_sessions,
                SUM(prompt_tokens)              AS total_prompt_tokens,
                SUM(completion_tokens)          AS total_completion_tokens,
                SUM(total_tokens)               AS total_tokens,
                ROUND(SUM(cost_usd), 6)         AS total_cost_usd,
                ROUND(AVG(latency_ms))          AS avg_latency_ms,
                MIN(session_date)               AS period_start,
                MAX(session_date)               AS period_end
            FROM usage_events {where}
        """, params).fetchone()

        by_user = conn.execute(f"""
            SELECT user_id, department, team_id,
                COUNT(*)                AS requests,
                SUM(total_tokens)       AS total_tokens,
                ROUND(SUM(cost_usd),6)  AS cost_usd
            FROM usage_events {where}
            GROUP BY user_id ORDER BY cost_usd DESC
        """, params).fetchall()

        by_department = conn.execute(f"""
            SELECT department,
                COUNT(DISTINCT user_id) AS unique_users,
                COUNT(*)                AS requests,
                SUM(total_tokens)       AS total_tokens,
                ROUND(SUM(cost_usd),6)  AS cost_usd
            FROM usage_events {where}
            GROUP BY department ORDER BY cost_usd DESC
        """, params).fetchall()

        by_model = conn.execute(f"""
            SELECT model, provider,
                COUNT(*)                AS requests,
                SUM(prompt_tokens)      AS prompt_tokens,
                SUM(completion_tokens)  AS completion_tokens,
                SUM(total_tokens)       AS total_tokens,
                ROUND(SUM(cost_usd),6)  AS cost_usd
            FROM usage_events {where}
            GROUP BY model ORDER BY cost_usd DESC
        """, params).fetchall()

        by_day = conn.execute(f"""
            SELECT session_date,
                COUNT(*)                AS requests,
                COUNT(DISTINCT user_id) AS unique_users,
                SUM(total_tokens)       AS total_tokens,
                ROUND(SUM(cost_usd),6)  AS cost_usd
            FROM usage_events {where}
            GROUP BY session_date ORDER BY session_date
        """, params).fetchall()

        top_sessions = conn.execute(f"""
            SELECT session_id, user_id, department, session_date,
                COUNT(*)                AS requests,
                SUM(total_tokens)       AS total_tokens,
                ROUND(SUM(cost_usd),6)  AS cost_usd
            FROM usage_events
            {where} AND session_id IS NOT NULL
            GROUP BY session_id ORDER BY cost_usd DESC LIMIT 10
        """, params).fetchall()

    return {
        "totals":         dict(totals),
        "by_user":        [dict(r) for r in by_user],
        "by_department":  [dict(r) for r in by_department],
        "by_model":       [dict(r) for r in by_model],
        "by_day":         [dict(r) for r in by_day],
        "top_sessions":   [dict(r) for r in top_sessions],
    }


@app.get("/health")
def health():
    return {"status": "ok"}
