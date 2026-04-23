# AIRA — AI Resource & Analytics Platform

> *"The AI that watches your AI"*
>
> Hackathon: Ericsson — Centralized AI Cost Tracking (PoC)

---

## Problem Statement

Organizations use multiple AI and LLM services, but fragmented usage makes it hard to track costs, detect anomalies, and optimize spending. AI expenses are spread across teams and providers, limiting visibility and control over budgets and vendor contracts.

---

## Solution

AIRA is a centralized platform that uses **Kong API Gateway as the AI control plane** — all AI API calls flow through Kong, giving real-time visibility, enforcement, and intelligence with zero developer friction (no SDK changes required, just redirect your base URL).

---

## Product Name & Tagline

**AIRA** — AI Resource & Analytics Platform
*"The AI that watches your AI"*

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    TEAMS / DEVELOPERS                        │
│         (configure API keys to point through Kong)          │
└──────────────────┬──────────────────────────────────────────┘
                   │  All AI API calls
                   ▼
┌─────────────────────────────────────────────────────────────┐
│                  KONG GATEWAY (Control Plane)               │
│  ┌─────────────┐ ┌──────────────┐ ┌──────────────────────┐ │
│  │Cost Tracking│ │GDPR/Content  │ │ Rate Limiting /      │ │
│  │Plugin       │ │Filter Plugin │ │ Budget Enforcer      │ │
│  └─────────────┘ └──────────────┘ └──────────────────────┘ │
└──────────────────┬──────────────────────────────────────────┘
                   │  tagged events (team, user, model, tokens)
                   ▼
┌─────────────────────────────────────────────────────────────┐
│              AIRA BACKEND  (.NET / FastAPI)                 │
│  ┌──────────────┐ ┌───────────┐ ┌────────────────────────┐ │
│  │Usage Ingestion│ │Anomaly   │ │ Prediction Engine      │ │
│  │& Cost Engine │ │Detector  │ │ (cost forecasting)     │ │
│  └──────────────┘ └───────────┘ └────────────────────────┘ │
│  ┌──────────────┐ ┌───────────┐ ┌────────────────────────┐ │
│  │Audit Trail   │ │Chargeback │ │ AI Advisor Agent       │ │
│  │Service       │ │Engine     │ │ (model suggestions)    │ │
│  └──────────────┘ └───────────┘ └────────────────────────┘ │
└──────────────────┬──────────────────────────────────────────┘
                   │
         ┌─────────┴──────────┐
         ▼                    ▼
┌─────────────────┐  ┌────────────────────┐
│  TimescaleDB /  │  │   Claude API       │
│  PostgreSQL     │  │  (AI Advisor)      │
└─────────────────┘  └────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│              AIRA DASHBOARD  (Next.js)                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────┐ │
│  │FinOps    │ │ Engineer │ │  C-Suite │ │User Self-     │ │
│  │View      │ │ View     │ │  View    │ │Service Portal │ │
│  └──────────┘ └──────────┘ └──────────┘ └───────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

## Core Features

### 1. Token Usage & Cost Tracking (Per User & Department)

**Where:** Kong Cost Tracking Plugin → Usage Ingestion & Cost Engine

- Kong intercepts every AI API request and response
- Extracts token counts from response headers/bodies (all major providers expose this)
- Tags events with: `user_id`, `team_id`, `department`, `provider`, `model`, `timestamp`
- Cost engine applies per-model pricing to compute real-time spend
- Supports chargeback reporting: exports cost allocations per team/department for finance

**Supported Providers:**
- OpenAI (GPT-4o, GPT-4, GPT-3.5)
- Anthropic (Claude Opus, Sonnet, Haiku)
- Google (Gemini Pro, Gemini Flash)
- Azure OpenAI
- AWS Bedrock / SageMaker
- GitHub Copilot (via polling — proxy not possible)
- Cursor / Claude Code (via polling)

---

### 2. GDPR + Content Blocking

**Where:** Kong GDPR/Content Filter Plugin (pre-route — before data leaves the org)

**Two layers of filtering:**

**Layer 1 — PII / GDPR Detection (outbound request scan):**
- Scans prompt text for PII patterns: names, emails, phone numbers, EU national IDs, credit card numbers
- Uses a fast local regex + NLP model (no external call) to classify sensitive content
- On detection: blocks the request, returns `403` with explanation, logs to audit trail
- Configurable per team: strict (block all PII) or warn-only mode

**Layer 2 — Non-Work Content Filter:**
- Category classifier detects off-topic usage: entertainment, personal tasks, social content
- Configurable policy: block, warn user, or flag for manager review
- Does NOT read/store content — only classifies and discards

**Why this wins:** Most cost tools track after the fact. AIRA blocks sensitive data *before* it reaches the AI provider — a compliance story enterprises immediately understand.

---

### 3. Predict Usage & Costs

**Where:** Prediction Engine (time-series forecasting)

- Time-series data stored in TimescaleDB (optimized for high-frequency events)
- Forecasting models: Prophet (for trend + seasonality) + linear regression for short-term
- Generates 30 / 60 / 90-day cost forecasts per team and per provider
- Budget alerts: notifies when projected spend is on track to exceed budget
- Anomaly detection layer:
  - Rule-based: immediate spike alerts (e.g., 3× normal usage in 1 hour)
  - Statistical: Z-score / IQR outlier detection on rolling baselines
  - LLM-powered: Claude analyzes anomalies and writes a human-readable explanation

**Example alert:**
> *"Team Beta's usage spiked 400% on Tuesday at 2pm. Root cause: a misconfigured retry loop in their document processing pipeline. Estimated overrun: $340."*

---

### 4. User Cost Notifications + Model Recommendations (AI Advisor)

**Where:** AI Advisor Agent (Claude-powered)

This is the flagship feature — a Claude-powered agent that acts as a personal FinOps advisor for each user and team.

**User-facing self-service portal shows:**
- Your spend this month vs. last month
- Your top use cases (classified by prompt patterns)
- Personalized tips: *"You're using GPT-4o for summarisation — Claude Haiku costs 95% less for this task"*

**AI Advisor proactively sends:**
- Weekly digest emails / Slack notifications per user
- Model swap recommendations with estimated savings
- Budget warnings before limits are hit

**Example advisor output:**
> *"Team Alpha is using GPT-4o for simple classification tasks. Switching to Claude Haiku would reduce their monthly cost by $2,340 with no quality loss. Want me to update your Kong routing rule to try Haiku for 20% of these requests?"*

The advisor can also trigger **automatic A/B routing** via Kong — split traffic between models to validate quality before full switch.

---

### 5. Audit Trail

**Where:** Audit Trail Service (append-only log)

- Every event (request, block, anomaly, budget action) written to immutable audit log
- Stores: timestamp, user, team, provider, model, token count, cost, action taken, policy triggered
- Does NOT store prompt/response content (privacy by design)
- Queryable via dashboard with filters: date range, user, team, provider, event type
- Exportable as CSV / JSON for compliance reporting
- Retention policy configurable (default: 2 years)

---

## Multi-Persona Dashboard Views

| Persona | Key Screens | Key Metrics |
|---------|------------|-------------|
| **FinOps / Finance** | Cost by dept, chargeback report, budget vs actual, vendor breakdown | Total spend, cost per team, forecast accuracy |
| **Engineering Lead** | Usage by service/repo, anomaly feed, model performance | Tokens/request, error rates, model distribution |
| **C-Suite / VP** | Executive summary, 90-day forecast, top cost drivers, savings opportunities | YoY trend, ROI of AI investment, risk flags |
| **Individual User** | My usage, my costs, tips, model recommendations | My spend this week, savings I could make |

---

## Role-Based Access Control (RBAC)

RBAC operates at two levels: **Kong gateway enforcement** (what AI models/providers a user can call) and **AIRA dashboard permissions** (what data a user can see and what actions they can take).

### Roles

| Role | Who | Gateway Permissions | Dashboard Permissions |
|------|-----|--------------------|-----------------------|
| **Super Admin** | Platform team | Full access to all routes, can manage all Kong consumers | Full platform config, all orgs/depts, billing, user management |
| **Org Admin** | IT / FinOps lead | Configure policies for their org, set budgets | All views for their org, chargeback export, anomaly config |
| **Department Manager** | Team lead | View-only on gateway for their dept | Department cost view, team usage, budget alerts, audit export |
| **Developer** | Individual contributor | Access only to approved models/providers for their team | Own usage only, model recommendations, tips |
| **Auditor** | Compliance / Legal | No gateway access | Read-only audit trail across entire org, export only |
| **Read-Only Viewer** | Exec / Stakeholder | None | C-Suite dashboard view only, no config access |

---

### Gateway-Level RBAC (Kong)

Kong enforces permissions via **consumer groups** — each user/service gets a Kong consumer tagged with their role and team.

**What Kong RBAC controls:**
- **Model allowlist per role:** Developers can only call approved models (e.g., GPT-4o blocked, Haiku allowed). Org Admin can unlock premium models.
- **Provider allowlist per team:** Team A approved for OpenAI only; Team B approved for OpenAI + Anthropic.
- **Spend limits enforced at gateway:** Hard monthly budget cap per consumer — Kong returns `429 Budget Exceeded` when limit hit.
- **Request rate limits per role:** Developers get 100 req/min; pipelines/services get higher limits via service accounts.

```
Kong Consumer Groups:
  └── org:ericsson
        ├── role:super-admin    → all routes, no limits
        ├── role:developer      → allowlisted models only, budget cap enforced
        ├── role:service-acct   → specific routes only, high rate limit
        └── role:auditor        → no gateway access
```

---

### Dashboard-Level RBAC (AIRA Backend)

JWT tokens carry `role` + `org_id` + `department_id` claims. Every API endpoint in the AIRA backend validates these claims before returning data.

**Data scoping rules:**
- A **Developer** can only query their own `user_id` events — they cannot see teammates' individual usage.
- A **Department Manager** can query all events scoped to their `department_id`.
- An **Org Admin** can query all events for their `org_id`.
- An **Auditor** gets read access to the full audit trail but cannot access raw usage dashboards or config.
- A **Super Admin** has no data scope restriction.

**Action permissions:**

| Action | Super Admin | Org Admin | Dept Manager | Developer | Auditor |
|--------|:-----------:|:---------:|:------------:|:---------:|:-------:|
| Set org budget | ✅ | ✅ | ❌ | ❌ | ❌ |
| Set dept budget | ✅ | ✅ | ✅ | ❌ | ❌ |
| Block/unblock models | ✅ | ✅ | ❌ | ❌ | ❌ |
| View all usage | ✅ | ✅ | Dept only | Own only | ✅ (read) |
| Export chargeback | ✅ | ✅ | Dept only | ❌ | ✅ |
| Export audit trail | ✅ | ✅ | ❌ | ❌ | ✅ |
| Manage users | ✅ | ✅ | ❌ | ❌ | ❌ |
| Configure GDPR rules | ✅ | ✅ | ❌ | ❌ | ❌ |
| View AI Advisor tips | ✅ | ✅ | ✅ | ✅ | ❌ |

---

### RBAC + GDPR Intersection

Auditors can view the audit trail (which logs *that* a GDPR block occurred and *which policy* triggered it) but **never** the blocked content itself — content is discarded at the gateway and never persisted.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Gateway / Proxy | Kong Gateway (custom Lua plugins) |
| Backend | .NET 8 (ASP.NET Core Minimal API) |
| AI Advisor | Claude API (claude-sonnet-4-6) |
| Database | PostgreSQL + TimescaleDB extension |
| Forecasting | Python microservice (Prophet / statsmodels) |
| Frontend | Next.js 14 + Tailwind CSS + Recharts |
| Auth | JWT (role + org + dept claims) + Kong consumer groups (RBAC enforcement) |
| Notifications | SendGrid (email) + Slack webhook |
| Infra | Docker Compose (demo) → Kubernetes-ready |

---

## Competitive Edge Summary

| Differentiator | Why It Matters |
|---------------|---------------|
| **Kong as control plane** | Zero developer friction — no SDK changes, just redirect base URL |
| **GDPR blocking at gateway** | Data never leaves the org — compliance-first, not an afterthought |
| **AI Advisor (Claude-powered)** | Actionable savings recommendations, not just dashboards |
| **Developer tool tracking** | Copilot, Cursor, Claude Code — nobody tracks these today |
| **Auto A/B model routing** | Kong can split-test models automatically, validating savings before committing |
| **Multi-persona views** | Finance, Engineering, C-Suite, Individual — covers every stakeholder |
| **Two-layer RBAC** | Kong enforces model/budget access; backend enforces data scoping — defence in depth |

---

## Demo Script (Hackathon Day)

1. **The Hook:** "Every month, Ericsson spends $X on AI — but nobody knows where it goes."
2. **Show real data flowing** through Kong → dashboard lighting up in real time
3. **Trigger a GDPR block** — paste a prompt with a fake EU ID number, Kong blocks it at the gateway
4. **Show an anomaly** — spike detection fires, AI Advisor explains it in plain English
5. **Show the recommendation** — "Switch Team Alpha to Haiku, save $2,340/month"
6. **C-Suite slide** — 90-day forecast, budget on track, risk flags

---

## 10-Day Build Plan (High Level)

| Days | Focus |
|------|-------|
| 1–2 | Kong setup + cost tracking plugin + basic ingestion API |
| 3–4 | GDPR filter plugin + audit trail service |
| 5–6 | Dashboard (FinOps + Engineering views) + TimescaleDB |
| 7–8 | AI Advisor agent + prediction engine |
| 9 | C-Suite view + user self-service portal + notifications |
| 10 | Demo polish, real API integrations, rehearsal |

---

*Spec written: 2026-04-18*
*Hackathon: Ericsson — Centralized AI Cost Tracking (PoC)*
