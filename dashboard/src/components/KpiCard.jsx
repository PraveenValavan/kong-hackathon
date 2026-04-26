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
