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
          claude-sonnet-4-6 ·{' '}
          {data?.generated_at
            ? new Date(data.generated_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) + ' UTC'
            : 'loading…'}
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
