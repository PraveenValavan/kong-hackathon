import { useState } from 'react';
import { useEvents } from '../api/hooks';

function fmt(n) { return n == null ? '—' : Number(n).toLocaleString(); }
function fmtUsd(n) { return n == null ? '—' : `$${Number(n).toFixed(4)}`; }
function providerPill(p) {
  const cls = p === 'anthropic' ? 'anthropic' : p === 'openai' ? 'openai' : 'gemini';
  return <span className={`provider-pill ${cls}`}>{p}</span>;
}

export default function TokenLogs({ timeFilter }) {
  const [providerFilter, setProviderFilter] = useState('');
  const [search, setSearch] = useState('');
  const { data: events, loading } = useEvents(timeFilter, providerFilter || null, 100);

  const filtered = (events ?? []).filter(e =>
    !search || (e.user_id ?? '').includes(search) || (e.session_id ?? '').includes(search)
  );

  return (
    <div className="page active">
      <div className="section-header">
        <span className="section-title">Token Logs</span>
        <div className="section-line" />
        <input
          className="table-search"
          placeholder="Filter by user, session..."
          style={{ maxWidth: 200 }}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select
          className="model-filter"
          value={providerFilter}
          onChange={e => setProviderFilter(e.target.value)}
        >
          <option value="">All Providers</option>
          <option value="openai">OpenAI</option>
          <option value="anthropic">Anthropic</option>
          <option value="google">Gemini</option>
        </select>
      </div>
      <div className="table-card">
        <table>
          <thead>
            <tr><th>Timestamp</th><th>User</th><th>Provider</th><th>Model</th><th>In Tokens</th><th>Out Tokens</th><th>Cost</th><th>Session ID</th></tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan="8" style={{ color: 'var(--text3)', textAlign: 'center' }}>Loading…</td></tr>}
            {filtered.map(e => (
              <tr key={e.id}>
                <td style={{ color: 'var(--text3)' }}>{e.ts?.slice(0, 19)}</td>
                <td>{e.user_id}</td>
                <td>{providerPill(e.provider)}</td>
                <td>{e.model}</td>
                <td>{fmt(e.prompt_tokens)}</td>
                <td>{fmt(e.completion_tokens)}</td>
                <td>{fmtUsd(e.cost_usd)}</td>
                <td style={{ color: 'var(--text3)' }}>{e.session_id ? `${e.session_id.slice(0, 4)}…${e.session_id.slice(-4)}` : '—'}</td>
              </tr>
            ))}
            {!loading && filtered.length === 0 && <tr><td colSpan="8" style={{ color: 'var(--text3)', textAlign: 'center' }}>No events</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
