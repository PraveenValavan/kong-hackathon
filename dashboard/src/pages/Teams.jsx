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
