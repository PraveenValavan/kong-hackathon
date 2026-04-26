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
