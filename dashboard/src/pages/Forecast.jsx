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
