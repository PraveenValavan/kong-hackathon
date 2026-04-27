# AIRA — Kong AI Gateway (Local)

Kong Enterprise **AI Gateway** in DB-less mode + Mock OIDC server.

Kong AI Gateway adds native LLM intelligence on top of API Gateway: the `ai-proxy` plugin handles provider auth and format normalisation, `ai-rate-limiting-advanced` enforces token-based budget caps, and `ai-prompt-guard` blocks PII before it reaches the upstream model.

## Prerequisites

- Docker Desktop running
- Kong Enterprise license in `.env` (already set up — do not commit `.env`)
- OpenAI and/or Anthropic API keys in `.env`

```env
KONG_LICENSE_DATA=...
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
```

## Start

```bash
cd kong/
docker compose up -d
```

Check Kong is healthy:
```bash
curl http://localhost:8001/status
```

## Get a Token

Custom JWT claims (`team_id`, `department`, `role`) are injected via the `scope` parameter. mock-oauth2-server v2.x maps each scope value to a fixed set of claims configured in `JSON_CONFIG` in `docker-compose.yml`.

> **Note:** The `?claims=...` query-param approach from older examples is **broken in v2.x** and will return a server error. Always use the `scope` approach below.

**Engineer** (`team_id: nlp-platform`, `department: R&D`):
```bash
curl -s -X POST http://localhost:8080/default/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=aira-local&client_secret=aira-secret&scope=engineering" \
  | jq -r .access_token
```

**Data Scientist** (`team_id: data-science`, `department: R&D`):
```bash
curl -s -X POST http://localhost:8080/default/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=aira-local&client_secret=aira-secret&scope=datascience" \
  | jq -r .access_token
```

**FinOps** (`team_id: finance`, `department: Finance`, `role: finops`):
```bash
curl -s -X POST http://localhost:8080/default/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=aira-local&client_secret=aira-secret&scope=finops" \
  | jq -r .access_token
```

**Admin** (`team_id: platform`, `department: Engineering`, `role: admin`):
```bash
curl -s -X POST http://localhost:8080/default/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=aira-local&client_secret=aira-secret&scope=admin" \
  | jq -r .access_token
```

Expected JWT payload (engineering example):
```json
{
  "sub": "engineer-001",
  "team_id": "nlp-platform",
  "department": "R&D",
  "role": "engineering",
  "iss": "http://localhost:8080/default"
}
```

Kong's `openid-connect` plugin forwards `team_id` and `department` as `x-team-id` and `x-department` upstream headers, which the AIRA backend uses for cost attribution.

## Call Kong AI Gateway

All AI calls go to the unified `/chat` endpoint. Kong's `ai-proxy-advanced` plugin routes traffic between `claude-haiku-4-5` (2/3 of requests) and `claude-sonnet-4-6` (1/3) via round-robin. Do not include a `model` field — the balancer selects it.

```bash
TOKEN=<paste token here>

curl -X POST http://localhost:8000/chat/v1/messages \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"max_tokens":1024,"messages":[{"role":"user","content":"Hello"}]}'
```

> **Note:** Real API keys in `.env` required. Without them Kong forwards the request but the upstream rejects with 401.

## AI Gateway Plugins Active

| Plugin | Applied to | Purpose |
|---|---|---|
| `openid-connect` | Global | Validates Bearer JWT, forwards `team_id`/`department` as upstream headers |
| `ai-proxy-advanced` | `chat-route` | Round-robin load balancing across haiku (weight 100) and sonnet (weight 50), with automatic failover |
| `ai-rate-limiting-advanced` | `chat-route` | Token-based rate limiting (500k tokens/hour), maps directly to cost |
| `ai-prompt-guard` | `chat-route` | Blocks SSN, credit card numbers, and credential patterns before they reach the LLM |
| `http-log` | Global | Emits full usage event (with token counts) to AIRA backend after each call |

## Token Usage in Responses

The `ai-proxy-advanced` plugin automatically extracts token usage and makes it available in:
- Response body: `usage.prompt_tokens`, `usage.completion_tokens`
- Kong log entry (forwarded to AIRA backend via `http-log`)

## Admin API

```bash
# List all plugins (verify AI plugins are loaded)
curl http://localhost:8001/plugins | jq '[.data[].name]'

# Check ai-proxy-advanced config on chat-route
curl http://localhost:8001/routes/chat-route/plugins

# Check Kong license
curl http://localhost:8001/license

# Check token rate limit counters
curl http://localhost:8001/routes/chat-route/plugins | jq '.data[] | select(.name=="ai-rate-limiting-advanced")'
```

## Chat Script

`scripts/aira-chat.sh` wraps the token fetch + Kong call into a single command.

**Prerequisites:** Docker stack running, `curl` and `jq` installed.

```bash
# Default: engineering role — balancer picks haiku or sonnet automatically
./scripts/aira-chat.sh "Explain rate limiting"

# finops role
./scripts/aira-chat.sh "Summarise last month's spend" --role finops

# datascience role
./scripts/aira-chat.sh "What is a transformer model?" --role datascience

# Pin a session ID to group multiple turns together
SESSION=$(uuidgen)
./scripts/aira-chat.sh "First question" --session $SESSION
./scripts/aira-chat.sh "Follow-up"      --session $SESSION
```

Available roles: `engineering` | `finops` | `admin` | `datascience`

> **Note:** The model is selected automatically by Kong's `ai-proxy-advanced` balancer — `claude-haiku-4-5` (~67%) for cost efficiency, `claude-sonnet-4-6` (~33%) for capability. The actual model used is shown in each response. Each call auto-generates a unique session UUID unless `--session` is passed.

---

## AIRA Backend — Cost & Usage Tracking

The AIRA backend (`aira-backend` service, port **8002**) receives Kong's `http-log` webhooks and stores token usage in SQLite.

### How data flows

```
Kong request  →  ai-proxy (tokens + cost)  →  http-log  →  POST /ingest/event  →  SQLite
                 pre-function (JWT decode,                       ↑
                  X-Session-ID capture)      custom_fields_by_lua adds
                                             user_id / department / session_id
```

### Interactive API docs

```
http://localhost:8002/docs
```

### Query script

`scripts/aira-usage.sh` wraps all backend endpoints into simple commands.

```bash
# Full cost dashboard (all time)
./scripts/aira-usage.sh dashboard

# Dashboard filtered by department and date range
./scripts/aira-usage.sh dashboard --dept "R&D" --since 2026-04-01

# Raw event log
./scripts/aira-usage.sh events --limit 20

# Sessions grouped by session GUID
./scripts/aira-usage.sh sessions

# Detail for one session
./scripts/aira-usage.sh session <session-uuid>

# Cost ranked by user
./scripts/aira-usage.sh cost-by-user --since 2026-04-01

# Cost detail for one user
./scripts/aira-usage.sh cost-user engineer-001

# Cost ranked by department
./scripts/aira-usage.sh cost-by-dept

# Cost detail for one department
./scripts/aira-usage.sh cost-dept "R&D" --since 2026-04-01

# Open SQLite shell directly in the container
./scripts/aira-usage.sh db
```

#### SQLite shell queries

Once inside the `sqlite>` prompt, use these queries:

```sql
-- See all tables
SELECT name FROM sqlite_master WHERE type='table';

-- Browse recent events
SELECT * FROM usage_events ORDER BY created_at DESC LIMIT 20;

-- Cost by user
SELECT user_id, SUM(total_cost) as total_cost, SUM(total_tokens) as tokens
FROM usage_events GROUP BY user_id ORDER BY total_cost DESC;

-- Cost by provider
SELECT provider, SUM(total_cost) as cost, COUNT(*) as requests
FROM usage_events GROUP BY provider;

-- Filter by date
SELECT * FROM usage_events WHERE created_at >= '2026-04-26' LIMIT 20;

-- See table schema
SELECT sql FROM sqlite_master WHERE name='usage_events';
```

Type `quit()` or press `Ctrl-D` to exit the shell.

Available filters (combine freely): `--since YYYY-MM-DD`, `--until YYYY-MM-DD`, `--user <id>`, `--dept <name>`, `--provider anthropic|openai|gemini`, `--session <uuid>`, `--limit <n>`

### Backend tests

```bash
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/pytest test_main.py -v
```

20 tests covering ingest, idempotency, cost calculation, sessions, cost-by-user, cost-by-department, dashboard, and date filters.

---

## Stop

```bash
docker compose down
```

## Architecture

```
Client (aira-chat.sh / any tool)
  │   Bearer JWT  +  X-Session-ID header
  └─► Kong AI Gateway :8000
       ├─ openid-connect          → validate JWT, forward claims upstream
       ├─ pre-function (Lua)      → decode JWT, capture X-Session-ID
       │                             → kong.ctx.shared: user_id, department, session_id
       ├─ ai-prompt-guard         → block PII (SSN, card numbers)
       ├─ ai-rate-limiting-advanced → token budget cap (500k/hr)
       ├─ ai-proxy                → inject API key, normalise to provider format
       │    └─► Upstream: OpenAI / Anthropic / Gemini
       ├─ file-log                → append NDJSON to logs/aira-access.log
       └─ http-log                → POST usage event → AIRA Backend :8002
                                        └─► SQLite: usage_events
                                              ├─ /usage/dashboard
                                              ├─ /usage/cost/by-user
                                              ├─ /usage/cost/by-department
                                              └─ /usage/sessions
```