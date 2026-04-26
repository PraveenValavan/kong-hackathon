import { useDashboard, useEvents } from '../api/hooks';
import KpiCard from '../components/KpiCard';
import AnomalyItem from '../components/AnomalyItem';
import { TEAM_BUDGETS } from '../config/budgets';

function fmt(n) { return n == null ? '—' : Number(n).toLocaleString(); }

function detectAnomalies(byDay, byUser, events) {
  const anomalies = [];

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
