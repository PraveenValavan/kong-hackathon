import { useState } from 'react';
import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';
import Overview from './pages/Overview';
import CostUsage from './pages/CostUsage';
import Anomalies from './pages/Anomalies';
import Forecast from './pages/Forecast';
import Chargeback from './pages/Chargeback';
import TokenLogs from './pages/TokenLogs';
import Governance from './pages/Governance';
import Teams from './pages/Teams';
import Terminal from './pages/Terminal';

export const ROLE_ACCESS = {
  finops:      ['overview', 'cost', 'chargeback', 'forecast'],
  engineering: ['overview', 'cost', 'anomalies', 'forecast', 'logs', 'terminal'],
  admin:       ['overview', 'cost', 'anomalies', 'forecast', 'chargeback', 'logs', 'governance', 'teams', 'terminal'],
};

export const PAGE_TITLES = {
  overview:   'Overview',
  cost:       'Cost & Usage',
  anomalies:  'Anomalies',
  forecast:   'AI Forecast',
  chargeback: 'Chargeback',
  logs:       'Token Logs',
  governance: 'Governance',
  teams:      'Teams & Budgets',
  terminal:   'AIRA Terminal',
};

const PAGES = {
  overview:   Overview,
  cost:       CostUsage,
  anomalies:  Anomalies,
  forecast:   Forecast,
  chargeback: Chargeback,
  logs:       TokenLogs,
  governance: Governance,
  teams:      Teams,
  terminal:   Terminal,
};

export default function App() {
  const [currentPage, setCurrentPage] = useState('overview');
  const [currentRole, setCurrentRole] = useState('admin');
  const [timeFilter, setTimeFilter] = useState('30d');

  const access = ROLE_ACCESS[currentRole];
  const PageComponent = PAGES[currentPage];

  const isTerminal = currentPage === 'terminal';

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar
        currentPage={currentPage}
        currentRole={currentRole}
        access={access}
        onNavigate={setCurrentPage}
        onRoleChange={setCurrentRole}
      />
      <main className="main">
        {!isTerminal && (
          <Topbar
            title={PAGE_TITLES[currentPage]}
            timeFilter={timeFilter}
            onTimeFilterChange={setTimeFilter}
          />
        )}
        {isTerminal ? (
          <Terminal currentRole={currentRole} onNavigate={setCurrentPage} />
        ) : (
          <div className="content">
            <PageComponent
              timeFilter={timeFilter}
              currentRole={currentRole}
              onNavigate={setCurrentPage}
            />
          </div>
        )}
      </main>
    </div>
  );
}
