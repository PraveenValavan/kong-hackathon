import { useState } from 'react';

const ROLES = [
  { value: 'admin',       label: 'Admin',       color: '#f0a500' },
  { value: 'engineering', label: 'Engineering', color: '#3b82f6' },
  { value: 'finops',      label: 'FinOps',      color: '#22c55e' },
];

export default function Sidebar({ currentPage, currentRole, access, onNavigate, onRoleChange }) {
  const [roleOpen, setRoleOpen] = useState(false);
  const activeRole = ROLES.find(r => r.value === currentRole) ?? ROLES[0];

  const navItems = [
    { key: 'overview',   label: 'Overview',        section: 'Monitor',  icon: <OverviewIcon /> },
    { key: 'cost',       label: 'Cost & Usage',    section: null,       icon: <CostIcon /> },
    { key: 'anomalies',  label: 'Anomalies',       section: null,       icon: <AnomalyIcon />, badge: '3', badgeType: 'danger' },
    { key: 'forecast',   label: 'AI Forecast',     section: null,       icon: <ForecastIcon />, badge: 'NEW', badgeType: 'warn' },
    { key: 'chargeback', label: 'Chargeback',      section: 'Finance',  icon: <ChargebackIcon /> },
    { key: 'logs',       label: 'Token Logs',      section: null,       icon: <LogsIcon /> },
    { key: 'governance', label: 'Governance',      section: 'Admin',    icon: <GovernanceIcon /> },
    { key: 'teams',      label: 'Teams & Budgets', section: null,       icon: <TeamsIcon /> },
  ];

  let lastSection = null;

  return (
    <aside className="sidebar">
      <div className="logo">
        <div className="logo-mark">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <rect x="1" y="1" width="7" height="7" rx="1.5" fill="#f0a500"/>
            <rect x="10" y="1" width="7" height="7" rx="1.5" fill="#f0a500" opacity="0.5"/>
            <rect x="1" y="10" width="7" height="7" rx="1.5" fill="#f0a500" opacity="0.3"/>
            <rect x="10" y="10" width="7" height="7" rx="1.5" fill="#f0a500" opacity="0.7"/>
          </svg>
          AIRA
        </div>
        <div className="logo-sub">AI Resource Analytics</div>
      </div>

      <nav className="nav">
        {navItems.map(item => {
          const locked = !access.includes(item.key);
          if (locked) return null;
          const showSection = item.section && item.section !== lastSection;
          if (showSection) lastSection = item.section;
          const active = currentPage === item.key;
          return (
            <div key={item.key}>
              {showSection && <div className="nav-section-label">{item.section}</div>}
              <div
                className={`nav-item${active ? ' active' : ''}`}
                onClick={() => onNavigate(item.key)}
              >
                <span className="nav-icon">{item.icon}</span>
                {item.label}
                {item.badge && (
                  <span className={`badge${item.badgeType === 'warn' ? ' warn' : ''}`}>
                    {item.badge}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="role-switcher">
        <div className="role-label">Viewing as</div>
        <div className="role-dropdown">
          <button
            className="role-trigger"
            style={{ '--role-color': activeRole.color }}
            onClick={() => setRoleOpen(o => !o)}
          >
            <span className="role-dot" style={{ background: activeRole.color }} />
            {activeRole.label}
            <span className="role-chevron">{roleOpen ? '▲' : '▼'}</span>
          </button>
          {roleOpen && (
            <div className="role-menu">
              {ROLES.map(r => (
                <div
                  key={r.value}
                  className={`role-option${r.value === currentRole ? ' active' : ''}`}
                  onClick={() => { onRoleChange(r.value); setRoleOpen(false); }}
                >
                  <span className="role-dot" style={{ background: r.color }} />
                  {r.label}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

function OverviewIcon() {
  return <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="1" y="1" width="5" height="5" rx="1"/><rect x="8" y="1" width="5" height="5" rx="1"/><rect x="1" y="8" width="5" height="5" rx="1"/><rect x="8" y="8" width="5" height="5" rx="1"/></svg>;
}
function CostIcon() {
  return <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><polyline points="1,10 4,6 7,8 10,3 13,5"/><line x1="1" y1="13" x2="13" y2="13"/></svg>;
}
function AnomalyIcon() {
  return <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M7 2L13 12H1L7 2Z"/><line x1="7" y1="6" x2="7" y2="9"/><circle cx="7" cy="10.5" r="0.5" fill="currentColor"/></svg>;
}
function ForecastIcon() {
  return <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="7" cy="7" r="5.5"/><path d="M7 4v3l2 2"/></svg>;
}
function ChargebackIcon() {
  return <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="1" y="3" width="12" height="9" rx="1"/><line x1="1" y1="6" x2="13" y2="6"/><line x1="4" y1="9" x2="4" y2="10"/><line x1="7" y1="9" x2="10" y2="9"/></svg>;
}
function LogsIcon() {
  return <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="2" y="1" width="10" height="12" rx="1"/><line x1="4" y1="4" x2="10" y2="4"/><line x1="4" y1="7" x2="10" y2="7"/><line x1="4" y1="10" x2="7" y2="10"/></svg>;
}
function GovernanceIcon() {
  return <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M7 1l6 3v3c0 3-2.5 5.5-6 6.5C1.5 12.5-.5 10 .5 7V4L7 1Z"/></svg>;
}
function TeamsIcon() {
  return <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="5" cy="4" r="2"/><circle cx="10" cy="5" r="1.5"/><path d="M1 12c0-2.2 1.8-4 4-4s4 1.8 4 4"/><path d="M10 8c1.7 0 3 1.3 3 3"/></svg>;
}
