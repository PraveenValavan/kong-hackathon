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
