export const TEAM_BUDGETS = {
  'nlp-platform': 1800,
  'data-science':  2500,
  'platform':      1000,
  'finance':        500,
};

export const DEPT_BUDGETS = {
  'R&D':         4500,
  'Engineering': 1000,
  'Finance':      500,
};

export function teamStatus(spend, team) {
  const budget = TEAM_BUDGETS[team];
  if (!budget) return 'ok';
  const pct = spend / budget;
  if (pct >= 1) return 'over';
  if (pct >= 0.75) return 'warn';
  return 'ok';
}

export function teamPct(spend, team) {
  const budget = TEAM_BUDGETS[team];
  if (!budget) return 0;
  return Math.min(Math.round((spend / budget) * 100), 100);
}
