# AIRA Dashboard SPA — Design Spec
**Date:** 2026-04-26  
**Status:** Approved  

---

## Overview

Convert `dashboard-mock.html` into a working Vite + React SPA backed by the existing FastAPI/SQLite backend at `localhost:8002`. The mock's visual design (CSS variables, fonts, SVG charts, amber/dark theme) is preserved verbatim. Static data is replaced with live API calls. A new `/forecast` backend endpoint powers the AI Forecast page via Claude.

---

## Scope

1. **Fix `dashboard-mock.html`** — Add department filter dropdown to the Forecast page with static per-department narrative and rec-card data.
2. **Vite + React SPA** (`dashboard/`) — Full faithful port of the mock with live backend data.
3. **Backend `/forecast` endpoint** — Claude-powered, department-filterable, added to `backend/main.py`.
4. **Hard-coded budgets** in `dashboard/src/config/budgets.js`.
5. **Client-side anomaly detection** derived from live dashboard data.

---

## Project Structure

```
dashboard/
  index.html
  vite.config.js
  package.json
  src/
    main.jsx
    App.jsx                   # router + role state + time-filter state
    styles.css                # verbatim CSS from dashboard-mock.html
    config/
      budgets.js              # { "nlp-platform": 1800, "data-science": 2500, ... }
    api/
      client.js               # fetch wrapper, base URL = http://localhost:8002
      hooks.js                # useQuery-style hooks: useDashboard, useEvents, useForecast, etc.
    components/
      Sidebar.jsx
      Topbar.jsx
      KpiCard.jsx
      ChartCard.jsx           # SVG line + bar + donut charts (ported from mock JS)
      AnomalyItem.jsx
      ForecastPanel.jsx       # narrative + 3 rec-cards + department filter
    pages/
      Overview.jsx
      CostUsage.jsx
      Anomalies.jsx
      Forecast.jsx
      Chargeback.jsx
      TokenLogs.jsx
      Governance.jsx
      Teams.jsx
```

---

## Data Flow

All reads come from the existing FastAPI backend. No new database schema.

| Page | Backend endpoint | Notes |
|---|---|---|
| Overview KPIs + charts | `GET /usage/dashboard?since=<mtd>` | `by_day`, `by_model`, `by_department`, `totals` |
| Cost & Usage | `GET /usage/summary?group_by=user_id` | Per-user cost table |
| Token Logs | `GET /usage/events?limit=100` | Raw event table with provider filter |
| Chargeback | `GET /usage/cost/by-department` | Department breakdown |
| Anomalies | Derived client-side from dashboard `by_day` | 3× rolling average spike rule + budget breach |
| AI Forecast | `GET /forecast[?department=X]` | New endpoint (see below) |

**Time filter** (7d / 30d / 90d / All) translates to `since` query param on all calls. State lives in `App.jsx` and is passed down via props.

**Budgets** — `config/budgets.js` exports a plain object:
```js
export const BUDGETS = {
  "nlp-platform": 1800,
  "data-science":  2500,
  "platform":      1000,
  "finance":        500,
};
export const DEPT_BUDGETS = {
  "R&D":         4500,
  "Engineering": 1000,
  "Finance":      500,
};
```
Utilisation % and status pills (On track / Watch / Over budget) are computed by merging live spend with these constants.

---

## Backend Addition — `/forecast` Endpoint

**File:** `backend/main.py`  
**Dependency:** `anthropic` (add to `requirements.txt`)

```
GET /forecast
GET /forecast?department=R%26D
```

**Logic:**
1. Query SQLite for MTD spend — reuses dashboard query scoped to current month. If `department` param is provided, adds a `WHERE department = ?` filter.
2. Build a structured prompt for Claude including: spend by team, budget per team (hard-coded constants mirrored in backend), daily burn rate, days remaining in month, model breakdown.
3. Call `claude-sonnet-4-6` (direct Anthropic SDK call — does NOT route through Kong to avoid circular cost attribution).
4. Parse response into structured JSON.

**Response shape:**
```json
{
  "narrative": "At the current burn rate of $X/day...",
  "projected_eom": 7240.0,
  "potential_saving": 840.0,
  "risk_teams": ["nlp-platform", "data-science"],
  "department": null,
  "generated_at": "2026-04-26T07:10:00Z"
}
```

**Prompt structure:**
```
You are a FinOps analyst. Given this AI cost data for [org/department]:
- Spend to date: $X
- Budget: $Y  
- Days remaining: Z
- Daily burn rate: $A/day (computed as total_cost_usd / days elapsed this month)
- Days remaining: computed server-side from `datetime.date.today()` vs. last day of current month
- Top cost driver: model M at $B
- By team: [table]

In 2-3 sentences, forecast end-of-month spend, identify the biggest risk, 
and give one actionable recommendation. Be specific about dollar amounts.
Return JSON: { narrative, projected_eom, potential_saving, risk_teams }
```

---

## Anomaly Detection (Client-Side)

Computed in `Anomalies.jsx` from `/usage/dashboard` data:

| Anomaly type | Rule |
|---|---|
| Spend spike | Any day's cost > 3× 7-day rolling average |
| Budget breach | Team spend (from dashboard) > budget (from `budgets.js`) |
| Near-budget warning | Team at ≥ 75% of budget with ≥ 7 days remaining |
| Blocked requests | Count of `status != 200` in `/usage/events` |

Anomalies render as `AnomalyItem` components with CRITICAL / WARN / INFO severity tags, matching the mock's visual style exactly.

---

## Role Gating

Role state lives in `App.jsx` (`useState('finops')`). The role switcher `<select>` updates it. The `roleAccess` map (ported from mock) gates nav items and page content:

```js
const roleAccess = {
  finops:      ['overview','cost','chargeback','forecast'],
  engineering: ['overview','cost','anomalies','forecast','logs'],
  admin:       ['overview','cost','anomalies','forecast','chargeback','logs','governance','teams'],
};
```

Locked pages show the `🔒` message. No server-side enforcement — demo-only.

---

## Mock HTML Fix

**File:** `dashboard-mock.html`  
**Change:** Forecast page (`#page-forecast`) gets a department filter `<select>` above the forecast panel, matching the existing `.model-filter` CSS class. Static content for each department option:

- **All departments** (default) — existing org-wide narrative and rec-cards
- **R&D** — R&D-scoped narrative, projected EOM, potential saving, risk teams
- **Engineering** — Engineering-scoped data
- **Finance** — Finance-scoped data

A small `<script>` block on the page swaps the panel content on `change`.

---

## Tech Stack

| Tool | Version | Purpose |
|---|---|---|
| Vite | 5.x | Build tool, dev server with proxy |
| React | 18.x | UI framework |
| No component library | — | Mock CSS is the design system |
| Anthropic SDK | latest | Claude API calls from backend |

**Vite proxy config** — dev server proxies `/api` → `http://localhost:8002` to avoid CORS during development:
```js
// vite.config.js
export default { server: { proxy: { '/api': 'http://localhost:8002' } } }
```

`client.js` fetch wrapper uses base URL `/api` in dev (proxied) and `http://localhost:8002` directly in production builds (configurable via `VITE_API_BASE` env var).

---

## Out of Scope

- Real OIDC login (role switcher only)
- Persistent budget storage (hard-coded constants)
- WebSocket real-time updates (fetch on mount + filter change)
- Unit tests for the SPA (backend already has 20 pytest tests)
