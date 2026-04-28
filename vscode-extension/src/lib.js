// @ts-check
'use strict';

const http = require('http');

const BACKEND = 'http://localhost:8002';
const LIMIT   = 500000;

const MODELS = {
  'gemini-2.5-flash':  { inRate: 0.075, outRate: 0.30  },
  'claude-haiku-4-5':  { inRate: 0.80,  outRate: 4.00  },
  'gpt-4o':            { inRate: 2.50,  outRate: 10.00 },
  'claude-sonnet-4-6': { inRate: 3.00,  outRate: 15.00 },
  'claude-opus-4-7':   { inRate: 15.00, outRate: 75.00 },
};

const THRESH = [
  { min: 90, cls: 'critical', zone: 'CRITICAL',    alert: '🚨 90% critical — throttling imminent' },
  { min: 80, cls: 'danger',   zone: 'danger zone',  alert: '⚠ 80% — high usage detected' },
  { min: 60, cls: 'caution',  zone: 'caution zone', alert: '⚡ 60% — consider a cheaper model' },
  { min: 40, cls: 'warn',     zone: 'watch zone',   alert: '● 40% — monitoring usage' },
  { min: 0,  cls: 'safe',     zone: 'normal',       alert: '' },
];

const MOCK = {
  live: false,
  tokensUsed:        287441,
  remaining:         212559,
  pct:               '57.5',
  sessionPrompt:     124820,
  sessionCompletion: 71440,
  sessionCost:       3.24,
  requests:          47,
  currentModel:      'claude-sonnet-4-6',
  deptPct:           57.5,
  deptRows: [
    { name: 'You',      pct: 57.5, highlight: true  },
    { name: 'R&D avg',  pct: 38.2, highlight: false },
    { name: 'Eng avg',  pct: 22.1, highlight: false },
    { name: 'Finance',  pct: 11.4, highlight: false },
  ],
};

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function loadData(userId) {
  try {
    const [dashboard, session] = await Promise.all([
      fetchJson(`${BACKEND}/usage/dashboard?user_id=${userId}`),
      fetchJson(`${BACKEND}/usage/sessions?user_id=${userId}&limit=1`),
    ]);

    const hourly       = dashboard.hourly_tokens_used ?? 0;
    const deptAvg      = dashboard.dept_avg_hourly_pct ?? 38.2;
    const currentModel = dashboard.current_model ?? 'claude-sonnet-4-6';
    const sess         = Array.isArray(session) && session[0] ? session[0] : null;

    return {
      live: true,
      tokensUsed:        hourly,
      remaining:         LIMIT - hourly,
      pct:               ((hourly / LIMIT) * 100).toFixed(1),
      sessionPrompt:     sess?.prompt_tokens     ?? 0,
      sessionCompletion: sess?.completion_tokens ?? 0,
      sessionCost:       sess?.cost_usd          ?? 0,
      requests:          sess?.request_count     ?? 0,
      currentModel,
      deptPct:  deptAvg,
      deptRows: dashboard.dept_breakdown ?? [],
    };
  } catch {
    return null;
  }
}

function threshInfo(pct) {
  return THRESH.find(t => pct >= t.min);
}

function simTick(currentTokens) {
  return Math.min(currentTokens + 800 + Math.floor(Math.random() * 1600), LIMIT - 1);
}

module.exports = { fetchJson, loadData, threshInfo, simTick, LIMIT, MODELS, MOCK, THRESH };
