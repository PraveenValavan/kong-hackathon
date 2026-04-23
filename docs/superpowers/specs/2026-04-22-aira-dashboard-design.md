# AIRA Dashboard — Design Spec
**Date:** 2026-04-22  
**Hackathon:** Ericsson — Centralized AI Cost Tracking (PoC)  
**Stack:** Next.js 14 + Tailwind CSS + Recharts + Claude API

> **Two surfaces:** (1) **AIRA Dashboard** — admin/FinOps/Engineering governance views (2) **AIRA Client** — end-user chat interface for consuming LLMs, routed through Kong

---

## Context

AIRA (AI Resource & Analytics Platform) solves fragmented AI spend visibility at Ericsson. Kong Gateway sits in front of all AI API calls and emits usage events (tokens, model, team, user) to the AIRA backend. This spec covers the **frontend dashboard** that makes that data actionable.

The core problem: finance can't allocate costs, engineering can't spot waste, and leadership can't assess budget risk — because AI spend is scattered across team siloes with no central view.

---

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Role model | Login-time role assignment | Realistic production model; role from JWT claims |
| Navigation | Unified sidebar, role-filtered content | Single app, greyed-out items for out-of-scope sections |
| Hero features | Chargeback report + Claude AI Forecast | Directly answers "who pays?" and "what happens next?" |
| AI Forecast | Claude Sonnet, natural language + numbers | Specific model-switch recommendations, not just trend lines |

---

## Roles & Access Matrix

| Page | FinOps | Engineering | Executive (Admin) |
|---|---|---|---|
| Overview | ✓ | ✓ | ✓ |
| Cost & Usage | ✓ | ✓ | ✓ |
| Chargeback | ✓ | — | ✓ |
| AI Forecast | ✓ | ✓ | ✓ |
| Token Logs | — | ✓ | ✓ |
| Anomalies | — | ✓ | ✓ |
| Governance / RBAC | — | — | ✓ |
| Teams & Budgets | — | — | ✓ |

Locked pages are visible in the sidebar but show an access prompt rather than hidden entirely.

---

## Pages

### 1. Login / Role Selection
- Email + password form
- On successful auth, role is read from JWT claims (`role: finops | engineering | admin`)
- Redirect to `/overview` with role context set in app state

### 2. Overview (all roles)
- **KPI row:** Total spend (MTD), Budget remaining, Top spending team, EOM forecast
- **Spend by team:** Horizontal bar chart (Recharts), coloured by budget utilisation
- **Claude Forecast panel (dark):** 2-3 sentence natural language summary of trajectory + top recommendation
- **Budget alert badge** in top-right when any team is >80% or over budget

### 3. Cost & Usage (FinOps + Engineering)
- Daily spend line chart (30-day rolling, by provider)
- Provider breakdown donut chart (OpenAI vs Anthropic vs Gemini vs Azure)
- Model usage table: model name, total tokens, total cost, avg cost/call
- FinOps sees cost; Engineering additionally sees raw token counts and p95 latency

### 4. Chargeback Report (FinOps + Admin) — Hero Page
- Date range picker + department filter
- Table columns: Department · Team · Tokens · Cost · Budget · Utilisation bar · Status badge
- Status badges: ✓ On track · ⚠ Near limit · ✕ Over budget
- Export to CSV button
- **Claude Forecast panel** below the table (same as Overview but expanded):
  - Month-end projection vs budget
  - Primary cost driver identification
  - Specific model-switch recommendation with projected savings
  - Next-month forecast: two scenarios (no change vs. recommended action)
  - Powered-by footer with model name + data freshness timestamp

### 5. AI Forecast (all roles — language tuned per role)
- Full-page forecast view with 90-day trend chart (actuals + projection)
- Projection confidence band (Recharts area chart)
- **FinOps framing:** spend and savings in dollars
- **Engineering framing:** token efficiency and model performance tradeoffs  
- **Executive framing:** budget risk percentage and vendor negotiation leverage
- Scenario modeller: toggle "Apply recommendation" to see chart update
- Claude analysis refreshes on demand or auto every 15 min

### 6. Token Logs (Engineering + Admin)
- Paginated table: timestamp, user, team, provider, model, prompt tokens, completion tokens, cost, latency
- Filter by team / provider / model / date range
- Click row → expanded call detail (request ID, response preview truncated, full metadata)

### 7. Anomalies (Engineering + Admin)
- Alert feed: team, detected pattern, severity, timestamp
- Anomaly types: spend spike (>3σ), unusual model switch, off-hours usage, single-user cost outlier
- Each alert links to the relevant Token Logs slice

### 8. Governance / RBAC (Admin only)
- Team management: add/edit teams, assign users, set budget limits
- Model allowlist: toggle which models are permitted per team
- Centralised API key vault status (keys managed in Kong, status shown here)
- Audit log: last 100 governance actions with actor + timestamp

---

## Claude AI Forecast — Integration Design

**Trigger:** Called server-side on page load for Chargeback and Forecast pages. Cached for 15 min.

**Prompt inputs:**
- Last 90 days of daily spend per team
- Current month budget per team
- Model usage breakdown (model → token share)
- Current date and days remaining in month

**Output contract (structured JSON via tool use):**
```json
{
  "eom_projection": 26100,
  "budget": 25000,
  "overage": 1100,
  "primary_driver": { "team": "NLP Platform", "overage_share": 0.61 },
  "recommendation": {
    "action": "Switch NLP Platform batch summarisation from GPT-4o to Claude Haiku",
    "monthly_saving": 3100,
    "projected_eom_with_action": 23000
  },
  "next_month_forecast": {
    "no_change": 24800,
    "with_recommendation": 21200
  },
  "narrative": "At current burn rate, total spend will reach $26,100 by April 30..."
}
```

**Role-tuned narrative:** Backend appends a role hint to the prompt so Claude frames the narrative in dollars (FinOps), token efficiency (Engineering), or budget risk percentage (Executive).

---

## Product Architecture

### Layer 1 — Users & Personas

| Persona | Primary Surface | Key Need |
|---|---|---|
| FinOps Manager | AIRA Dashboard | Chargeback reports, budget alerts, cost allocation |
| Engineer / Developer | AIRA Client | Chat UI to use LLMs for daily work |
| Data Scientist | AIRA Client + API | Batch jobs and experiments |
| Executive / Admin | AIRA Dashboard | Budget risk, compliance status, vendor insights |
| Platform Team | Admin Panel | RBAC, model allowlists, API key vault |

### Layer 2 — Client Surfaces (Next.js 14)

Two surfaces, one app. Role determined from JWT claims at login.

**AIRA Client** (`/client`) — available to all employees
- Chat UI with streaming LLM responses
- Model selector showing only allowlisted models for the user's team
- Per-response cost badge (tokens + estimated $)
- Usage meter: "Your spend this month: $42 / $200 limit"
- Hard-cap warning when team budget exhausted (Kong returns 429)
- Conversation history (30 days)

**AIRA Dashboard** (`/`) — FinOps, Engineering, Admin
- Overview, Cost & Usage, Chargeback, AI Forecast, Token Logs, Anomalies, Governance
- Role-filtered sidebar (locked sections visible but gated)

### Layer 3 — Kong Gateway (AI Control Plane)

Every AI request — from the Client or any other tool — passes through Kong. No exceptions.

| Plugin | Function |
|---|---|
| `openid-connect` | Auth & user identity — validates JWT, forwards `team_id`/`department` as upstream headers |
| `ai-proxy` | Provider auth injection, OpenAI-compatible format normalisation, automatic token extraction |
| `ai-rate-limiting-advanced` | Token-based budget caps (not request count) — directly maps to cost |
| `ai-prompt-guard` | Blocks SSN, credit card, credential patterns before reaching LLM |
| `http-log` | Emits full usage event (with token counts from ai-proxy) to AIRA backend |

Kong AI Gateway's `ai-proxy` plugin automatically extracts `prompt_tokens` and `completion_tokens` from every response and makes them available in the `http-log` payload — no custom token parsing needed. Kong tags every event: `user_id · team_id · department · provider · model · prompt_tokens · completion_tokens · latency · timestamp` → forwarded to AIRA Backend.

### Layer 4 — AIRA Backend (FastAPI)

| Service | Responsibility |
|---|---|
| Usage Ingestion | Receives Kong events, normalises schema, writes to TimescaleDB |
| Cost Engine | Applies per-model pricing table, computes $ per call + cumulative |
| Chargeback Engine | Aggregates spend by team/dept/month, generates allocation reports |
| Anomaly Detector | Rolling z-score on team spend; fires alert on >3σ spike or policy breach |
| Forecast Service | Fetches 90-day history → calls Claude API → returns structured JSON + narrative |
| Key Vault Proxy | Manages upstream API keys; Kong references vault — keys never exposed to users |

### Layer 5 — AI & Intelligence

**Claude Sonnet (Forecast Service)**
- Input: 90-day spend + budget + model breakdown + role hint
- Output: structured JSON via tool use (EOM projection, root cause, model-switch recommendation, next-month scenarios)
- Narrative tuned per role: dollar savings (FinOps), token efficiency (Engineering), budget risk % (Executive)
- Cached 15 min in Redis

**Upstream LLM Providers** (proxied via Kong — users never hold keys)
- OpenAI · Anthropic · Gemini · Azure OpenAI

**Notification Engine**
- Budget threshold breaches → Slack webhook + SendGrid email
- Triggered by Anomaly Detector or Cost Engine budget events

### Layer 6 — Data Layer

| Store | Purpose |
|---|---|
| TimescaleDB | Time-series usage events, hypertable partitioned by day |
| PostgreSQL | Teams, users, budgets, model allowlists, role assignments |
| Redis | Rate limit counters, Claude forecast cache (15 min TTL), real-time budget remaining |
| Object Storage | Chargeback CSV exports, monthly report archives, audit log snapshots |

### Full Data Flow

```
Employee (AIRA Client or API tool)
  └─ POST /openai/v1/chat/completions (Bearer JWT)
       └─ Kong Gateway
            ├─ OIDC plugin → validates JWT, extracts user_id + team_id
            ├─ Rate Limit → checks Redis budget counter, 429 if exhausted
            ├─ PII Filter → inspects payload, blocks if sensitive
            ├─ AI Router → validates model against team allowlist
            ├─ Cost Tracker → records tokens + cost after response
            ├─ Audit Logger → writes immutable event
            └─ Upstream: OpenAI / Anthropic / Gemini
                 └─ Response streamed back to client
                      └─ Usage event emitted → AIRA Backend
                           ├─ Usage Ingestion → TimescaleDB
                           ├─ Cost Engine → cumulative spend updated
                           ├─ Anomaly Detector → z-score check
                           └─ /api/forecast (on demand) → Claude API
                                └─ AIRA Dashboard
                                     ├─ /overview
                                     ├─ /chargeback  ← hero page
                                     ├─ /forecast
                                     └─ /logs, /anomalies, /governance
```

### Deployment

- **PoC:** Docker Compose (all services in one `docker-compose.yml`)
- **Production-ready:** Each service containerised independently, Kubernetes-ready
- **Kong config:** DB-less mode, declarative `kong.yml`, git-versioned
- **Secrets:** `.env` only, never committed

---

## Key UI Components

| Component | Library | Notes |
|---|---|---|
| Spend bar chart | Recharts `BarChart` | Horizontal, coloured by utilisation |
| 90-day trend + projection | Recharts `AreaChart` | Dashed line for projection, confidence band |
| Provider donut | Recharts `PieChart` | |
| Chargeback table | Custom (Tailwind) | Sortable, filterable, CSV export |
| KPI cards | Custom (Tailwind) | 4-column grid, responsive |
| Claude forecast panel | Custom (Tailwind dark) | Dark background to visually separate AI insight |
| Budget utilisation bar | Inline CSS / Tailwind | Colour thresholds: green <70%, amber 70-95%, red >95% |

---

## Visual Design Tokens

- **Background:** `#f8fafc` (page), `white` (cards)
- **Sidebar:** `#0f172a`
- **Claude panel:** `#0f172a` (same dark, intentional — AI = dark mode)
- **Primary accent:** `#0ea5e9` (sky-500)
- **Warning:** `#f59e0b` (amber-500)
- **Danger:** `#ef4444` (red-500)
- **Success:** `#34d399` (emerald-400)
- **Font:** System sans (Next.js default)

---

---

## AIRA Client — End-User LLM Interface

A chat UI where Ericsson employees use LLMs for their daily work. Every call routes through Kong, so usage is automatically tracked, governed, and attributed to the user's team — with zero extra setup from the user.

### Purpose
- Gives employees a sanctioned, governed way to use AI (vs. going directly to OpenAI/Anthropic with personal or shared keys)
- Every message is automatically tagged with `user_id`, `team_id`, `department` by Kong — feeding the chargeback and forecast engine
- Enforces model allowlists per team (Engineering can use GPT-4o; others may be limited to cheaper models)

### Key Features

**Model selector**
- Dropdown showing only models the user's team is permitted to use (from Kong allowlist)
- Shows estimated cost-per-1K tokens next to each model so users can make informed choices
- Default model pre-selected based on team policy

**Chat interface**
- Standard chat UI: user message → streaming response
- Each conversation tagged with a purpose/project label (optional, for finer-grained chargeback)
- Token count + estimated cost shown per response in a small footer badge

**Usage meter**
- Sidebar widget: "Your spend this month: $42 / $200 limit"
- Visual progress bar — amber at 80%, red at 100%
- If team budget is exhausted, hard-cap message shown and requests are blocked by Kong (429)

**Conversation history**
- Last 30 conversations stored per user
- Search by keyword

### Access
- Available to all authenticated users regardless of role
- Accessible at `/client` — separate from the governance dashboard
- Same login, same JWT — role determines which sidebar sections are visible in the governance dashboard; the Client is always accessible

### Data Flow
```
AIRA Client (browser)
  └─ POST /openai/v1/chat/completions  (or /anthropic/v1/messages)
       └─ Kong Gateway
            ├─ OIDC plugin validates JWT, extracts user_id + team_id
            ├─ Cost Tracking plugin records token usage
            ├─ Rate Limit plugin enforces team budget cap
            └─ Upstream: OpenAI / Anthropic / Gemini
```

### UI Layout
- Left sidebar: conversation history list + usage meter
- Main area: chat thread with streaming responses
- Top bar: model selector + current conversation label
- Response footer: token count · estimated cost · model used · latency

---

## Verification

1. Run `npm run dev` → log in as each of the 3 roles → confirm sidebar items lock correctly
2. Chargeback page: confirm CSV export downloads correct data
3. Forecast panel: mock 90 days of usage data → confirm Claude returns structured JSON and renders narrative
4. Scenario toggle on Forecast page: switching recommendation on/off updates the chart
5. Token Logs: filter by team → confirm only that team's calls shown
6. Anomaly feed: seed a spike event → confirm it appears with correct severity
