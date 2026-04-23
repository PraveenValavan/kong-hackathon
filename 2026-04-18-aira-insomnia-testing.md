# AIRA — Kong Insomnia Testing Guide

> API test playbook for the AIRA platform using Kong Insomnia
>
> Hackathon: Ericsson — Centralized AI Cost Tracking (PoC)

---

## Setup

### 1. Install Kong Insomnia

Download from [insomnia.rest](https://insomnia.rest) — Desktop app (free tier is enough).

### 2. Create a New Collection

- Open Insomnia → **New Collection** → Name it `AIRA - Ericsson Hackathon`

### 3. Configure Environments

Create two environments:

**Base Environment (shared variables):**
```json
{
  "base_url": "http://localhost:8000",
  "admin_url": "http://localhost:8001",
  "aira_api": "http://localhost:5000"
}
```

**Developer (JWT):**
```json
{
  "token": "<developer-jwt>",
  "user_id": "dev-001",
  "team_id": "team-alpha",
  "role": "developer"
}
```

**Org Admin (JWT):**
```json
{
  "token": "<org-admin-jwt>",
  "user_id": "admin-001",
  "org_id": "org-ericsson",
  "role": "org-admin"
}
```

> **Tip:** Switch environments using the dropdown at the top of Insomnia — no need to change requests manually.

---

## Folder Structure

Organise requests into folders matching AIRA's features:

```
AIRA Collection/
├── 1. Kong Gateway — Proxy Calls
├── 2. GDPR Content Filter
├── 3. Cost Tracking & Usage
├── 4. Anomaly & Alerts
├── 5. AI Advisor
├── 6. Dashboard API
└── 7. Admin — Kong Config
```

---

## 1. Kong Gateway — Proxy Calls

These requests go through Kong (port `8000`) and are intercepted by the cost tracking plugin.

### 1.1 — Normal OpenAI Request (via Kong)

```
POST {{ base_url }}/openai/v1/chat/completions
Authorization: Bearer {{ token }}
Content-Type: application/json
```

**Body:**
```json
{
  "model": "gpt-4o",
  "messages": [
    { "role": "user", "content": "Summarise the quarterly report in 3 bullet points." }
  ]
}
```

**Expected:** `200 OK` — response forwarded from OpenAI, cost event logged in AIRA.

---

### 1.2 — Normal Anthropic Request (via Kong)

```
POST {{ base_url }}/anthropic/v1/messages
Authorization: Bearer {{ token }}
Content-Type: application/json
```

**Body:**
```json
{
  "model": "claude-haiku-4-5-20251001",
  "max_tokens": 256,
  "messages": [
    { "role": "user", "content": "Classify this email as spam or not spam." }
  ]
}
```

**Expected:** `200 OK` — token usage extracted and tagged with `team_id`, `user_id`.

---

### 1.3 — Budget Exceeded (Hard Cap)

> Switch to an environment where the team has hit its monthly budget cap.

```
POST {{ base_url }}/openai/v1/chat/completions
Authorization: Bearer {{ token }}
```

**Expected:** `429 Too Many Requests`
```json
{
  "message": "Budget Exceeded",
  "detail": "Monthly spend limit for team-alpha has been reached."
}
```

---

## 2. GDPR Content Filter

These requests demonstrate the pre-route PII blocking plugin.

### 2.1 — PII Detected — EU National ID

```
POST {{ base_url }}/openai/v1/chat/completions
Authorization: Bearer {{ token }}
Content-Type: application/json
```

**Body:**
```json
{
  "model": "gpt-4o",
  "messages": [
    { "role": "user", "content": "Check if this person is eligible: Jan Kowalski, PESEL 85010112345, DOB 1985-01-01." }
  ]
}
```

**Expected:** `403 Forbidden`
```json
{
  "blocked": true,
  "reason": "PII detected — EU national ID (PESEL) found in prompt.",
  "policy": "gdpr-strict",
  "audit_ref": "evt-20260421-0042"
}
```

> **Demo moment:** This is your GDPR live demo — paste this and show the instant block.

---

### 2.2 — PII Detected — Credit Card

```json
{
  "model": "gpt-4o",
  "messages": [
    { "role": "user", "content": "Process refund for card 4111 1111 1111 1111 expiry 12/27." }
  ]
}
```

**Expected:** `403 Forbidden` — credit card PII blocked before leaving the org.

---

### 2.3 — Non-Work Content Block

```json
{
  "model": "gpt-4o",
  "messages": [
    { "role": "user", "content": "Write me a bedtime story about a dragon." }
  ]
}
```

**Expected:** `403 Forbidden` (if strict) or `200` with warning flag in response headers (if warn-only mode).

---

### 2.4 — Clean Prompt — Should Pass

```json
{
  "model": "gpt-4o",
  "messages": [
    { "role": "user", "content": "Summarise the key risks in the attached contract." }
  ]
}
```

**Expected:** `200 OK` — clean prompt, no PII detected, passes through.

---

## 3. Cost Tracking & Usage

These hit the AIRA backend API directly.

### 3.1 — Get My Usage (Developer)

```
GET {{ aira_api }}/api/usage/me?period=month
Authorization: Bearer {{ token }}
```

**Expected:**
```json
{
  "user_id": "dev-001",
  "period": "2026-04",
  "total_tokens": 142500,
  "total_cost_usd": 4.27,
  "breakdown": [
    { "provider": "openai", "model": "gpt-4o", "tokens": 120000, "cost": 3.60 },
    { "provider": "anthropic", "model": "claude-haiku", "tokens": 22500, "cost": 0.67 }
  ]
}
```

---

### 3.2 — Get Department Usage (Manager)

```
GET {{ aira_api }}/api/usage/department/team-alpha?period=month
Authorization: Bearer {{ token }}   (use Org Admin env)
```

**Expected:** Aggregated usage for all users in `team-alpha`.

---

### 3.3 — Chargeback Report Export

```
GET {{ aira_api }}/api/reports/chargeback?period=2026-04&format=csv
Authorization: Bearer {{ token }}   (use Org Admin env)
```

**Expected:** `200 OK` with `Content-Type: text/csv` — downloadable chargeback report.

---

### 3.4 — RBAC Check — Developer Cannot See Other Users

```
GET {{ aira_api }}/api/usage/user/dev-002
Authorization: Bearer {{ token }}   (use Developer env)
```

**Expected:** `403 Forbidden` — data scoping enforced by backend.

---

## 4. Anomaly & Alerts

### 4.1 — Get Active Anomalies

```
GET {{ aira_api }}/api/anomalies?status=active
Authorization: Bearer {{ token }}
```

**Expected:** List of active anomaly events with severity and AI-generated explanation.

---

### 4.2 — Get Anomaly Detail (with AI Explanation)

```
GET {{ aira_api }}/api/anomalies/{{ anomaly_id }}
Authorization: Bearer {{ token }}
```

**Expected:**
```json
{
  "id": "anm-20260421-007",
  "team": "team-beta",
  "severity": "high",
  "spike_factor": 4.1,
  "detected_at": "2026-04-21T14:02:00Z",
  "ai_explanation": "Team Beta's usage spiked 400% on Tuesday at 2pm. Root cause: a misconfigured retry loop in their document processing pipeline. Estimated overrun: $340."
}
```

---

## 5. AI Advisor

### 5.1 — Get My Recommendations

```
GET {{ aira_api }}/api/advisor/recommendations/me
Authorization: Bearer {{ token }}
```

**Expected:**
```json
{
  "recommendations": [
    {
      "type": "model_swap",
      "current_model": "gpt-4o",
      "suggested_model": "claude-haiku",
      "use_case": "summarisation",
      "estimated_monthly_saving_usd": 2340,
      "confidence": 0.91
    }
  ]
}
```

---

### 5.2 — Trigger A/B Model Routing via Advisor

```
POST {{ aira_api }}/api/advisor/ab-routing
Authorization: Bearer {{ token }}   (Org Admin)
Content-Type: application/json
```

**Body:**
```json
{
  "team_id": "team-alpha",
  "current_model": "gpt-4o",
  "test_model": "claude-haiku",
  "split_percentage": 20,
  "use_case_tag": "summarisation"
}
```

**Expected:** `202 Accepted` — Kong routing rule updated, 20% of summarisation traffic routed to Haiku.

---

## 6. Dashboard API

### 6.1 — FinOps Summary

```
GET {{ aira_api }}/api/dashboard/finops?period=month
Authorization: Bearer {{ token }}   (Org Admin)
```

---

### 6.2 — 90-Day Cost Forecast

```
GET {{ aira_api }}/api/forecast?horizon=90d&scope=org
Authorization: Bearer {{ token }}
```

**Expected:** Array of daily predicted cost data points with confidence intervals.

---

### 6.3 — Audit Trail Query

```
GET {{ aira_api }}/api/audit?from=2026-04-01&to=2026-04-21&event_type=gdpr_block
Authorization: Bearer {{ token }}   (Auditor env)
```

**Expected:** List of GDPR block events — no prompt content stored, only metadata.

---

## 7. Admin — Kong Config

These hit the Kong Admin API (port `8001`) — not exposed publicly in prod.

### 7.1 — List All Consumers

```
GET {{ admin_url }}/consumers
```

---

### 7.2 — Check Consumer Group (RBAC)

```
GET {{ admin_url }}/consumers/dev-001/groups
```

**Expected:** Consumer tagged with `role:developer` and `org:ericsson`.

---

### 7.3 — Check Rate Limit Plugin on a Route

```
GET {{ admin_url }}/routes/openai-proxy/plugins
```

---

## Demo Flow Checklist

Use this order for the hackathon demo:

- [ ] **1.1** — Normal OpenAI call flows through Kong, cost appears in dashboard
- [ ] **2.1** — GDPR block fires instantly on EU national ID
- [ ] **4.2** — Anomaly fires, AI Advisor explains in plain English
- [ ] **5.1** — Advisor recommends model swap, shows $2,340 saving
- [ ] **6.2** — C-Suite 90-day forecast slide

---

*Testing guide written: 2026-04-21*
*Paired with: [2026-04-18-aira-design.md](./2026-04-18-aira-design.md)*
