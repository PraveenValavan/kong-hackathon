# AIRA Dashboard SPA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert `dashboard-mock.html` into a live Vite + React SPA backed by the FastAPI/SQLite backend, add a Claude-powered `/forecast` endpoint with department filter, and fix the mock's Forecast page.

**Architecture:** Faithful 1:1 port of the mock's CSS/SVG/layout into React components with `useState`+`useEffect` data fetching (no React Router, no component library). Role gating and page switching are controlled by `currentPage`/`currentRole` state in `App.jsx`. The backend gets a new `/forecast` GET endpoint that queries SQLite and calls `claude-sonnet-4-6` via the Anthropic SDK.

**Tech Stack:** Vite 5, React 18, plain CSS (extracted from mock), FastAPI, Anthropic SDK (`anthropic` pip package).

---

## File Map

### Modified files
| File | Change |
|---|---|
| `dashboard-mock.html` | Add department filter `<select>` to Forecast page |
| `backend/main.py` | Add CORS middleware + `TEAM_BUDGETS`/`DEPT_BUDGETS` constants + `/forecast` endpoint |
| `backend/requirements.txt` | Add `anthropic` |
| `backend/test_main.py` | Add tests for `/forecast` endpoint |

### New files — `dashboard/`
| File | Responsibility |
|---|---|
| `package.json` | Vite + React deps |
| `vite.config.js` | Dev proxy `/api` → `localhost:8002` |
| `index.html` | HTML entry point |
| `src/main.jsx` | React root mount |
| `src/App.jsx` | Role/page/timeFilter state, layout shell |
| `src/styles.css` | Verbatim CSS from mock's `<style>` block |
| `src/config/budgets.js` | Hard-coded team + dept budget constants |
| `src/api/client.js` | `apiFetch()` wrapper + `sinceFromFilter()` |
| `src/api/hooks.js` | `useDashboard`, `useEvents`, `useSummary`, `useDeptCost`, `useForecast` |
| `src/components/Sidebar.jsx` | Nav + role switcher |
| `src/components/Topbar.jsx` | Page title + time filter buttons + alert pill |
| `src/components/KpiCard.jsx` | KPI card with bar/delta |
| `src/components/AnomalyItem.jsx` | Single anomaly row |
| `src/components/ChartCard.jsx` | SVG line, bar, and donut chart helpers |
| `src/components/ForecastPanel.jsx` | Forecast narrative + 3 rec-cards + dept filter |
| `src/pages/Overview.jsx` | KPIs, spend chart, team table, forecast mini, anomaly strip, events |
| `src/pages/CostUsage.jsx` | Cost by user table |
| `src/pages/Anomalies.jsx` | Client-side anomaly detection + feed |
| `src/pages/Forecast.jsx` | Full forecast page with dept filter |
| `src/pages/Chargeback.jsx` | Department chargeback table |
| `src/pages/TokenLogs.jsx` | Raw event log table |
| `src/pages/Governance.jsx` | RBAC matrix (role-gated) |
| `src/pages/Teams.jsx` | Budget configuration table (role-gated) |

---

## Task 1: Fix dashboard-mock.html — Forecast department filter

**Files:**
- Modify: `dashboard-mock.html`

- [ ] **Step 1: Add static per-department data object in the script block**

In `dashboard-mock.html`, find the `<script>` block and add before the closing `</script>`:

```js
// Department forecast data
const DEPT_FORECASTS = {
  all: {
    narrative: 'At the current burn rate of <em>$321/day</em>, AIRA projects <em>$7,240</em> in total April spend — <em>61% over the $4,500 budget</em>. The primary driver is the <em>nlp-platform team</em>, whose token usage spiked 4× this week, likely due to long-context batch jobs against <em>claude-haiku-4-5</em>. Switching this workload to <em>gemini-2.5-flash</em> would reduce cost by approximately <em>$840/month</em> with comparable output quality for summarisation tasks. The <em>data-science team</em> is on track to exceed its budget by <em>$340</em>; a 20% token reduction or budget increase is recommended before Apr 28.',
    eom: '$7,240', eomSub: 'vs $4,500 budget',
    saving: '$840/mo', savingSub: 'switch nlp → gemini-2.5-flash',
    risk: '2 of 4', riskSub: 'nlp-platform (over), data-science (watch)',
  },
  rd: {
    narrative: 'R&D is burning <em>$201/day</em>, projecting <em>$4,430</em> by month-end against a <em>$4,300 combined budget</em>. The <em>nlp-platform</em> team is already <em>$334 over its $1,800 cap</em> and driving 53% of department spend. Migrating batch summarisation from <em>claude-haiku-4-5</em> to <em>gemini-2.5-flash</em> could save <em>$620/month</em> with no quality degradation on summarisation tasks.',
    eom: '$4,430', eomSub: 'vs $4,300 R&D budget',
    saving: '$620/mo', savingSub: 'switch nlp batch → gemini-2.5-flash',
    risk: '2 of 2', riskSub: 'nlp-platform (over), data-science (watch)',
  },
  engineering: {
    narrative: 'Engineering is well within budget, spending <em>$512</em> of a <em>$1,000 cap</em> with 12 days remaining — projected at <em>$640 by month-end</em>. The primary model is <em>gpt-4o</em> via OpenAI. No immediate action required; consider reviewing rate-limit thresholds if usage continues to grow at the current 11% month-on-month rate.',
    eom: '$640', eomSub: 'vs $1,000 budget',
    saving: '$0', savingSub: 'no switch recommended',
    risk: '0 of 1', riskSub: 'platform on track',
  },
  finance: {
    narrative: 'Finance is tracking conservatively at <em>$285</em> of a <em>$500 budget</em>, projecting <em>$356 by month-end</em>. Usage is exclusively <em>gemini-2.5-flash</em>, the most cost-efficient model available. No action required; budget utilisation is healthy at 57%.',
    eom: '$356', eomSub: 'vs $500 budget',
    saving: '$0', savingSub: 'already on cheapest model',
    risk: '0 of 1', riskSub: 'finance on track',
  },
};

function applyForecastDept(key) {
  const d = DEPT_FORECASTS[key];
  document.getElementById('forecast-narrative').innerHTML = d.narrative;
  document.getElementById('forecast-eom').textContent = d.eom;
  document.getElementById('forecast-eom-sub').textContent = d.eomSub;
  document.getElementById('forecast-saving').textContent = d.saving;
  document.getElementById('forecast-saving-sub').textContent = d.savingSub;
  document.getElementById('forecast-risk').textContent = d.risk;
  document.getElementById('forecast-risk-sub').textContent = d.riskSub;
}
```

- [ ] **Step 2: Add the department filter select + ID attributes to the Forecast page**

Find `<div class="page" id="page-forecast">` in `dashboard-mock.html`. Replace the inner `<div class="forecast-panel">` opening section:

```html
<!-- department filter -->
<div class="section-header" style="margin-bottom:16px">
  <span class="section-title">AI Forecast</span>
  <div class="section-line"></div>
  <select class="model-filter" id="forecastDeptFilter" onchange="applyForecastDept(this.value)">
    <option value="all">All Departments</option>
    <option value="rd">R&amp;D</option>
    <option value="engineering">Engineering</option>
    <option value="finance">Finance</option>
  </select>
</div>

<div class="forecast-panel">
  <div class="forecast-header">
    <div class="forecast-badge">Claude AI Forecast</div>
    <span class="forecast-model">claude-sonnet-4-6 · generated 07:10 UTC</span>
  </div>
  <div class="forecast-text" id="forecast-narrative">
    At the current burn rate of <em>$321/day</em>, AIRA projects <em>$7,240</em> in total April spend — <em>61% over the $4,500 budget</em>. The primary driver is the <em>nlp-platform team</em>, whose token usage spiked 4× this week, likely due to long-context batch jobs against <em>claude-haiku-4-5</em>. Switching this workload to <em>gemini-2.5-flash</em> would reduce cost by approximately <em>$840/month</em> with comparable output quality for summarisation tasks. The <em>data-science team</em> is on track to exceed its budget by <em>$340</em>; a 20% token reduction or budget increase is recommended before Apr 28.
  </div>
  <div class="forecast-recs">
    <div class="forecast-rec">
      <div class="rec-label">Projected EOM</div>
      <div class="rec-value" id="forecast-eom">$7,240</div>
      <div class="rec-sub" id="forecast-eom-sub">vs $4,500 budget</div>
    </div>
    <div class="forecast-rec">
      <div class="rec-label">Potential Saving</div>
      <div class="rec-value" id="forecast-saving">$840/mo</div>
      <div class="rec-sub" id="forecast-saving-sub">switch nlp → gemini-2.5-flash</div>
    </div>
    <div class="forecast-rec">
      <div class="rec-label">Risk Teams</div>
      <div class="rec-value" id="forecast-risk">2 of 4</div>
      <div class="rec-sub" id="forecast-risk-sub">nlp-platform (over), data-science (watch)</div>
    </div>
  </div>
</div>
```

- [ ] **Step 3: Open the mock in a browser and verify the filter works**

```bash
open dashboard-mock.html
```

Click the Forecast nav item. Change the department dropdown through each option and confirm the narrative and rec-cards update.

- [ ] **Step 4: Commit**

```bash
git add dashboard-mock.html
git commit -m "feat(mock): add department filter to Forecast page"
```

---

## Task 2: Backend — add CORS middleware

**Files:**
- Modify: `backend/main.py`

- [ ] **Step 1: Add CORS middleware import and setup after `app = FastAPI(...)`**

In `backend/main.py`, add after the `app = FastAPI(...)` line:

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)
```

- [ ] **Step 2: Run existing tests to confirm nothing breaks**

```bash
cd backend && pytest test_main.py -v
```

Expected: all existing tests pass.

- [ ] **Step 3: Commit**

```bash
git add backend/main.py
git commit -m "feat(backend): add CORS middleware for SPA dev server"
```

---

## Task 3: Backend — `/forecast` endpoint (TDD)

**Files:**
- Modify: `backend/requirements.txt`
- Modify: `backend/test_main.py`
- Modify: `backend/main.py`

- [ ] **Step 1: Add `anthropic` to requirements.txt**

```
fastapi==0.115.12
uvicorn[standard]==0.34.0
httpx==0.27.0
pytest==8.3.5
anthropic
```

- [ ] **Step 2: Install it**

```bash
cd backend && pip install anthropic
```

Expected: `Successfully installed anthropic-...`

- [ ] **Step 3: Write failing tests for `/forecast`**

Add to the end of `backend/test_main.py`:

```python
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
```

- [ ] **Step 4: Run tests to confirm they fail**

```bash
cd backend && pytest test_main.py::test_forecast_returns_expected_shape -v
```

Expected: `FAILED` — `AttributeError: module 'main' has no attribute 'anthropic'` (endpoint not implemented yet).

- [ ] **Step 5: Add budget constants and `/forecast` endpoint to `main.py`**

Add after the `MODEL_COSTS` dict:

```python
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
```

Add the endpoint before `@app.get("/health")`:

```python
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
```

- [ ] **Step 6: Run all forecast tests**

```bash
cd backend && pytest test_main.py::test_forecast_returns_expected_shape test_main.py::test_forecast_department_filter test_main.py::test_forecast_handles_no_data -v
```

Expected: all 3 PASS.

- [ ] **Step 7: Run full test suite**

```bash
cd backend && pytest test_main.py -v
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add backend/main.py backend/requirements.txt backend/test_main.py
git commit -m "feat(backend): add /forecast endpoint with Claude + department filter"
```

---

## Task 4: Scaffold Vite project

**Files:**
- Create: `dashboard/package.json`
- Create: `dashboard/vite.config.js`
- Create: `dashboard/index.html`

- [ ] **Step 1: Create `dashboard/package.json`**

```json
{
  "name": "aira-dashboard",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.1",
    "vite": "^5.4.0"
  }
}
```

- [ ] **Step 2: Create `dashboard/vite.config.js`**

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8002',
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
```

- [ ] **Step 3: Create `dashboard/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AIRA — AI Resource &amp; Analytics Platform</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=IBM+Plex+Mono:wght@300;400;500;600&display=swap" rel="stylesheet">
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.jsx"></script>
</body>
</html>
```

- [ ] **Step 4: Install dependencies**

```bash
cd dashboard && npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 5: Commit**

```bash
git add dashboard/package.json dashboard/vite.config.js dashboard/index.html dashboard/package-lock.json
git commit -m "feat(dashboard): scaffold Vite + React project"
```

---

## Task 5: CSS + entry point

**Files:**
- Create: `dashboard/src/styles.css`
- Create: `dashboard/src/main.jsx`

- [ ] **Step 1: Create `dashboard/src/styles.css`**

Copy the entire content of the `<style>` block from `dashboard-mock.html` (lines 9–613) verbatim into this file. The file starts with `:root {` and ends with `}` closing the `.provider-pill.gemini` rule.

- [ ] **Step 2: Create `dashboard/src/main.jsx`**

```jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

- [ ] **Step 3: Create a minimal `dashboard/src/App.jsx` stub to verify render**

```jsx
export default function App() {
  return <div style={{ color: 'var(--amber)', padding: 20 }}>AIRA booting…</div>;
}
```

- [ ] **Step 4: Start dev server and verify**

```bash
cd dashboard && npm run dev
```

Open `http://localhost:5173`. Expected: dark background (`#0a0a0b`), amber "AIRA booting…" text, IBM Plex Mono font loaded.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/
git commit -m "feat(dashboard): add CSS + entry point"
```

---

## Task 6: Config + API layer

**Files:**
- Create: `dashboard/src/config/budgets.js`
- Create: `dashboard/src/api/client.js`
- Create: `dashboard/src/api/hooks.js`

- [ ] **Step 1: Create `dashboard/src/config/budgets.js`**

```js
export const TEAM_BUDGETS = {
  'nlp-platform': 1800,
  'data-science':  2500,
  'platform':      1000,
  'finance':        500,
};

export const DEPT_BUDGETS = {
  'R&D':         4500,
  'Engineering': 1000,
  'Finance':      500,
};

export function teamStatus(spend, team) {
  const budget = TEAM_BUDGETS[team];
  if (!budget) return 'ok';
  const pct = spend / budget;
  if (pct >= 1) return 'over';
  if (pct >= 0.75) return 'warn';
  return 'ok';
}

export function teamPct(spend, team) {
  const budget = TEAM_BUDGETS[team];
  if (!budget) return 0;
  return Math.min(Math.round((spend / budget) * 100), 100);
}
```

- [ ] **Step 2: Create `dashboard/src/api/client.js`**

```js
const BASE = import.meta.env.VITE_API_BASE ?? '/api';

export async function apiFetch(path, params = {}) {
  const url = new URL(BASE + path, window.location.origin);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  });
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}

export function sinceFromFilter(filter) {
  const today = new Date();
  if (filter === '7d') {
    const d = new Date(today);
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  }
  if (filter === '30d') {
    return new Date(today.getFullYear(), today.getMonth(), 1)
      .toISOString().slice(0, 10);
  }
  if (filter === '90d') {
    const d = new Date(today);
    d.setDate(d.getDate() - 90);
    return d.toISOString().slice(0, 10);
  }
  return null; // 'All'
}
```

- [ ] **Step 3: Create `dashboard/src/api/hooks.js`**

```js
import { useState, useEffect } from 'react';
import { apiFetch, sinceFromFilter } from './client';

function useQuery(path, params, deps) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch(path, params)
      .then(d => { if (!cancelled) { setData(d); setError(null); } })
      .catch(e => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error };
}

export function useDashboard(timeFilter, department) {
  const since = sinceFromFilter(timeFilter);
  return useQuery('/usage/dashboard', { since, department }, [since, department]);
}

export function useEvents(timeFilter, provider, limit = 100) {
  const since = sinceFromFilter(timeFilter);
  return useQuery('/usage/events', { since, limit, provider }, [since, provider, limit]);
}

export function useSummary(timeFilter, groupBy = 'user_id') {
  const since = sinceFromFilter(timeFilter);
  return useQuery('/usage/summary', { since, group_by: groupBy }, [since, groupBy]);
}

export function useDeptCost(timeFilter) {
  const since = sinceFromFilter(timeFilter);
  return useQuery('/usage/cost/by-department', { since }, [since]);
}

export function useForecast(department) {
  return useQuery('/forecast', { department: department || undefined }, [department]);
}
```

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/config/ dashboard/src/api/
git commit -m "feat(dashboard): add budget config + API layer"
```

---

## Task 7: Layout shell — App.jsx

**Files:**
- Modify: `dashboard/src/App.jsx`

- [ ] **Step 1: Replace the stub App.jsx with the full layout shell**

```jsx
import { useState } from 'react';
import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';
import Overview from './pages/Overview';
import CostUsage from './pages/CostUsage';
import Anomalies from './pages/Anomalies';
import Forecast from './pages/Forecast';
import Chargeback from './pages/Chargeback';
import TokenLogs from './pages/TokenLogs';
import Governance from './pages/Governance';
import Teams from './pages/Teams';

export const ROLE_ACCESS = {
  finops:      ['overview', 'cost', 'chargeback', 'forecast'],
  engineering: ['overview', 'cost', 'anomalies', 'forecast', 'logs'],
  admin:       ['overview', 'cost', 'anomalies', 'forecast', 'chargeback', 'logs', 'governance', 'teams'],
};

export const PAGE_TITLES = {
  overview:   'Overview',
  cost:       'Cost & Usage',
  anomalies:  'Anomalies',
  forecast:   'AI Forecast',
  chargeback: 'Chargeback',
  logs:       'Token Logs',
  governance: 'Governance',
  teams:      'Teams & Budgets',
};

const PAGES = {
  overview:   Overview,
  cost:       CostUsage,
  anomalies:  Anomalies,
  forecast:   Forecast,
  chargeback: Chargeback,
  logs:       TokenLogs,
  governance: Governance,
  teams:      Teams,
};

export default function App() {
  const [currentPage, setCurrentPage] = useState('overview');
  const [currentRole, setCurrentRole] = useState('finops');
  const [timeFilter, setTimeFilter] = useState('30d');

  const access = ROLE_ACCESS[currentRole];
  const PageComponent = PAGES[currentPage];

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar
        currentPage={currentPage}
        currentRole={currentRole}
        access={access}
        onNavigate={setCurrentPage}
        onRoleChange={setCurrentRole}
      />
      <main className="main">
        <Topbar
          title={PAGE_TITLES[currentPage]}
          timeFilter={timeFilter}
          onTimeFilterChange={setTimeFilter}
        />
        <div className="content">
          <PageComponent
            timeFilter={timeFilter}
            currentRole={currentRole}
            onNavigate={setCurrentPage}
          />
        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Create stub page files so the app compiles**

Create each of these files with the same one-line stub — replace `PageName` with the actual name:

`dashboard/src/pages/Overview.jsx`:
```jsx
export default function Overview() { return <div style={{color:'var(--text2)',padding:20}}>Overview loading…</div>; }
```

Repeat for: `CostUsage.jsx`, `Anomalies.jsx`, `Forecast.jsx`, `Chargeback.jsx`, `TokenLogs.jsx`, `Governance.jsx`, `Teams.jsx` — same pattern with the page name.

Create stub components:

`dashboard/src/components/Sidebar.jsx`:
```jsx
export default function Sidebar() { return <aside className="sidebar"></aside>; }
```

`dashboard/src/components/Topbar.jsx`:
```jsx
export default function Topbar({ title }) { return <div className="topbar"><span className="page-title">{title}</span></div>; }
```

- [ ] **Step 3: Verify the app renders without errors**

```bash
cd dashboard && npm run dev
```

Open `http://localhost:5173`. Expected: dark sidebar on the left, topbar with "Overview" text, main area showing "Overview loading…". No console errors.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/
git commit -m "feat(dashboard): add App.jsx routing shell + page stubs"
```

---

## Task 8: Sidebar component

**Files:**
- Modify: `dashboard/src/components/Sidebar.jsx`

- [ ] **Step 1: Implement Sidebar.jsx**

```jsx
export default function Sidebar({ currentPage, currentRole, access, onNavigate, onRoleChange }) {
  const navItems = [
    { key: 'overview',   label: 'Overview',        section: 'Monitor',  icon: <OverviewIcon /> },
    { key: 'cost',       label: 'Cost & Usage',    section: null,       icon: <CostIcon /> },
    { key: 'anomalies',  label: 'Anomalies',       section: null,       icon: <AnomalyIcon />, badge: '3', badgeType: 'danger' },
    { key: 'forecast',   label: 'AI Forecast',     section: null,       icon: <ForecastIcon />, badge: 'NEW', badgeType: 'warn' },
    { key: 'chargeback', label: 'Chargeback',      section: 'Finance',  icon: <ChargebackIcon /> },
    { key: 'logs',       label: 'Token Logs',      section: null,       icon: <LogsIcon /> },
    { key: 'governance', label: 'Governance',      section: 'Admin',    icon: <GovernanceIcon /> },
    { key: 'teams',      label: 'Teams & Budgets', section: null,       icon: <TeamsIcon /> },
  ];

  let lastSection = null;

  return (
    <aside className="sidebar">
      <div className="logo">
        <div className="logo-mark">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <rect x="1" y="1" width="7" height="7" rx="1.5" fill="#f0a500"/>
            <rect x="10" y="1" width="7" height="7" rx="1.5" fill="#f0a500" opacity="0.5"/>
            <rect x="1" y="10" width="7" height="7" rx="1.5" fill="#f0a500" opacity="0.3"/>
            <rect x="10" y="10" width="7" height="7" rx="1.5" fill="#f0a500" opacity="0.7"/>
          </svg>
          AIRA
        </div>
        <div className="logo-sub">AI Resource Analytics</div>
      </div>

      <nav className="nav">
        {navItems.map(item => {
          const showSection = item.section && item.section !== lastSection;
          if (showSection) lastSection = item.section;
          const locked = !access.includes(item.key);
          const active = currentPage === item.key;
          return (
            <div key={item.key}>
              {showSection && <div className="nav-section-label">{item.section}</div>}
              <div
                className={`nav-item${active ? ' active' : ''}${locked ? ' locked' : ''}`}
                onClick={() => !locked && onNavigate(item.key)}
              >
                <span className="nav-icon">{item.icon}</span>
                {item.label}
                {item.badge && (
                  <span className={`badge${item.badgeType === 'warn' ? ' warn' : ''}`}>
                    {item.badge}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="role-switcher">
        <div className="role-label">Viewing as</div>
        <select
          className="role-select"
          value={currentRole}
          onChange={e => onRoleChange(e.target.value)}
        >
          <option value="finops">FinOps</option>
          <option value="engineering">Engineering</option>
          <option value="admin">Admin</option>
        </select>
      </div>
    </aside>
  );
}

function OverviewIcon() {
  return <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="1" y="1" width="5" height="5" rx="1"/><rect x="8" y="1" width="5" height="5" rx="1"/><rect x="1" y="8" width="5" height="5" rx="1"/><rect x="8" y="8" width="5" height="5" rx="1"/></svg>;
}
function CostIcon() {
  return <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><polyline points="1,10 4,6 7,8 10,3 13,5"/><line x1="1" y1="13" x2="13" y2="13"/></svg>;
}
function AnomalyIcon() {
  return <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M7 2L13 12H1L7 2Z"/><line x1="7" y1="6" x2="7" y2="9"/><circle cx="7" cy="10.5" r="0.5" fill="currentColor"/></svg>;
}
function ForecastIcon() {
  return <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="7" cy="7" r="5.5"/><path d="M7 4v3l2 2"/></svg>;
}
function ChargebackIcon() {
  return <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="1" y="3" width="12" height="9" rx="1"/><line x1="1" y1="6" x2="13" y2="6"/><line x1="4" y1="9" x2="4" y2="10"/><line x1="7" y1="9" x2="10" y2="9"/></svg>;
}
function LogsIcon() {
  return <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="2" y="1" width="10" height="12" rx="1"/><line x1="4" y1="4" x2="10" y2="4"/><line x1="4" y1="7" x2="10" y2="7"/><line x1="4" y1="10" x2="7" y2="10"/></svg>;
}
function GovernanceIcon() {
  return <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M7 1l6 3v3c0 3-2.5 5.5-6 6.5C1.5 12.5-.5 10 .5 7V4L7 1Z"/></svg>;
}
function TeamsIcon() {
  return <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="5" cy="4" r="2"/><circle cx="10" cy="5" r="1.5"/><path d="M1 12c0-2.2 1.8-4 4-4s4 1.8 4 4"/><path d="M10 8c1.7 0 3 1.3 3 3"/></svg>;
}
```

- [ ] **Step 2: Verify sidebar renders correctly**

Reload `http://localhost:5173`. Expected: sidebar shows all nav items with icons, role switcher at bottom. Clicking items changes the page (still stubs). Role switcher changes locked state.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/components/Sidebar.jsx
git commit -m "feat(dashboard): implement Sidebar with nav + role switcher"
```

---

## Task 9: Topbar + shared components

**Files:**
- Modify: `dashboard/src/components/Topbar.jsx`
- Create: `dashboard/src/components/KpiCard.jsx`
- Create: `dashboard/src/components/AnomalyItem.jsx`

- [ ] **Step 1: Implement Topbar.jsx**

```jsx
export default function Topbar({ title, timeFilter, onTimeFilterChange }) {
  return (
    <div className="topbar">
      <span className="page-title">{title}</span>
      <span className="breadcrumb">/ {new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>
      <div className="topbar-spacer" />
      <div className="time-filter">
        {['7d', '30d', '90d', 'All'].map(f => (
          <button
            key={f}
            className={`tf-btn${timeFilter === f ? ' active' : ''}`}
            onClick={() => onTimeFilterChange(f)}
          >
            {f}
          </button>
        ))}
      </div>
      <div className="alert-pill">
        <div className="alert-dot" />
        R&amp;D over budget
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create KpiCard.jsx**

```jsx
export default function KpiCard({ label, value, delta, deltaType, barPct, variant }) {
  const cls = `kpi-card${variant ? ' ' + variant : ''}`;
  return (
    <div className={cls}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value ?? '—'}</div>
      {delta && <div className={`kpi-delta${deltaType ? ' ' + deltaType : ''}`}>{delta}</div>}
      <div className="kpi-bar">
        <div className="kpi-bar-fill" style={{ width: `${Math.min(barPct ?? 0, 100)}%` }} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create AnomalyItem.jsx**

```jsx
export default function AnomalyItem({ severity, team, message, time }) {
  const isWarn = severity === 'WARN' || severity === 'INFO';
  return (
    <div className={`anomaly-item${isWarn ? ' warn' : ''}`}>
      <span
        className="anomaly-tag"
        style={isWarn ? { color: 'var(--amber)', background: 'rgba(240,165,0,0.1)', borderColor: 'rgba(240,165,0,0.25)' } : {}}
      >
        {severity}
      </span>
      <span>
        <strong style={{ color: 'var(--text)' }}>{team}</strong> — {message}
      </span>
      <span className="anomaly-time">{time}</span>
    </div>
  );
}
```

- [ ] **Step 4: Verify topbar renders**

Reload `http://localhost:5173`. Expected: topbar shows "Overview / Apr 2026", time filter buttons (30d active), red alert pill.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/components/
git commit -m "feat(dashboard): add Topbar, KpiCard, AnomalyItem components"
```

---

## Task 10: Chart components

**Files:**
- Create: `dashboard/src/components/ChartCard.jsx`

- [ ] **Step 1: Create ChartCard.jsx with SVG helpers**

```jsx
const W = 820, H = 140, PAD = 20, TOP = 10, BOT = 120, MAX_V = 280;

function xScale(i, len) { return PAD + (i / Math.max(len - 1, 1)) * (W - PAD * 2); }
function yScale(v) { return TOP + (BOT - TOP) * (1 - Math.min(v, MAX_V) / MAX_V); }

function linePath(values) {
  if (!values.length) return '';
  return values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i, values.length).toFixed(1)},${yScale(v).toFixed(1)}`).join(' ');
}

function areaPath(values) {
  if (!values.length) return '';
  const line = linePath(values);
  const last = values.length - 1;
  return `${line} L ${xScale(last, values.length).toFixed(1)},${BOT} L ${PAD},${BOT} Z`;
}

export function SpendLineChart({ byDay }) {
  const costs = (byDay ?? []).map(d => d.cost_usd ?? 0);

  return (
    <svg className="chart" width="100%" height="140" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="amberGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f0a500" stopOpacity="0.3"/>
          <stop offset="100%" stopColor="#f0a500" stopOpacity="0"/>
        </linearGradient>
      </defs>
      <line x1="0" y1="35" x2={W} y2="35" stroke="#2a2a32" strokeWidth="1"/>
      <line x1="0" y1="70" x2={W} y2="70" stroke="#2a2a32" strokeWidth="1"/>
      <line x1="0" y1="105" x2={W} y2="105" stroke="#2a2a32" strokeWidth="1"/>
      <text x="0" y="33" fill="#555560" fontSize="9" fontFamily="IBM Plex Mono">$250</text>
      <text x="0" y="68" fill="#555560" fontSize="9" fontFamily="IBM Plex Mono">$150</text>
      <text x="0" y="103" fill="#555560" fontSize="9" fontFamily="IBM Plex Mono">$50</text>
      <path d={areaPath(costs)} fill="url(#amberGrad)" opacity="0.15"/>
      <path d={linePath(costs)} fill="none" stroke="#f0a500" strokeWidth="2"/>
      <line x1={PAD} y1="21" x2={W - 20} y2="21" stroke="#ef4444" strokeWidth="1" strokeDasharray="4,4" opacity="0.6"/>
      <text x={W - 16} y="24" fill="#ef4444" fontSize="8" fontFamily="IBM Plex Mono">cap</text>
    </svg>
  );
}

export function BarChart({ models }) {
  const data = models ?? [];
  const maxV = Math.max(...data.map(d => d.requests ?? 0), 1);
  const barW = 60, gap = 40, startX = 40;
  const colors = ['#f0a500', '#3b82f6', '#a855f7', '#22c55e'];

  return (
    <svg className="chart" width="100%" height="120" viewBox="0 0 380 120" preserveAspectRatio="none">
      {data.slice(0, 4).map((d, i) => {
        const h = (d.requests / maxV) * 95;
        const x = startX + i * (barW + gap);
        const y = 110 - h;
        const label = (d.model ?? d.group_by ?? '').split('-').slice(-1)[0];
        return (
          <g key={d.model ?? i}>
            <rect x={x} y={y} width={barW} height={h} rx="2" fill={colors[i]} opacity="0.8"/>
            <text x={x + barW / 2} y="108" textAnchor="middle" fill="#555560" fontSize="8" fontFamily="IBM Plex Mono">{label}</text>
            <text x={x + barW / 2} y={y - 4} textAnchor="middle" fill={colors[i]} fontSize="9" fontFamily="Syne,sans-serif" fontWeight="700">
              {d.requests > 999 ? `${(d.requests / 1000).toFixed(1)}k` : d.requests}
            </text>
          </g>
        );
      })}
      <line x1="0" y1="110" x2="380" y2="110" stroke="#2a2a32" strokeWidth="1"/>
    </svg>
  );
}

export function DonutChart({ byProvider }) {
  const total = (byProvider ?? []).reduce((s, d) => s + (d.total_tokens ?? 0), 0);
  const colors = { anthropic: '#a855f7', openai: '#3b82f6', google: '#f0a500' };
  const R = 45, cx = 60, cy = 60, circ = 2 * Math.PI * R;
  let offset = 0;
  const slices = (byProvider ?? []).map(d => {
    const pct = total > 0 ? (d.total_tokens ?? 0) / total : 0;
    const dash = pct * circ;
    const slice = { ...d, dash, offset, pct };
    offset += dash;
    return slice;
  });

  return (
    <svg className="chart" width="100%" height="120" viewBox="0 0 380 120" preserveAspectRatio="none">
      <circle cx={cx} cy={cy} r={R} fill="none" stroke="#1a1a20" strokeWidth="18"/>
      {slices.map((s, i) => (
        <circle key={i} cx={cx} cy={cy} r={R} fill="none"
          stroke={colors[s.provider] ?? '#555560'}
          strokeWidth="18"
          strokeDasharray={`${s.dash} ${circ - s.dash}`}
          strokeDashoffset={-s.offset}
          transform={`rotate(-90 ${cx} ${cy})`}
        />
      ))}
      <text x={cx} y="57" textAnchor="middle" fill="#e8e8ec" fontFamily="Syne,sans-serif" fontSize="13" fontWeight="700">
        {total > 1_000_000 ? `${(total / 1_000_000).toFixed(1)}M` : total}
      </text>
      <text x={cx} y="70" textAnchor="middle" fill="#555560" fontFamily="IBM Plex Mono" fontSize="8">tokens</text>
      {slices.slice(0, 3).map((s, i) => {
        const textX = 135 + (i > 1 ? 95 : 0);
        const textY = i === 2 ? 30 : 30 + (i % 2) * 0 ;
        const rowY = [30, 70, 30];
        const colX = [135, 135, 230];
        return (
          <g key={i}>
            <text x={colX[i]} y={rowY[i]} fill="#9898a8" fontFamily="IBM Plex Mono" fontSize="9">{s.provider}</text>
            <text x={colX[i]} y={rowY[i] + 13} fill={colors[s.provider] ?? '#555560'} fontFamily="Syne,sans-serif" fontSize="14" fontWeight="700">
              {Math.round(s.pct * 100)}%
            </text>
          </g>
        );
      })}
    </svg>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/components/ChartCard.jsx
git commit -m "feat(dashboard): add SVG chart components (line, bar, donut)"
```

---

## Task 11: ForecastPanel component

**Files:**
- Create: `dashboard/src/components/ForecastPanel.jsx`

- [ ] **Step 1: Create ForecastPanel.jsx**

```jsx
import { useForecast } from '../api/hooks';

const DEPT_OPTIONS = [
  { value: '', label: 'All Departments' },
  { value: 'R&D', label: 'R&D' },
  { value: 'Engineering', label: 'Engineering' },
  { value: 'Finance', label: 'Finance' },
];

export default function ForecastPanel({ department, onDeptChange, mini = false }) {
  const { data, loading, error } = useForecast(department);

  return (
    <div className="forecast-panel">
      <div className="forecast-header">
        <div className="forecast-badge">Claude AI Forecast</div>
        {!mini && (
          <select
            className="model-filter"
            style={{ marginLeft: 8 }}
            value={department ?? ''}
            onChange={e => onDeptChange && onDeptChange(e.target.value || null)}
          >
            {DEPT_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        )}
        <span className="forecast-model" style={{ marginLeft: 'auto' }}>
          claude-sonnet-4-6 · {data?.generated_at ? new Date(data.generated_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) + ' UTC' : 'loading…'}
        </span>
      </div>

      {loading && <div className="forecast-text" style={{ color: 'var(--text3)' }}>Generating forecast…</div>}
      {error && <div className="forecast-text" style={{ color: 'var(--red)' }}>Forecast unavailable: {error}</div>}
      {data && !loading && (
        <>
          <div className="forecast-text">{data.narrative}</div>
          <div className="forecast-recs">
            <div className="forecast-rec">
              <div className="rec-label">Projected EOM</div>
              <div className="rec-value">${Number(data.projected_eom ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}</div>
              <div className="rec-sub">end-of-month estimate</div>
            </div>
            <div className="forecast-rec">
              <div className="rec-label">Potential Saving</div>
              <div className="rec-value">${Number(data.potential_saving ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}/mo</div>
              <div className="rec-sub">model switch opportunity</div>
            </div>
            <div className="forecast-rec">
              <div className="rec-label">Risk Teams</div>
              <div className="rec-value">{(data.risk_teams ?? []).length}</div>
              <div className="rec-sub">{(data.risk_teams ?? []).join(', ') || 'none identified'}</div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/components/ForecastPanel.jsx
git commit -m "feat(dashboard): add ForecastPanel component"
```

---

## Task 12: Overview page

**Files:**
- Modify: `dashboard/src/pages/Overview.jsx`

- [ ] **Step 1: Implement Overview.jsx**

```jsx
import { useDashboard, useEvents } from '../api/hooks';
import KpiCard from '../components/KpiCard';
import AnomalyItem from '../components/AnomalyItem';
import ForecastPanel from '../components/ForecastPanel';
import { SpendLineChart, BarChart, DonutChart } from '../components/ChartCard';
import { TEAM_BUDGETS, DEPT_BUDGETS, teamStatus, teamPct } from '../config/budgets';

function fmt(n) { return n == null ? '—' : Number(n).toLocaleString(); }
function fmtUsd(n) { return n == null ? '—' : `$${Number(n).toFixed(2)}`; }
function providerPill(p) {
  const cls = p === 'anthropic' ? 'anthropic' : p === 'openai' ? 'openai' : 'gemini';
  return <span className={`provider-pill ${cls}`}>{p}</span>;
}

export default function Overview({ timeFilter, onNavigate }) {
  const { data, loading } = useDashboard(timeFilter);
  const { data: events } = useEvents(timeFilter, null, 6);

  const totals = data?.totals ?? {};
  const byDay = data?.by_day ?? [];
  const byModel = data?.by_model ?? [];
  const byDept = data?.by_department ?? [];
  const totalSpend = totals.total_cost_usd ?? 0;
  const totalBudget = Object.values(DEPT_BUDGETS).reduce((a, b) => a + b, 0);
  const budgetRemaining = totalBudget - totalSpend;

  const byProvider = byModel.reduce((acc, m) => {
    const p = m.provider ?? 'unknown';
    const existing = acc.find(x => x.provider === p);
    if (existing) { existing.total_tokens += m.total_tokens ?? 0; }
    else acc.push({ provider: p, total_tokens: m.total_tokens ?? 0 });
    return acc;
  }, []);

  return (
    <div className="page active">
      {loading && <div style={{ color: 'var(--text3)', fontSize: 11, marginBottom: 12 }}>Loading…</div>}

      <div className="kpi-row">
        <KpiCard label="MTD Spend" value={fmtUsd(totalSpend)} delta={`${fmt(totals.total_requests)} requests`} variant="highlight" barPct={(totalSpend / totalBudget) * 100} />
        <KpiCard label="Budget Remaining" value={fmtUsd(budgetRemaining)} delta={budgetRemaining < 0 ? 'Over budget' : 'remaining'} deltaType={budgetRemaining < 0 ? 'down' : 'up'} variant={budgetRemaining < 0 ? 'danger' : ''} barPct={100} />
        <KpiCard label="Total Requests" value={fmt(totals.total_requests)} delta={`${fmt(totals.unique_users)} users`} barPct={44} />
        <KpiCard label="Total Tokens" value={totals.total_tokens > 1_000_000 ? `${(totals.total_tokens / 1_000_000).toFixed(1)}M` : fmt(totals.total_tokens)} delta="input + output" barPct={60} />
      </div>

      <div className="section-header">
        <span className="section-title">Spend over time</span>
        <div className="section-line" />
      </div>

      <div className="charts-grid" style={{ marginBottom: 24 }}>
        <div className="chart-card wide">
          <div className="chart-header">
            <div>
              <div className="chart-title">Daily Cost (USD)</div>
              <div className="chart-total">{fmtUsd(totalSpend)}</div>
              <div className="chart-unit">cumulative this period</div>
            </div>
          </div>
          <SpendLineChart byDay={byDay} />
          <div className="legend">
            <div className="legend-item"><div className="legend-dot" style={{ background: '#f0a500' }} />Total spend</div>
            <div className="legend-item" style={{ marginLeft: 8 }}><div className="legend-dot" style={{ background: '#ef4444', borderRadius: 0, height: 1, width: 14, margin: '3px 0' }} />Budget cap</div>
          </div>
        </div>

        <div className="chart-card">
          <div className="chart-header"><div><div className="chart-title">Requests per Model</div><div className="chart-total">{fmt(totals.total_requests)}</div></div></div>
          <BarChart models={byModel} />
        </div>

        <div className="chart-card">
          <div className="chart-header"><div><div className="chart-title">Tokens per Provider</div><div className="chart-total">{totals.total_tokens > 1_000_000 ? `${(totals.total_tokens / 1_000_000).toFixed(1)}M` : fmt(totals.total_tokens)}</div></div></div>
          <DonutChart byProvider={byProvider} />
        </div>
      </div>

      <div className="section-header">
        <span className="section-title">Spend by team</span>
        <div className="section-line" />
      </div>
      <div className="table-card" style={{ marginBottom: 24 }}>
        <table>
          <thead><tr><th>Team</th><th>Department</th><th>Requests</th><th>Tokens</th><th>Spend</th><th>Budget</th><th>Utilisation</th><th>Status</th></tr></thead>
          <tbody>
            {byDept.flatMap(dept =>
              (data?.by_user ?? []).filter(u => u.department === dept.department).map(u => {
                const status = teamStatus(u.cost_usd, u.team_id);
                const pct = teamPct(u.cost_usd, u.team_id);
                const budget = TEAM_BUDGETS[u.team_id] ?? 0;
                return (
                  <tr key={u.user_id + u.team_id}>
                    <td>{u.team_id ?? u.user_id}</td>
                    <td>{u.department}</td>
                    <td>{fmt(u.requests)}</td>
                    <td>{u.total_tokens > 1_000_000 ? `${(u.total_tokens / 1_000_000).toFixed(1)}M` : fmt(u.total_tokens)}</td>
                    <td>{fmtUsd(u.cost_usd)}</td>
                    <td>{fmtUsd(budget)}</td>
                    <td>
                      <div className="budget-bar-wrap">
                        <div className="budget-bar-bg"><div className={`budget-bar-fg${status === 'over' ? ' over' : status === 'warn' ? ' warn' : ''}`} style={{ width: `${pct}%` }} /></div>
                        {pct}%
                      </div>
                    </td>
                    <td><span className={`status-pill ${status === 'over' ? 'over' : status === 'warn' ? 'warn' : 'ok'}`}>{status === 'over' ? 'Over budget' : status === 'warn' ? 'Watch' : 'On track'}</span></td>
                  </tr>
                );
              })
            )}
            {!data && <tr><td colSpan="8" style={{ color: 'var(--text3)', textAlign: 'center' }}>No data</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="section-header" style={{ marginTop: 8 }}>
        <span className="section-title">AI Forecast</span>
        <div className="section-line" />
        <span className="section-sub" style={{ cursor: 'pointer', color: 'var(--amber)' }} onClick={() => onNavigate('forecast')}>View full forecast →</span>
      </div>
      <div style={{ marginBottom: 24 }}><ForecastPanel mini /></div>

      <div className="section-header">
        <span className="section-title">Recent events</span>
        <div className="section-line" />
        <span className="section-sub" style={{ cursor: 'pointer', color: 'var(--amber)' }} onClick={() => onNavigate('logs')}>View token logs →</span>
      </div>
      <div className="table-card" style={{ marginBottom: 8 }}>
        <table>
          <thead><tr><th>Time</th><th>User</th><th>Provider</th><th>Model</th><th>In Tokens</th><th>Out Tokens</th><th>Cost</th><th>Status</th></tr></thead>
          <tbody>
            {(events ?? []).map(e => (
              <tr key={e.id}>
                <td style={{ color: 'var(--text3)' }}>{e.ts?.slice(11, 19)}</td>
                <td>{e.user_id}</td>
                <td>{providerPill(e.provider)}</td>
                <td>{e.model}</td>
                <td>{fmt(e.prompt_tokens)}</td>
                <td>{fmt(e.completion_tokens)}</td>
                <td>{fmtUsd(e.cost_usd)}</td>
                <td><span className={`status-pill ${e.status === 200 ? 'ok' : 'over'}`}>{e.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify Overview page renders with data**

Ensure the backend is running (`docker compose up` or `uvicorn main:app` in `backend/`). Reload `http://localhost:5173`. Expected: KPI cards show real numbers, spend chart renders, team table populates, forecast panel shows "Generating forecast…" then real Claude text.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/pages/Overview.jsx
git commit -m "feat(dashboard): implement Overview page with live data"
```

---

## Task 13: Cost & Usage page

**Files:**
- Modify: `dashboard/src/pages/CostUsage.jsx`

- [ ] **Step 1: Implement CostUsage.jsx**

```jsx
import { useDashboard, useEvents } from '../api/hooks';
import KpiCard from '../components/KpiCard';

function fmt(n) { return n == null ? '—' : Number(n).toLocaleString(); }
function fmtUsd(n) { return n == null ? '—' : `$${Number(n).toFixed(2)}`; }
function providerPill(p) {
  const cls = p === 'anthropic' ? 'anthropic' : p === 'openai' ? 'openai' : 'gemini';
  return <span className={`provider-pill ${cls}`}>{p}</span>;
}

export default function CostUsage({ timeFilter }) {
  const { data } = useDashboard(timeFilter);
  const { data: events } = useEvents(timeFilter, null, 50);
  const totals = data?.totals ?? {};
  const byUser = data?.by_user ?? [];
  const blocked = (events ?? []).filter(e => e.status !== 200).length;
  const avgCost = totals.total_requests > 0 ? totals.total_cost_usd / totals.total_requests : 0;

  return (
    <div className="page active">
      <div className="kpi-row">
        <KpiCard label="Total Cost" value={fmtUsd(totals.total_cost_usd)} delta="this period" variant="highlight" barPct={80} />
        <KpiCard label="Avg Cost / Request" value={`$${avgCost.toFixed(4)}`} delta="per request" barPct={40} />
        <KpiCard label="Output Tokens" value={totals.total_completion_tokens > 1_000_000 ? `${(totals.total_completion_tokens / 1_000_000).toFixed(1)}M` : fmt(totals.total_completion_tokens)} delta="completion tokens" barPct={55} />
        <KpiCard label="Blocked Requests" value={fmt(blocked)} delta="non-200 status" barPct={20} />
      </div>

      <div className="section-header">
        <span className="section-title">Cost by user</span>
        <div className="section-line" />
      </div>
      <div className="table-card">
        <table>
          <thead><tr><th>User ID</th><th>Team</th><th>Department</th><th>Requests</th><th>Input Tokens</th><th>Output Tokens</th><th>Total Cost</th></tr></thead>
          <tbody>
            {byUser.map(u => (
              <tr key={u.user_id}>
                <td>{u.user_id}</td>
                <td>{u.team_id}</td>
                <td>{u.department}</td>
                <td>{fmt(u.requests)}</td>
                <td>{fmt(u.prompt_tokens)}</td>
                <td>{fmt(u.completion_tokens)}</td>
                <td style={{ color: 'var(--amber)' }}>{fmtUsd(u.cost_usd)}</td>
              </tr>
            ))}
            {byUser.length === 0 && <tr><td colSpan="7" style={{ color: 'var(--text3)', textAlign: 'center' }}>No data</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/pages/CostUsage.jsx
git commit -m "feat(dashboard): implement Cost & Usage page"
```

---

## Task 14: Token Logs page

**Files:**
- Modify: `dashboard/src/pages/TokenLogs.jsx`

- [ ] **Step 1: Implement TokenLogs.jsx**

```jsx
import { useState } from 'react';
import { useEvents } from '../api/hooks';

function fmt(n) { return n == null ? '—' : Number(n).toLocaleString(); }
function fmtUsd(n) { return n == null ? '—' : `$${Number(n).toFixed(4)}`; }
function providerPill(p) {
  const cls = p === 'anthropic' ? 'anthropic' : p === 'openai' ? 'openai' : 'gemini';
  return <span className={`provider-pill ${cls}`}>{p}</span>;
}

export default function TokenLogs({ timeFilter }) {
  const [providerFilter, setProviderFilter] = useState('');
  const [search, setSearch] = useState('');
  const { data: events, loading } = useEvents(timeFilter, providerFilter || null, 100);

  const filtered = (events ?? []).filter(e =>
    !search || (e.user_id ?? '').includes(search) || (e.session_id ?? '').includes(search)
  );

  return (
    <div className="page active">
      <div className="section-header">
        <span className="section-title">Token Logs</span>
        <div className="section-line" />
        <input
          className="table-search"
          placeholder="Filter by user, session..."
          style={{ maxWidth: 200 }}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select
          className="model-filter"
          value={providerFilter}
          onChange={e => setProviderFilter(e.target.value)}
        >
          <option value="">All Providers</option>
          <option value="openai">OpenAI</option>
          <option value="anthropic">Anthropic</option>
          <option value="google">Gemini</option>
        </select>
      </div>
      <div className="table-card">
        <table>
          <thead>
            <tr><th>Timestamp</th><th>User</th><th>Provider</th><th>Model</th><th>In Tokens</th><th>Out Tokens</th><th>Cost</th><th>Session ID</th></tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan="8" style={{ color: 'var(--text3)', textAlign: 'center' }}>Loading…</td></tr>}
            {filtered.map(e => (
              <tr key={e.id}>
                <td style={{ color: 'var(--text3)' }}>{e.ts?.slice(0, 19)}</td>
                <td>{e.user_id}</td>
                <td>{providerPill(e.provider)}</td>
                <td>{e.model}</td>
                <td>{fmt(e.prompt_tokens)}</td>
                <td>{fmt(e.completion_tokens)}</td>
                <td>{fmtUsd(e.cost_usd)}</td>
                <td style={{ color: 'var(--text3)' }}>{e.session_id ? `${e.session_id.slice(0, 4)}…${e.session_id.slice(-4)}` : '—'}</td>
              </tr>
            ))}
            {!loading && filtered.length === 0 && <tr><td colSpan="8" style={{ color: 'var(--text3)', textAlign: 'center' }}>No events</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/pages/TokenLogs.jsx
git commit -m "feat(dashboard): implement Token Logs page with provider + search filter"
```

---

## Task 15: Chargeback page

**Files:**
- Modify: `dashboard/src/pages/Chargeback.jsx`

- [ ] **Step 1: Implement Chargeback.jsx**

```jsx
import { useDeptCost } from '../api/hooks';
import { DEPT_BUDGETS } from '../config/budgets';

function fmtUsd(n) { return n == null ? '—' : `$${Number(n).toFixed(2)}`; }
function fmt(n) { return n == null ? '—' : Number(n).toLocaleString(); }

export default function Chargeback({ timeFilter }) {
  const { data: depts } = useDeptCost(timeFilter);
  const rows = depts ?? [];
  const totalSpend = rows.reduce((s, d) => s + (d.total_cost_usd ?? 0), 0);
  const totalBudget = Object.values(DEPT_BUDGETS).reduce((a, b) => a + b, 0);

  function chargeCode(dept) {
    const now = new Date();
    const tag = dept.replace(/[^A-Z]/g, '').slice(0, 3).toUpperCase();
    return `CC-${tag}-${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  return (
    <div className="page active">
      <div className="section-header">
        <span className="section-title">Chargeback Report — {new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>
        <div className="section-line" />
        <button className="export-btn">↓ Export CSV</button>
      </div>
      <div className="table-card">
        <table>
          <thead>
            <tr><th>Department</th><th>Requests</th><th>Tokens</th><th>Gross Cost</th><th>Budget</th><th>Variance</th><th>Charge Code</th></tr>
          </thead>
          <tbody>
            {rows.map(d => {
              const budget = DEPT_BUDGETS[d.department] ?? 0;
              const variance = budget - (d.total_cost_usd ?? 0);
              return (
                <tr key={d.department}>
                  <td>{d.department}</td>
                  <td>{fmt(d.requests)}</td>
                  <td>{d.total_tokens > 1_000_000 ? `${(d.total_tokens / 1_000_000).toFixed(1)}M` : fmt(d.total_tokens)}</td>
                  <td style={{ color: 'var(--text)' }}>{fmtUsd(d.total_cost_usd)}</td>
                  <td>{fmtUsd(budget)}</td>
                  <td style={{ color: variance < 0 ? 'var(--red)' : variance < budget * 0.2 ? 'var(--amber)' : 'var(--green)' }}>
                    {variance >= 0 ? '−' : '+'}{fmtUsd(Math.abs(variance))}
                  </td>
                  <td style={{ color: 'var(--text3)' }}>{chargeCode(d.department ?? '')}</td>
                </tr>
              );
            })}
            {rows.length > 0 && (
              <tr style={{ background: 'var(--bg2)' }}>
                <td style={{ color: 'var(--amber)', fontWeight: 600 }}>TOTAL</td>
                <td>{fmt(rows.reduce((s, d) => s + (d.requests ?? 0), 0))}</td>
                <td>{(() => { const t = rows.reduce((s, d) => s + (d.total_tokens ?? 0), 0); return t > 1_000_000 ? `${(t / 1_000_000).toFixed(1)}M` : fmt(t); })()}</td>
                <td style={{ color: 'var(--amber)', fontWeight: 600 }}>{fmtUsd(totalSpend)}</td>
                <td>{fmtUsd(totalBudget)}</td>
                <td style={{ color: totalBudget - totalSpend < 0 ? 'var(--red)' : 'var(--amber)' }}>{fmtUsd(totalBudget - totalSpend)}</td>
                <td>—</td>
              </tr>
            )}
            {rows.length === 0 && <tr><td colSpan="7" style={{ color: 'var(--text3)', textAlign: 'center' }}>No data</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/pages/Chargeback.jsx
git commit -m "feat(dashboard): implement Chargeback page"
```

---

## Task 16: Anomalies page

**Files:**
- Modify: `dashboard/src/pages/Anomalies.jsx`

- [ ] **Step 1: Implement Anomalies.jsx with client-side detection**

```jsx
import { useDashboard, useEvents } from '../api/hooks';
import KpiCard from '../components/KpiCard';
import AnomalyItem from '../components/AnomalyItem';
import { TEAM_BUDGETS } from '../config/budgets';

function fmt(n) { return n == null ? '—' : Number(n).toLocaleString(); }

function detectAnomalies(byDay, byUser, events) {
  const anomalies = [];

  // Spike detection: any day > 3x 7-day rolling average
  if (byDay && byDay.length >= 2) {
    const sorted = [...byDay].sort((a, b) => a.session_date.localeCompare(b.session_date));
    sorted.forEach((day, i) => {
      if (i < 2) return;
      const window = sorted.slice(Math.max(0, i - 7), i);
      const avg = window.reduce((s, d) => s + (d.cost_usd ?? 0), 0) / window.length;
      if (avg > 0 && (day.cost_usd ?? 0) > avg * 3) {
        anomalies.push({ severity: 'CRITICAL', team: day.session_date, message: `Spend spike — $${Number(day.cost_usd).toFixed(2)} (${Math.round(day.cost_usd / avg)}× average of $${avg.toFixed(2)})`, time: day.session_date });
      }
    });
  }

  // Budget breach
  if (byUser) {
    byUser.forEach(u => {
      const budget = TEAM_BUDGETS[u.team_id];
      if (!budget) return;
      const pct = (u.cost_usd ?? 0) / budget;
      if (pct >= 1) {
        anomalies.push({ severity: 'CRITICAL', team: u.team_id, message: `Budget cap exceeded. Spend: $${Number(u.cost_usd).toFixed(2)} vs $${budget} budget (${Math.round(pct * 100)}%).`, time: 'this period' });
      } else if (pct >= 0.75) {
        anomalies.push({ severity: 'WARN', team: u.team_id, message: `At ${Math.round(pct * 100)}% of $${budget} budget. Projected to exceed if current rate continues.`, time: 'this period' });
      }
    });
  }

  // Blocked requests
  if (events) {
    const blocked = events.filter(e => e.status !== 200);
    if (blocked.length > 0) {
      anomalies.push({ severity: 'INFO', team: `${blocked.length} blocked requests`, message: `Non-200 status codes detected in this period.`, time: 'this period' });
    }
  }

  return anomalies;
}

export default function Anomalies({ timeFilter }) {
  const { data } = useDashboard(timeFilter);
  const { data: events } = useEvents(timeFilter, null, 200);

  const byDay = data?.by_day ?? [];
  const byUser = data?.by_user ?? [];
  const anomalies = detectAnomalies(byDay, byUser, events);
  const criticals = anomalies.filter(a => a.severity === 'CRITICAL');
  const blocked = (events ?? []).filter(e => e.status !== 200).length;

  return (
    <div className="page active">
      <div className="kpi-row">
        <KpiCard label="Active Anomalies" value={anomalies.length} delta={`${criticals.length} critical`} variant={criticals.length > 0 ? 'danger' : ''} barPct={100} />
        <KpiCard label="Blocked Requests" value={fmt(blocked)} delta="non-200 in period" barPct={20} />
        <KpiCard label="Teams Over Budget" value={byUser.filter(u => TEAM_BUDGETS[u.team_id] && u.cost_usd >= TEAM_BUDGETS[u.team_id]).length} delta="hard cap breached" barPct={50} />
        <KpiCard label="Spike Threshold" value="3×" delta="rolling avg trigger" barPct={30} />
      </div>

      <div className="section-header">
        <span className="section-title">Anomaly feed</span>
        <div className="section-line" />
      </div>

      <div className="anomaly-strip">
        {anomalies.map((a, i) => (
          <AnomalyItem key={i} severity={a.severity} team={a.team} message={a.message} time={a.time} />
        ))}
        {anomalies.length === 0 && (
          <div style={{ color: 'var(--text3)', fontSize: 12, padding: '20px 0' }}>No anomalies detected for this period.</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/pages/Anomalies.jsx
git commit -m "feat(dashboard): implement Anomalies page with client-side detection"
```

---

## Task 17: Forecast page

**Files:**
- Modify: `dashboard/src/pages/Forecast.jsx`

- [ ] **Step 1: Implement Forecast.jsx**

```jsx
import { useState } from 'react';
import ForecastPanel from '../components/ForecastPanel';
import { useDashboard } from '../api/hooks';
import { SpendLineChart } from '../components/ChartCard';

function fmtUsd(n) { return n == null ? '—' : `$${Number(n).toFixed(2)}`; }

export default function Forecast({ timeFilter }) {
  const [department, setDepartment] = useState(null);
  const { data } = useDashboard(timeFilter, department);
  const byDay = data?.by_day ?? [];

  return (
    <div className="page active">
      <ForecastPanel department={department} onDeptChange={setDepartment} />

      <div className="section-header" style={{ marginTop: 24 }}>
        <span className="section-title">Spend trajectory</span>
        <div className="section-line" />
      </div>

      <div className="charts-grid">
        <div className="chart-card wide">
          <div className="chart-header">
            <div>
              <div className="chart-title">Actual Spend (USD) — {department ?? 'All Departments'}</div>
              <div className="chart-total">{fmtUsd(byDay.reduce((s, d) => s + (d.cost_usd ?? 0), 0))}</div>
              <div className="chart-unit">this period</div>
            </div>
          </div>
          <SpendLineChart byDay={byDay} />
          <div className="legend">
            <div style={{ display: 'flex', gap: 14 }}>
              <div className="legend-item"><div className="legend-dot" style={{ background: '#f0a500' }} />Actual</div>
              <div className="legend-item"><div className="legend-dot" style={{ background: '#ef4444', borderRadius: 0, height: 1, width: 14, margin: '3px 0' }} />Budget cap</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/pages/Forecast.jsx
git commit -m "feat(dashboard): implement Forecast page with department filter"
```

---

## Task 18: Governance + Teams pages

**Files:**
- Modify: `dashboard/src/pages/Governance.jsx`
- Modify: `dashboard/src/pages/Teams.jsx`

- [ ] **Step 1: Implement Governance.jsx**

```jsx
export default function Governance({ currentRole }) {
  if (currentRole !== 'admin') {
    return (
      <div className="page active">
        <div className="locked-page"><div className="locked-icon">🔒</div><div className="locked-msg">Governance requires Admin role</div></div>
      </div>
    );
  }
  return (
    <div className="page active">
      <div className="kpi-row">
        <div className="kpi-card"><div className="kpi-label">Active Consumers</div><div className="kpi-value">4</div><div className="kpi-delta">Teams in Kong</div></div>
        <div className="kpi-card"><div className="kpi-label">Rate Limit Policy</div><div className="kpi-value">500k</div><div className="kpi-delta">tokens/hour per route</div></div>
        <div className="kpi-card"><div className="kpi-label">PII Guard Rules</div><div className="kpi-value">3</div><div className="kpi-delta">SSN, card, credential</div></div>
        <div className="kpi-card highlight"><div className="kpi-label">OIDC Provider</div><div className="kpi-value">Mock</div><div className="kpi-delta">mock-oauth2 :8080</div></div>
      </div>
      <div className="section-header"><span className="section-title">RBAC Matrix</span><div className="section-line" /></div>
      <div className="table-card">
        <table>
          <thead><tr><th>Permission</th><th>FinOps</th><th>Engineering</th><th>Admin</th></tr></thead>
          <tbody>
            {[
              ['View Overview',   true,  true,  true],
              ['View Chargeback', true,  false, true],
              ['Export Reports',  true,  false, true],
              ['View Token Logs', false, true,  true],
              ['View Anomalies',  false, true,  true],
              ['Manage Budgets',  false, false, true],
              ['Configure RBAC',  false, false, true],
            ].map(([perm, fo, eng, adm]) => (
              <tr key={perm}>
                <td>{perm}</td>
                <td style={{ color: fo ? 'var(--green)' : 'var(--text3)' }}>{fo ? '✓' : '—'}</td>
                <td style={{ color: eng ? 'var(--green)' : 'var(--text3)' }}>{eng ? '✓' : '—'}</td>
                <td style={{ color: adm ? 'var(--green)' : 'var(--text3)' }}>{adm ? '✓' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Implement Teams.jsx**

```jsx
import { TEAM_BUDGETS } from '../config/budgets';

export default function Teams({ currentRole }) {
  if (currentRole !== 'admin') {
    return (
      <div className="page active">
        <div className="locked-page"><div className="locked-icon">🔒</div><div className="locked-msg">Teams &amp; Budgets requires Admin role</div></div>
      </div>
    );
  }

  const teams = [
    { team: 'nlp-platform', dept: 'R&D', enforcement: 'Hard cap (429)', alert: '80%', consumer: 'consumer-nlp' },
    { team: 'data-science',  dept: 'R&D', enforcement: 'Soft warn',    alert: '80%', consumer: 'consumer-ds' },
    { team: 'platform',      dept: 'Engineering', enforcement: 'Soft warn', alert: '90%', consumer: 'consumer-eng' },
    { team: 'finance',       dept: 'Finance', enforcement: 'Soft warn', alert: '80%', consumer: 'consumer-fin' },
  ];

  return (
    <div className="page active">
      <div className="section-header"><span className="section-title">Budget Configuration</span><div className="section-line" /></div>
      <div className="table-card">
        <table>
          <thead><tr><th>Team</th><th>Department</th><th>Monthly Budget</th><th>Enforcement</th><th>Alert Threshold</th><th>Kong Consumer</th></tr></thead>
          <tbody>
            {teams.map(t => (
              <tr key={t.team}>
                <td>{t.team}</td>
                <td>{t.dept}</td>
                <td style={{ color: 'var(--amber)' }}>${TEAM_BUDGETS[t.team].toLocaleString()}</td>
                <td><span className={`status-pill ${t.enforcement.includes('Hard') ? 'over' : 'ok'}`}>{t.enforcement}</span></td>
                <td>{t.alert}</td>
                <td style={{ color: 'var(--text3)' }}>{t.consumer}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/pages/Governance.jsx dashboard/src/pages/Teams.jsx
git commit -m "feat(dashboard): implement Governance and Teams pages"
```

---

## Task 19: Smoke test all pages + final commit

- [ ] **Step 1: Ensure the backend is running**

```bash
cd backend && uvicorn main:app --reload --port 8002
```

Or if using Docker: `docker compose up`.

Expected: `Application startup complete` in logs.

- [ ] **Step 2: Start the SPA dev server**

```bash
cd dashboard && npm run dev
```

Expected: `Local: http://localhost:5173/`

- [ ] **Step 3: Test each page as each role**

Open `http://localhost:5173` and run through this checklist:

**As FinOps (default):**
- [ ] Overview: KPI cards show numbers (not `—`), chart renders, team table has rows
- [ ] Cost & Usage: user table populates
- [ ] Chargeback: department rows + total row visible
- [ ] AI Forecast: panel loads with Claude narrative, department filter changes content
- [ ] Anomalies nav item: appears locked (greyed)
- [ ] Token Logs nav item: appears locked

**Switch to Engineering:**
- [ ] Anomalies: feed shows detected anomalies (or "No anomalies" if data is clean)
- [ ] Token Logs: table loads, provider filter works, search filters by user
- [ ] Chargeback nav item: appears locked
- [ ] Governance nav item: appears locked

**Switch to Admin:**
- [ ] All 8 nav items accessible
- [ ] Governance: RBAC matrix visible
- [ ] Teams & Budgets: budget table shows real constants

- [ ] **Step 4: Verify no console errors**

Open browser DevTools → Console. Expected: no red errors. Network tab shows `200` for all `/api/` calls.

- [ ] **Step 5: Final commit**

```bash
git add .
git commit -m "feat(dashboard): complete AIRA React SPA — all pages live"
```

---

## Self-Review Checklist

- [x] **dashboard-mock.html fix** — Task 1 covers department filter + JS swap + static per-dept data
- [x] **CORS** — Task 2 adds middleware before any SPA calls can reach the backend
- [x] **`/forecast` endpoint** — Task 3: TDD with 3 tests covering shape, dept filter, no-data
- [x] **Vite scaffold** — Task 4: package.json, vite.config.js, index.html
- [x] **styles.css** — Task 5: verbatim copy from mock
- [x] **Budgets config** — Task 6: `TEAM_BUDGETS`, `DEPT_BUDGETS`, helper functions
- [x] **API layer** — Task 6: `apiFetch`, `sinceFromFilter`, all 5 hooks
- [x] **App.jsx routing** — Task 7: role/page/timeFilter state, page stubs to unblock compilation
- [x] **Sidebar** — Task 8: nav items, icons, locked state, role switcher
- [x] **Topbar + KpiCard + AnomalyItem** — Task 9
- [x] **ChartCard (line, bar, donut)** — Task 10
- [x] **ForecastPanel with dept filter** — Task 11
- [x] **Overview** — Task 12: all sections, live data
- [x] **Cost & Usage** — Task 13
- [x] **Token Logs** — Task 14: provider filter + search
- [x] **Chargeback** — Task 15: dept rows, variance, charge codes
- [x] **Anomalies** — Task 16: spike detection, budget breach, blocked requests
- [x] **Forecast** — Task 17: dept filter wired to ForecastPanel + chart
- [x] **Governance + Teams** — Task 18: role-gated, RBAC matrix, budget table
- [x] **Smoke test** — Task 19: per-role checklist
