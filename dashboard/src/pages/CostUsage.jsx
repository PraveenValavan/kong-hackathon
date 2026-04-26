import { useDashboard, useEvents } from '../api/hooks';
import KpiCard from '../components/KpiCard';

function fmt(n) { return n == null ? '—' : Number(n).toLocaleString(); }
function fmtUsd(n) { return n == null ? '—' : `$${Number(n).toFixed(2)}`; }

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
