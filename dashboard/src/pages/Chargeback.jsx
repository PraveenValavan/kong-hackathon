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
