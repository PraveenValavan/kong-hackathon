import { useTeamConfigs, useModels } from '../api/hooks';

const RBAC = [
  ['View Overview',   true,  true,  true],
  ['View Chargeback', true,  false, true],
  ['Export Reports',  true,  false, true],
  ['View Token Logs', false, true,  true],
  ['View Anomalies',  false, true,  true],
  ['Manage Budgets',  false, false, true],
  ['Configure RBAC',  false, false, true],
];

const KONG_POLICIES = {
  oidc_provider: 'mock-oauth2:8080',
  rate_limit_window: '3600s (per consumer)',
  pii_rules: [
    { name: 'SSN', pattern: '\\b\\d{3}-\\d{2}-\\d{4}\\b' },
    { name: 'Credit Card', pattern: '\\b\\d{16}\\b' },
    { name: 'Credentials', pattern: '(?i)(password|secret|api[_-]?key)\\s*[:=]\\s*\\S+' },
  ],
  balancer: 'round-robin (haiku 2x weight, sonnet 1x)',
};

function modelShortName(id) {
  const map = {
    'claude-haiku-4-5-20251001': 'Haiku',
    'claude-sonnet-4-6': 'Sonnet',
    'claude-opus-4-7': 'Opus',
    'gpt-4o': 'GPT-4o',
    'gemini-2.5-flash': 'Gemini Flash',
  };
  return map[id] ?? id;
}

export default function Governance({ currentRole }) {
  if (currentRole !== 'admin') {
    return (
      <div className="page active">
        <div className="locked-page"><div className="locked-icon">🔒</div><div className="locked-msg">Governance requires Admin role</div></div>
      </div>
    );
  }

  const { data: teams, loading: teamsLoading } = useTeamConfigs();
  const { data: models, loading: modelsLoading } = useModels();

  const allModelIds = models ? models.map(m => m.model_id) : [];

  return (
    <div className="page active">
      <div className="kpi-row">
        <div className="kpi-card"><div className="kpi-label">Active Consumers</div><div className="kpi-value">{teams ? teams.length : '—'}</div><div className="kpi-delta">Teams in Kong</div></div>
        <div className="kpi-card"><div className="kpi-label">Rate Limit Policy</div><div className="kpi-value">Token-based</div><div className="kpi-delta">Per-consumer, per route</div></div>
        <div className="kpi-card"><div className="kpi-label">PII Guard Rules</div><div className="kpi-value">{KONG_POLICIES.pii_rules.length}</div><div className="kpi-delta">SSN, card, credential</div></div>
        <div className="kpi-card highlight"><div className="kpi-label">OIDC Provider</div><div className="kpi-value">Mock</div><div className="kpi-delta">{KONG_POLICIES.oidc_provider}</div></div>
      </div>

      {/* Model Availability Matrix */}
      <div className="section-header"><span className="section-title">Model Availability by Team</span><div className="section-line" /></div>
      <div className="table-card">
        {teamsLoading || modelsLoading ? (
          <div style={{ color: 'var(--text3)', padding: '1rem' }}>Loading…</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Team</th>
                <th>Dept</th>
                {allModelIds.map(mid => <th key={mid}>{modelShortName(mid)}</th>)}
                <th>Rate Limit / hr</th>
              </tr>
            </thead>
            <tbody>
              {teams.map(t => (
                <tr key={t.team_id}>
                  <td><strong>{t.team_id}</strong></td>
                  <td style={{ color: 'var(--text3)' }}>{t.department}</td>
                  {allModelIds.map(mid => (
                    <td key={mid} style={{ textAlign: 'center', color: t.allowed_models.includes(mid) ? 'var(--green)' : 'var(--text3)' }}>
                      {t.allowed_models.includes(mid) ? '✓' : '—'}
                    </td>
                  ))}
                  <td style={{ color: 'var(--amber)' }}>{(t.rate_limit_tokens / 1000).toFixed(0)}k tokens</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Model Catalog with Costs */}
      <div className="section-header"><span className="section-title">Model Catalog &amp; Pricing</span><div className="section-line" /></div>
      <div className="table-card">
        {modelsLoading ? (
          <div style={{ color: 'var(--text3)', padding: '1rem' }}>Loading…</div>
        ) : (
          <table>
            <thead>
              <tr><th>Model</th><th>Provider</th><th>Input (per 1M tokens)</th><th>Output (per 1M tokens)</th></tr>
            </thead>
            <tbody>
              {(models ?? []).map(m => (
                <tr key={m.model_id}>
                  <td><strong>{m.model_id}</strong></td>
                  <td style={{ color: 'var(--text3)', textTransform: 'capitalize' }}>{m.provider}</td>
                  <td style={{ color: 'var(--green)' }}>${m.input_cost_per_1m.toFixed(3)}</td>
                  <td style={{ color: 'var(--amber)' }}>${m.output_cost_per_1m.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Kong Policies */}
      <div className="section-header"><span className="section-title">Kong Gateway Policies</span><div className="section-line" /></div>
      <div className="kpi-row" style={{ marginBottom: '1.5rem' }}>
        <div className="kpi-card"><div className="kpi-label">Load Balancer</div><div className="kpi-value" style={{ fontSize: '0.9rem' }}>Round-robin</div><div className="kpi-delta">Haiku ×2, Sonnet ×1 weight</div></div>
        <div className="kpi-card"><div className="kpi-label">Rate Limit Window</div><div className="kpi-value">1 hr</div><div className="kpi-delta">Token bucket per consumer</div></div>
        <div className="kpi-card"><div className="kpi-label">Auth Method</div><div className="kpi-value">OIDC</div><div className="kpi-delta">Bearer token via JWKS</div></div>
      </div>
      <div className="table-card">
        <table>
          <thead><tr><th>PII Rule</th><th>Pattern</th><th>Action</th></tr></thead>
          <tbody>
            {KONG_POLICIES.pii_rules.map(r => (
              <tr key={r.name}>
                <td><strong>{r.name}</strong></td>
                <td style={{ fontFamily: 'monospace', color: 'var(--text3)', fontSize: '0.8rem' }}>{r.pattern}</td>
                <td><span className="status-pill over">Block (400)</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* RBAC Matrix */}
      <div className="section-header"><span className="section-title">RBAC Matrix</span><div className="section-line" /></div>
      <div className="table-card">
        <table>
          <thead><tr><th>Permission</th><th>FinOps</th><th>Engineering</th><th>Admin</th></tr></thead>
          <tbody>
            {RBAC.map(([perm, fo, eng, adm]) => (
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
