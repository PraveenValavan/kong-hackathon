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
