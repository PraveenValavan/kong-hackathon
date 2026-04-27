import { useState } from 'react';
import { useTeamConfigs, useModels } from '../api/hooks';

const ALL_MODELS = [
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-6',
  'claude-opus-4-7',
  'gpt-4o',
  'gemini-2.5-flash',
];

function modelLabel(id) {
  const map = {
    'claude-haiku-4-5-20251001': 'Haiku',
    'claude-sonnet-4-6': 'Sonnet',
    'claude-opus-4-7': 'Opus',
    'gpt-4o': 'GPT-4o',
    'gemini-2.5-flash': 'Gemini Flash',
  };
  return map[id] ?? id;
}

function EditRow({ team, onSave, onCancel }) {
  const [draft, setDraft] = useState({
    budget_usd: team.budget_usd,
    enforcement: team.enforcement,
    alert_threshold: team.alert_threshold,
    rate_limit_tokens: team.rate_limit_tokens,
    allowed_models: [...team.allowed_models],
  });
  const [saving, setSaving] = useState(false);

  function toggleModel(mid) {
    setDraft(d => ({
      ...d,
      allowed_models: d.allowed_models.includes(mid)
        ? d.allowed_models.filter(m => m !== mid)
        : [...d.allowed_models, mid],
    }));
  }

  async function handleSave() {
    setSaving(true);
    try { await onSave(draft); } finally { setSaving(false); }
  }

  return (
    <tr className="editing-row">
      <td><strong>{team.team_id}</strong></td>
      <td>{team.department}</td>
      <td>
        <input
          type="number"
          className="inline-input"
          value={draft.budget_usd}
          min={0}
          step={100}
          onChange={e => setDraft(d => ({ ...d, budget_usd: parseFloat(e.target.value) || 0 }))}
        />
      </td>
      <td>
        <select
          className="inline-select"
          value={draft.enforcement}
          onChange={e => setDraft(d => ({ ...d, enforcement: e.target.value }))}
        >
          <option value="hard">Hard cap (429)</option>
          <option value="soft">Soft warn</option>
        </select>
      </td>
      <td>
        <input
          type="number"
          className="inline-input"
          value={draft.alert_threshold}
          min={50}
          max={100}
          step={5}
          onChange={e => setDraft(d => ({ ...d, alert_threshold: parseInt(e.target.value) || 80 }))}
        />%
      </td>
      <td>
        <input
          type="number"
          className="inline-input"
          value={draft.rate_limit_tokens}
          min={10000}
          step={50000}
          onChange={e => setDraft(d => ({ ...d, rate_limit_tokens: parseInt(e.target.value) || 500000 }))}
        />
      </td>
      <td>
        <div className="model-checkboxes">
          {ALL_MODELS.map(mid => (
            <label key={mid} className="model-check-label">
              <input
                type="checkbox"
                checked={draft.allowed_models.includes(mid)}
                onChange={() => toggleModel(mid)}
              />
              {modelLabel(mid)}
            </label>
          ))}
        </div>
      </td>
      <td>
        <button className="btn-save" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button className="btn-cancel" onClick={onCancel} disabled={saving}>Cancel</button>
      </td>
    </tr>
  );
}

function ViewRow({ team, onEdit }) {
  const pctOfBudget = team.budget_usd > 0 ? Math.round((team.budget_usd / team.budget_usd) * 100) : 0;
  return (
    <tr>
      <td><strong>{team.team_id}</strong></td>
      <td>{team.department}</td>
      <td style={{ color: 'var(--amber)' }}>${team.budget_usd.toLocaleString()}</td>
      <td>
        <span className={`status-pill ${team.enforcement === 'hard' ? 'over' : 'ok'}`}>
          {team.enforcement === 'hard' ? 'Hard cap (429)' : 'Soft warn'}
        </span>
      </td>
      <td>{team.alert_threshold}%</td>
      <td style={{ color: 'var(--text3)' }}>{(team.rate_limit_tokens / 1000).toFixed(0)}k/hr</td>
      <td>
        <div className="model-tags">
          {team.allowed_models.map(m => (
            <span key={m} className="model-tag">{modelLabel(m)}</span>
          ))}
        </div>
      </td>
      <td>
        <button className="btn-edit" onClick={onEdit}>Edit</button>
      </td>
    </tr>
  );
}

export default function Teams({ currentRole }) {
  if (currentRole !== 'admin') {
    return (
      <div className="page active">
        <div className="locked-page"><div className="locked-icon">🔒</div><div className="locked-msg">Teams &amp; Budgets requires Admin role</div></div>
      </div>
    );
  }

  const { data: teams, loading, error, save } = useTeamConfigs();
  const [editingId, setEditingId] = useState(null);
  const [saveError, setSaveError] = useState(null);

  async function handleSave(teamId, updates) {
    try {
      setSaveError(null);
      await save(teamId, updates);
      setEditingId(null);
    } catch (e) {
      setSaveError(e.message);
    }
  }

  if (loading) return <div className="page active"><div style={{ color: 'var(--text3)', padding: '2rem' }}>Loading team config…</div></div>;
  if (error) return <div className="page active"><div style={{ color: 'var(--red)', padding: '2rem' }}>Error: {error}</div></div>;

  const totalBudget = teams.reduce((s, t) => s + t.budget_usd, 0);

  return (
    <div className="page active">
      <div className="kpi-row">
        <div className="kpi-card"><div className="kpi-label">Teams</div><div className="kpi-value">{teams.length}</div><div className="kpi-delta">Active consumers in Kong</div></div>
        <div className="kpi-card"><div className="kpi-label">Total Monthly Budget</div><div className="kpi-value">${totalBudget.toLocaleString()}</div><div className="kpi-delta">Across all teams</div></div>
        <div className="kpi-card"><div className="kpi-label">Hard Cap Teams</div><div className="kpi-value">{teams.filter(t => t.enforcement === 'hard').length}</div><div className="kpi-delta">Will receive 429 on overage</div></div>
        <div className="kpi-card highlight"><div className="kpi-label">Available Models</div><div className="kpi-value">{ALL_MODELS.length}</div><div className="kpi-delta">In model catalog</div></div>
      </div>

      {saveError && <div style={{ color: 'var(--red)', padding: '0.5rem 0 1rem', fontSize: '0.85rem' }}>Save failed: {saveError}</div>}

      <div className="section-header"><span className="section-title">Budget &amp; Model Configuration</span><div className="section-line" /></div>
      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Team</th>
              <th>Department</th>
              <th>Monthly Budget</th>
              <th>Enforcement</th>
              <th>Alert At</th>
              <th>Rate Limit</th>
              <th>Allowed Models</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {teams.map(t => editingId === t.team_id
              ? <EditRow key={t.team_id} team={t} onSave={u => handleSave(t.team_id, u)} onCancel={() => setEditingId(null)} />
              : <ViewRow key={t.team_id} team={t} onEdit={() => setEditingId(t.team_id)} />
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
