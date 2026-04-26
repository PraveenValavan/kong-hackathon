# AIRA — Roadmap

## Done

| Area | Details |
|---|---|
| Kong AI Gateway | DB-less mode, 3 providers (OpenAI / Anthropic / Gemini), OIDC, ai-prompt-guard, ai-rate-limiting-advanced |
| AIRA FastAPI backend | `/ingest/event`, cost attribution, SQLite storage, idempotency via `event_id` |
| `aira-chat.sh` | JWT fetch + Kong call with `--provider`, `--role`, `--session` flags |
| `aira-usage.sh` | Query all backend endpoints: dashboard, events, sessions, cost-by-user, cost-by-dept, SQLite shell |
| Backend tests | 20 pytest tests — ingest, idempotency, cost calculation, sessions, filters |

## Pending

- [ ] **Next.js Dashboard** — Role-aware frontend (FinOps / Engineering / Admin views)
  - [ ] Login page — JWT role detection → redirect to `/overview`
  - [ ] Overview page — KPI row (MTD spend, budget remaining, EOM forecast) + spend-by-team bar chart
  - [ ] Cost & Usage page — 30-day rolling spend line chart by provider
  - [ ] Chargeback report — department cost breakdown, export (FinOps role)
  - [ ] Token Logs — raw event table with filters (Engineering role)
  - [ ] Anomalies page — spike detection view (Engineering role)
  - [ ] Governance / Teams & Budgets — RBAC + budget config (Admin role)

- [ ] **Claude AI Forecast** — `/forecast` backend endpoint; Claude Sonnet reads cost data and returns natural-language trajectory summary + model-switch recommendations

- [ ] **Anomaly detection** — Rule-based spike alerts (3× normal usage in 1 hour) emitted to dashboard Anomalies page

- [ ] **Budget enforcement at Kong** — Hard monthly cap per consumer in `kong.yml`; Kong returns `429 Budget Exceeded` when limit hit
