from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from typing import Any, Optional
import sqlite3, os, datetime, json

app = FastAPI(title="AIRA Usage Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_methods=["GET", "POST", "PUT"],
    allow_headers=["*"],
)

DB_PATH = os.getenv("DB_PATH", "/data/aira-usage.db")

MODEL_COSTS: dict[str, tuple[float, float]] = {
    "claude-haiku-4-5-20251001": (0.80,  4.00),
    "claude-sonnet-4-6":         (3.00,  15.00),
    "claude-opus-4-7":           (15.00, 75.00),
    "gpt-4o":                    (2.50,  10.00),
    "gemini-2.5-flash":          (0.075, 0.30),
}

import anthropic
import calendar

TEAM_BUDGETS: dict[str, float] = {
    "nlp-platform": 1800.0,
    "data-science":  2500.0,
    "platform":      1000.0,
    "finance":        500.0,
}
DEPT_BUDGETS: dict[str, float] = {
    "R&D":         4500.0,
    "Engineering": 1000.0,
    "Finance":      500.0,
}


# ── DB ────────────────────────────────────────────────────────────────────────

def get_db(path: str = DB_PATH):
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn


_DEFAULT_TEAM_CONFIG = [
    {"team_id": "nlp-platform", "department": "R&D",         "budget_usd": 1800.0, "enforcement": "hard", "alert_threshold": 80, "rate_limit_tokens": 500000, "consumer_id": "consumer-nlp", "allowed_models": ["claude-haiku-4-5-20251001", "claude-sonnet-4-6"]},
    {"team_id": "data-science",  "department": "R&D",         "budget_usd": 2500.0, "enforcement": "soft", "alert_threshold": 80, "rate_limit_tokens": 500000, "consumer_id": "consumer-ds",  "allowed_models": ["claude-haiku-4-5-20251001", "claude-sonnet-4-6", "claude-opus-4-7"]},
    {"team_id": "platform",      "department": "Engineering", "budget_usd": 1000.0, "enforcement": "soft", "alert_threshold": 90, "rate_limit_tokens": 500000, "consumer_id": "consumer-eng", "allowed_models": ["claude-haiku-4-5-20251001"]},
    {"team_id": "finance",       "department": "Finance",     "budget_usd":  500.0, "enforcement": "soft", "alert_threshold": 80, "rate_limit_tokens": 500000, "consumer_id": "consumer-fin", "allowed_models": ["claude-haiku-4-5-20251001"]},
]

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
        cols = {r[1] for r in conn.execute("PRAGMA table_info(usage_events)")}
        _migrations = {
            "session_id":      "ALTER TABLE usage_events ADD COLUMN session_id TEXT",
            "prompt_text":     "ALTER TABLE usage_events ADD COLUMN prompt_text TEXT",
            "response_text":   "ALTER TABLE usage_events ADD COLUMN response_text TEXT",
            "quality_score":   "ALTER TABLE usage_events ADD COLUMN quality_score REAL",
            "quality_verdict": "ALTER TABLE usage_events ADD COLUMN quality_verdict TEXT",
        }
        for col, ddl in _migrations.items():
            if col not in cols:
                conn.execute(ddl)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS team_config (
                team_id          TEXT PRIMARY KEY,
                department       TEXT NOT NULL,
                budget_usd       REAL NOT NULL DEFAULT 0,
                enforcement      TEXT NOT NULL DEFAULT 'soft',
                alert_threshold  INTEGER NOT NULL DEFAULT 80,
                rate_limit_tokens INTEGER NOT NULL DEFAULT 500000,
                consumer_id      TEXT,
                allowed_models   TEXT NOT NULL DEFAULT '[]'
            )
        """)
        # Seed defaults if table is empty
        count = conn.execute("SELECT COUNT(*) FROM team_config").fetchone()[0]
        if count == 0:
            for t in _DEFAULT_TEAM_CONFIG:
                conn.execute(
                    "INSERT INTO team_config VALUES (?,?,?,?,?,?,?,?)",
                    (t["team_id"], t["department"], t["budget_usd"], t["enforcement"],
                     t["alert_threshold"], t["rate_limit_tokens"], t["consumer_id"],
                     json.dumps(t["allowed_models"]))
                )
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
    resp         = payload.get("response", {})
    status       = resp.get("status")

    # Extract raw prompt/response text for LLM-as-Judge scoring
    prompt_text = response_text = None
    try:
        req_body = req.get("body") or ""
        if isinstance(req_body, str) and req_body:
            req_json = json.loads(req_body)
            msgs = req_json.get("messages", [])
            if msgs:
                prompt_text = msgs[-1].get("content", "")
    except Exception:
        pass
    try:
        resp_body = resp.get("body") or ""
        if isinstance(resp_body, str) and resp_body:
            resp_json = json.loads(resp_body)
            choices = resp_json.get("choices", [])
            if choices:
                response_text = choices[0].get("message", {}).get("content", "")
    except Exception:
        pass

    with get_db() as conn:
        conn.execute("""
            INSERT OR IGNORE INTO usage_events
                (event_id, ts, session_date, session_id, user_id, team_id,
                 department, provider, model, prompt_tokens, completion_tokens,
                 total_tokens, cost_usd, latency_ms, status, prompt_text, response_text)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (event_id, ts, session_date, session_id, user_id, team_id,
              department, provider, model, prompt_tokens, completion_tokens,
              total_tokens, cost_usd, latency_ms, status, prompt_text, response_text))
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


@app.get("/forecast")
def get_forecast(department: Optional[str] = None):
    today = datetime.date.today()
    month_start = today.replace(day=1).isoformat()
    days_elapsed = today.day
    days_in_month = calendar.monthrange(today.year, today.month)[1]
    days_remaining = days_in_month - today.day

    base_filters = ["status = 200", "session_date >= ?"]
    base_params: list = [month_start]
    if department:
        base_filters.append("department = ?")
        base_params.append(department)
    where = "WHERE " + " AND ".join(base_filters)

    with get_db() as conn:
        totals = conn.execute(
            f"SELECT ROUND(SUM(cost_usd), 4) AS total FROM usage_events {where}",
            base_params,
        ).fetchone()
        by_team = conn.execute(
            f"""SELECT team_id, ROUND(SUM(cost_usd), 4) AS cost
                FROM usage_events {where}
                GROUP BY team_id ORDER BY cost DESC""",
            base_params,
        ).fetchall()
        by_model = conn.execute(
            f"""SELECT model, ROUND(SUM(cost_usd), 4) AS cost
                FROM usage_events {where}
                GROUP BY model ORDER BY cost DESC LIMIT 5""",
            base_params,
        ).fetchall()

    total_spend = totals["total"] or 0.0
    daily_rate = total_spend / days_elapsed if days_elapsed > 0 else 0.0
    projected_eom = round(total_spend + daily_rate * days_remaining, 2)

    if department:
        budget = DEPT_BUDGETS.get(department, 0.0)
    else:
        budget = sum(DEPT_BUDGETS.values())

    team_lines = []
    for r in by_team:
        t = r["team_id"] or "unknown"
        spend = r["cost"] or 0.0
        b = TEAM_BUDGETS.get(t, 0.0)
        pct = round(spend / b * 100) if b > 0 else 0
        team_lines.append(f"  {t}: ${spend:.4f} of ${b:.0f} budget ({pct}%)")

    model_lines = [f"  {r['model']}: ${r['cost']:.4f}" for r in by_model]
    scope = f"department: {department}" if department else "the entire organisation"

    prompt = (
        f"You are a FinOps analyst reviewing AI API costs for {scope}.\n\n"
        f"Data for {today.strftime('%B %Y')} ({days_elapsed} days elapsed, {days_remaining} days remaining):\n"
        f"- Total spend to date: ${total_spend:.4f}\n"
        f"- Monthly budget: ${budget:.0f}\n"
        f"- Daily burn rate: ${daily_rate:.2f}/day (total_spend / days_elapsed)\n"
        f"- Projected end-of-month spend: ${projected_eom:.2f}\n\n"
        f"Spend by team:\n" + ("\n".join(team_lines) if team_lines else "  No team data") + "\n\n"
        f"Top models by cost:\n" + ("\n".join(model_lines) if model_lines else "  No model data") + "\n\n"
        "In 2-3 concise sentences: forecast end-of-month spend vs budget, identify the biggest cost risk, "
        "and give one actionable model-switching or usage recommendation with specific dollar estimates.\n\n"
        "Respond ONLY with valid JSON (no markdown, no code fences):\n"
        '{"narrative": "...", "projected_eom": <float>, "potential_saving": <float or 0>, "risk_teams": ["team1", ...]}'
    )

    import json as _json
    message = anthropic.Anthropic().messages.create(
        model="claude-sonnet-4-6",
        max_tokens=512,
        messages=[{"role": "user", "content": prompt}],
    )
    result = _json.loads(message.content[0].text.strip())
    result["department"] = department
    result["generated_at"] = datetime.datetime.utcnow().isoformat() + "Z"
    return result


# ── LLM-as-Judge ─────────────────────────────────────────────────────────────

def _call_llm_judge(prompt_text: str, response_text: str, model_used: str, cost_usd: float) -> dict:
    """Ask Haiku to grade a prompt/response pair. Returns structured verdict."""
    judge_prompt = (
        f"You are an AI quality auditor evaluating a production LLM response.\n\n"
        f"Model used: {model_used}\n"
        f"Cost: ${cost_usd:.6f}\n\n"
        f"USER PROMPT:\n{prompt_text[:2000]}\n\n"
        f"MODEL RESPONSE:\n{response_text[:3000]}\n\n"
        "Score each dimension 0-10 (10 = perfect):\n"
        "- relevance: did the response actually answer the question?\n"
        "- safety: no harmful, toxic, or policy-violating content?\n"
        "- conciseness: appropriately sized — not padded, not truncated?\n"
        "- cost_efficiency: was the model choice appropriate for this task complexity?\n\n"
        "verdict: 'pass' (avg>=7), 'flag' (avg 4-6), or 'fail' (avg<4)\n\n"
        "Respond ONLY with valid JSON, no markdown:\n"
        '{"relevance":<int>,"safety":<int>,"conciseness":<int>,"cost_efficiency":<int>,'
        '"score":<float avg>,"verdict":"pass|flag|fail","reason":"one sentence"}'
    )
    msg = anthropic.Anthropic().messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=256,
        messages=[{"role": "user", "content": judge_prompt}],
    )
    return json.loads(msg.content[0].text.strip())


@app.post("/judge/evaluate/{event_id}")
def judge_event(event_id: str):
    """Grade a single logged event with LLM-as-Judge. Stores result in DB."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM usage_events WHERE event_id = ?", (event_id,)
        ).fetchone()
    if not row:
        raise HTTPException(404, "event not found")

    event = dict(row)
    if not event.get("prompt_text") or not event.get("response_text"):
        raise HTTPException(422, "event has no prompt/response text — Kong body logging may be disabled")

    verdict = _call_llm_judge(
        event["prompt_text"], event["response_text"],
        event.get("model", "unknown"), event.get("cost_usd", 0)
    )

    with get_db() as conn:
        conn.execute(
            "UPDATE usage_events SET quality_score=?, quality_verdict=? WHERE event_id=?",
            (verdict["score"], json.dumps(verdict), event_id)
        )
        conn.commit()

    return {"event_id": event_id, **verdict}


@app.post("/judge/batch")
def judge_batch(limit: int = 10):
    """Grade the most recent un-judged events that have prompt/response text."""
    with get_db() as conn:
        rows = conn.execute(
            """SELECT event_id, prompt_text, response_text, model, cost_usd
               FROM usage_events
               WHERE quality_score IS NULL
                 AND prompt_text IS NOT NULL
                 AND response_text IS NOT NULL
               ORDER BY ts DESC LIMIT ?""",
            (limit,)
        ).fetchall()

    results = []
    for row in rows:
        event = dict(row)
        try:
            verdict = _call_llm_judge(
                event["prompt_text"], event["response_text"],
                event.get("model", "unknown"), event.get("cost_usd", 0)
            )
            with get_db() as conn:
                conn.execute(
                    "UPDATE usage_events SET quality_score=?, quality_verdict=? WHERE event_id=?",
                    (verdict["score"], json.dumps(verdict), event["event_id"])
                )
                conn.commit()
            results.append({"event_id": event["event_id"], "status": "judged", **verdict})
        except Exception as e:
            results.append({"event_id": event["event_id"], "status": "error", "reason": str(e)})

    return {"judged": len([r for r in results if r["status"] == "judged"]), "results": results}


@app.get("/judge/summary")
def judge_summary(department: Optional[str] = None, since: Optional[str] = None):
    """Aggregate quality scores across judged events."""
    filters, params = ["quality_score IS NOT NULL"], []
    if department:
        filters.append("department = ?"); params.append(department)
    if since:
        filters.append("session_date >= ?"); params.append(since)
    where = "WHERE " + " AND ".join(filters)

    with get_db() as conn:
        totals = conn.execute(f"""
            SELECT
                COUNT(*)                        AS judged_events,
                ROUND(AVG(quality_score), 2)    AS avg_score,
                SUM(CASE WHEN quality_verdict LIKE '%"verdict": "pass"%' THEN 1 ELSE 0 END) AS pass_count,
                SUM(CASE WHEN quality_verdict LIKE '%"verdict": "flag"%' THEN 1 ELSE 0 END) AS flag_count,
                SUM(CASE WHEN quality_verdict LIKE '%"verdict": "fail"%' THEN 1 ELSE 0 END) AS fail_count
            FROM usage_events {where}
        """, params).fetchone()

        by_model = conn.execute(f"""
            SELECT model,
                COUNT(*)                     AS judged_events,
                ROUND(AVG(quality_score), 2) AS avg_score
            FROM usage_events {where}
            GROUP BY model ORDER BY avg_score DESC
        """, params).fetchall()

        low_quality = conn.execute(f"""
            SELECT event_id, ts, user_id, model, quality_score, quality_verdict
            FROM usage_events {where} AND quality_score < 6
            ORDER BY quality_score ASC LIMIT 10
        """, params).fetchall()

    lq_list = []
    for r in low_quality:
        d = dict(r)
        try:
            d["quality_verdict"] = json.loads(d["quality_verdict"] or "{}")
        except Exception:
            pass
        lq_list.append(d)

    return {
        "totals":      dict(totals),
        "by_model":    [dict(r) for r in by_model],
        "low_quality": lq_list,
    }


# ── Kong Sync ─────────────────────────────────────────────────────────────────

_LUA_PRE_FUNCTION = (
    'local auth = kong.request.get_header("authorization") or ""\n'
    'local token = auth:match("^[Bb]earer%s+(.+)$")\n'
    'if token then\n'
    '  local parts = {}\n'
    '  for p in token:gmatch("[^%.]+") do parts[#parts+1] = p end\n'
    '  if parts[2] then\n'
    '    local b64 = parts[2]:gsub("-", "+"):gsub("_", "/")\n'
    '    local pad = (4 - #b64 % 4) % 4\n'
    '    b64 = b64 .. string.rep("=", pad)\n'
    '    local payload = ngx.decode_base64(b64)\n'
    '    if payload then\n'
    '      kong.ctx.shared.aira_user_id    = payload:match(\'"sub"%s*:%s*"([^"]+)"\')\n'
    '      kong.ctx.shared.aira_team_id    = payload:match(\'"team_id"%s*:%s*"([^"]+)"\')\n'
    '      kong.ctx.shared.aira_department = payload:match(\'"department"%s*:%s*"([^"]+)"\')\n'
    '    end\n'
    '  end\n'
    'end\n'
    'kong.ctx.shared.session_id = kong.request.get_header("x-session-id")\n'
)

_LUA_RETURN = {
    "user_id":    "return kong.ctx.shared.aira_user_id",
    "team_id":    "return kong.ctx.shared.aira_team_id",
    "department": "return kong.ctx.shared.aira_department",
    "session_id": "return kong.ctx.shared.session_id",
}


def _build_kong_config(teams: list) -> dict:
    # Consumers must be defined for consumer-scoped plugins to reference them
    consumers = [
        {"username": t["consumer_id"], "tags": ["aira"]}
        for t in teams if t.get("consumer_id")
    ]

    base_plugins = [
        {
            "name": "openid-connect",
            "config": {
                "issuer": "http://mock-oauth2:8080/default/.well-known/openid-configuration",
                "client_id": ["aira-local"],
                "client_secret": ["aira-secret"],
                "auth_methods": ["bearer"],
                "bearer_token_param_type": ["header"],
                "verify_signature": True,
                "issuers_allowed": ["http://localhost:8080/default", "http://mock-oauth2:8080/default"],
                "upstream_headers_claims": ["sub:x-user-id", "team_id:x-team-id", "department:x-department"],
            },
        },
        {
            "name": "ai-proxy-advanced",
            "route": "chat-route",
            "config": {
                "balancer": {"algorithm": "round-robin"},
                "targets": [
                    {
                        "route_type": "llm/v1/chat", "weight": 100,
                        "auth": {"header_name": "x-api-key", "header_value": "{vault://env/ANTHROPIC_API_KEY}"},
                        "model": {"provider": "anthropic", "name": "claude-haiku-4-5-20251001",
                                  "options": {"max_tokens": 4096, "temperature": 0.7, "anthropic_version": "2023-06-01",
                                              "input_cost": 0.80, "output_cost": 4.00}},
                        "logging": {"log_statistics": True, "log_payloads": False},
                    },
                    {
                        "route_type": "llm/v1/chat", "weight": 50,
                        "auth": {"header_name": "x-api-key", "header_value": "{vault://env/ANTHROPIC_API_KEY}"},
                        "model": {"provider": "anthropic", "name": "claude-sonnet-4-6",
                                  "options": {"max_tokens": 4096, "temperature": 0.7, "anthropic_version": "2023-06-01",
                                              "input_cost": 3.00, "output_cost": 15.00}},
                        "logging": {"log_statistics": True, "log_payloads": False},
                    },
                ],
            },
        },
        # Global route-level rate limit (fallback for any consumer without a specific override)
        {
            "name": "ai-rate-limiting-advanced",
            "route": "chat-route",
            "config": {
                "llm_providers": [{"name": "anthropic", "limit": 500000, "window_size": 3600}]
            },
        },
        {
            "name": "ai-prompt-guard",
            "route": "chat-route",
            "config": {
                "deny_patterns": [
                    "\\b\\d{3}-\\d{2}-\\d{4}\\b",
                    "\\b\\d{16}\\b",
                    "(?i)(password|secret|api[_-]?key)\\s*[:=]\\s*\\S+",
                ],
                "allow_all_conversation_history": True,
            },
        },
        {"name": "pre-function", "config": {"access": [_LUA_PRE_FUNCTION]}},
        {
            "name": "file-log",
            "config": {"path": "/logs/aira-access.log", "reopen": False, "custom_fields_by_lua": _LUA_RETURN},
        },
        {
            "name": "http-log",
            "config": {
                "http_endpoint": "http://aira-backend:8002/ingest/event",
                "method": "POST", "timeout": 5000, "keepalive": 60000,
                "flush_timeout": 2,
                # retry_count deprecated in Kong 4.x — use queue config instead
                "queue": {"max_retry_time": 60},
                "custom_fields_by_lua": _LUA_RETURN,
            },
        },
    ]

    # Per-consumer rate-limit overrides — these take priority over the route-level plugin
    consumer_plugins = [
        {
            "name": "ai-rate-limiting-advanced",
            "consumer": t["consumer_id"],
            "route": "chat-route",
            "config": {
                "llm_providers": [{"name": "anthropic", "limit": t["rate_limit_tokens"], "window_size": 3600}]
            },
        }
        for t in teams if t.get("consumer_id")
    ]

    config: dict = {
        "_format_version": "3.0",
        "_transform": True,
        "services": [{"name": "ai-service", "url": "https://api.anthropic.com", "tags": ["aira"]}],
        "routes": [{"name": "chat-route", "service": "ai-service", "paths": ["/chat"],
                    "strip_path": True, "tags": ["aira"]}],
        "plugins": base_plugins + consumer_plugins,
    }
    if consumers:
        config["consumers"] = consumers
    return config


@app.post("/sync/kong")
async def sync_kong():
    import httpx as _httpx

    with get_db() as conn:
        rows = conn.execute("SELECT * FROM team_config ORDER BY team_id").fetchall()
    teams = [dict(r) for r in rows]
    for t in teams:
        t["allowed_models"] = json.loads(t["allowed_models"])

    config = _build_kong_config(teams)
    kong_admin = os.getenv("KONG_ADMIN_URL", "http://kong:8001")

    try:
        async with _httpx.AsyncClient() as client:
            # Send as JSON — avoids YAML serialisation issues with Lua strings and vault refs
            resp = await client.post(
                f"{kong_admin}/config",
                json=config,
                timeout=15.0,
            )
        if resp.status_code not in (200, 201):
            raise HTTPException(502, f"Kong returned {resp.status_code}: {resp.text[:500]}")
    except _httpx.ConnectError:
        raise HTTPException(503, "Kong Admin API unreachable — is Kong running?")

    return {
        "status": "synced",
        "teams_synced": len(teams),
        "consumer_plugins": len([t for t in teams if t.get("consumer_id")]),
        "ts": datetime.datetime.utcnow().isoformat() + "Z",
    }


# ── Config ────────────────────────────────────────────────────────────────────

@app.get("/config/teams")
def get_team_configs():
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM team_config ORDER BY team_id").fetchall()
    result = []
    for r in rows:
        d = dict(r)
        d["allowed_models"] = json.loads(d["allowed_models"])
        result.append(d)
    return result


@app.put("/config/teams/{team_id}")
async def update_team_config(team_id: str, payload: dict[str, Any]):
    allowed_fields = {"budget_usd", "enforcement", "alert_threshold", "rate_limit_tokens", "allowed_models"}
    updates = {k: v for k, v in payload.items() if k in allowed_fields}
    if not updates:
        raise HTTPException(400, "No valid fields to update")

    if "allowed_models" in updates:
        updates["allowed_models"] = json.dumps(updates["allowed_models"])
    if "enforcement" in updates and updates["enforcement"] not in ("hard", "soft"):
        raise HTTPException(400, "enforcement must be 'hard' or 'soft'")

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    params = list(updates.values()) + [team_id]

    with get_db() as conn:
        result = conn.execute(
            f"UPDATE team_config SET {set_clause} WHERE team_id = ?", params
        )
        if result.rowcount == 0:
            raise HTTPException(404, f"team {team_id!r} not found")
        conn.commit()

    # Reflect budget changes back into the in-memory dicts used by forecast
    if "budget_usd" in updates:
        TEAM_BUDGETS[team_id] = float(payload["budget_usd"])

    with get_db() as conn:
        row = conn.execute("SELECT * FROM team_config WHERE team_id = ?", (team_id,)).fetchone()
    d = dict(row)
    d["allowed_models"] = json.loads(d["allowed_models"])
    return d


@app.get("/config/models")
def get_models():
    return [
        {"model_id": mid, "provider": "anthropic" if "claude" in mid else ("openai" if "gpt" in mid else "google"),
         "input_cost_per_1m": costs[0], "output_cost_per_1m": costs[1]}
        for mid, costs in MODEL_COSTS.items()
    ]


@app.get("/health")
def health():
    return {"status": "ok"}
