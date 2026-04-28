// @ts-check
'use strict';

const vscode = require('vscode');
const http   = require('http');

const BACKEND  = 'http://localhost:8002';
const LIMIT    = 500000;
const POLL_MS  = 10000;

const MODELS = {
  'gemini-2.5-flash':       { inRate: 0.075, outRate: 0.30  },
  'claude-haiku-4-5-20251001': { inRate: 0.80,  outRate: 4.00  },
  'gpt-4o':                 { inRate: 2.50,  outRate: 10.00 },
  'claude-sonnet-4-6':      { inRate: 3.00,  outRate: 15.00 },
  'claude-opus-4-7':        { inRate: 15.00, outRate: 75.00 },
};

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

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
    const today = new Date().toISOString().slice(0, 10);
    const dashboard = await fetchJson(`${BACKEND}/usage/dashboard?since=${today}`);
    const totals = dashboard.totals ?? {};
    const tokensUsed = totals.total_tokens ?? 0;

    const deptRows = (dashboard.by_department ?? []).map(r => ({
      name: r.department ?? '—',
      pct:  ((r.total_tokens ?? 0) / LIMIT) * 100,
      highlight: false,
    }));

    return {
      live: true,
      tokensUsed,
      remaining:         LIMIT - tokensUsed,
      pct:               ((tokensUsed / LIMIT) * 100).toFixed(1),
      sessionPrompt:     totals.total_prompt_tokens     ?? 0,
      sessionCompletion: totals.total_completion_tokens ?? 0,
      sessionCost:       totals.total_cost_usd          ?? 0,
      requests:          totals.total_requests          ?? 0,
      currentModel:      'claude-sonnet-4-6',
      deptPct:           ((tokensUsed / LIMIT) * 100),
      deptRows,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Mock data (fallback when backend is not running)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Webview provider
// ---------------------------------------------------------------------------

class AiraPanelProvider {
  constructor(extensionUri) {
    this._extensionUri = extensionUri;
    this._view = null;
    this._data = MOCK;
    this._simTokens = MOCK.tokensUsed;
    this._simInterval = null;
  }

  get visible() {
    return !!this._view?.visible;
  }

  resolveWebviewView(webviewView) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this._html(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(msg => {
      if (msg.command === 'switchModel') {
        vscode.window.showInformationMessage(`AIRA: Switched to ${msg.model}`);
      }
    });

    // start simulation tick when panel becomes visible
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) this._startSim();
      else this._stopSim();
    });

    this._startSim();
  }

  postData(data) {
    this._data = data;
    this._view?.webview.postMessage({ type: 'data', payload: data });
  }

  _startSim() {
    if (this._simInterval) return;
    this._simInterval = setInterval(() => {
      if (!this._data.live) {
        this._simTokens = Math.min(this._simTokens + 800 + Math.floor(Math.random() * 1600), LIMIT - 1);
        const pct = ((this._simTokens / LIMIT) * 100).toFixed(1);
        this._view?.webview.postMessage({
          type: 'sim',
          tokensUsed: this._simTokens,
          pct,
          remaining: LIMIT - this._simTokens,
        });
      }
    }, 8000);
  }

  _stopSim() {
    if (this._simInterval !== null) clearInterval(this._simInterval);
    this._simInterval = null;
  }

  _html(webview) {
    const nonce = Math.random().toString(36).slice(2);
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root {
    --bg:     var(--vscode-sideBar-background, #111113);
    --border: var(--vscode-panel-border, #2a2a32);
    --text:   var(--vscode-foreground, #e8e8ec);
    --text2:  var(--vscode-descriptionForeground, #9898a8);
    --text3:  var(--vscode-disabledForeground, #55555f);
    --bg2:    var(--vscode-input-background, #18181c);
    --bg3:    var(--vscode-badge-background, #222228);
    --amber:   #f0a500;
    --amber-dim: #7a5200;
    --green:   #22c55e;
    --orange:  #f97316;
    --red:     #ef4444;
    --blue:    #3b82f6;
    --purple:  #a855f7;
    --t-safe:     #22c55e;
    --t-warn:     #f0a500;
    --t-caution:  #f97316;
    --t-danger:   #ef4444;
    --t-critical: #dc2626;
  }

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: 'Cascadia Code', 'Cascadia Mono', Consolas, 'Courier New', monospace;
    font-size: 11px;
    overflow-x: hidden;
  }

  /* ── LIVE BADGE ── */
  .live-badge {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    border-bottom: 1px solid var(--border);
    font-size: 9px;
    color: var(--text3);
    letter-spacing: 0.5px;
  }
  .live-dot {
    width: 6px; height: 6px;
    border-radius: 50%;
    background: var(--green);
    box-shadow: 0 0 4px var(--green);
    animation: pulse-conn 2.5s ease-in-out infinite;
  }
  .live-dot.mock { background: var(--text3); box-shadow: none; animation: none; }
  @keyframes pulse-conn {
    0%,100% { box-shadow: 0 0 3px var(--green); }
    50%      { box-shadow: 0 0 8px var(--green); }
  }

  /* ── METER ── */
  .meter-section {
    padding: 12px 10px 10px;
    border-bottom: 1px solid var(--border);
  }
  .token-big {
    font-size: 22px;
    font-weight: 600;
    color: var(--t-caution);
    letter-spacing: -1px;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    transition: color 0.4s;
  }
  .token-of { font-size: 9px; color: var(--text3); margin-top: 2px; margin-bottom: 8px; }
  .seg-bar-wrap { position: relative; margin-bottom: 16px; }
  .seg-bar {
    height: 8px;
    background: var(--bg3);
    border-radius: 2px;
    overflow: hidden;
    display: flex;
  }
  .seg { height: 100%; transition: width 0.8s ease; }
  .seg-1 { background: var(--t-safe); }
  .seg-2 { background: var(--t-warn); }
  .seg-3 { background: var(--t-caution); }
  .seg-4 { background: var(--t-danger); }
  .seg-5 { background: var(--t-critical); }
  .thresh-marks { position: absolute; top: 0; left: 0; right: 0; bottom: 0; pointer-events: none; }
  .thresh-mark {
    position: absolute; top: -3px; width: 1px; height: 14px;
    background: var(--bg);
  }
  .thresh-mark::after {
    content: attr(data-label);
    position: absolute; top: 100%; left: 50%;
    transform: translateX(-50%);
    font-size: 7px; color: var(--text3); margin-top: 1px; white-space: nowrap;
  }
  .thresh-mark[data-pct="40"] { left: 40%; }
  .thresh-mark[data-pct="60"] { left: 60%; }
  .thresh-mark[data-pct="80"] { left: 80%; }
  .thresh-mark[data-pct="90"] { left: 90%; }
  .pct-badge {
    display: inline-flex; align-items: center; gap: 4px;
    font-size: 10px; font-weight: 500;
    color: var(--t-caution); transition: color 0.4s;
  }
  .pct-dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
  .thresh-alert {
    margin-top: 5px; padding: 4px 6px; border-radius: 2px;
    font-size: 9px; display: none; line-height: 1.4;
  }
  .thresh-alert.visible { display: block; }
  .thresh-alert.warn    { background: rgba(240,165,0,0.10); color: var(--amber); }
  .thresh-alert.caution { background: rgba(249,115,22,0.10); color: var(--orange); }
  .thresh-alert.danger  { background: rgba(239,68,68,0.10);  color: var(--red);
    animation: pulse-glow 2s ease-in-out infinite; }
  .thresh-alert.critical{ background: rgba(220,38,38,0.12);  color: var(--t-critical);
    animation: blink-crit 0.5s step-end infinite; }
  @keyframes pulse-glow {
    0%,100% { box-shadow: none; }
    50%      { box-shadow: 0 0 0 3px rgba(239,68,68,0.12); }
  }
  @keyframes blink-crit {
    0%,100% { opacity: 1; } 50% { opacity: 0.3; }
  }

  /* ── DATA SECTIONS ── */
  .section {
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
  }
  .section:last-child { border-bottom: none; }
  .section-label {
    font-size: 8px; letter-spacing: 1.5px; text-transform: uppercase;
    color: var(--text3); margin-bottom: 6px;
  }
  .kv { display: flex; justify-content: space-between; padding: 1.5px 0; }
  .kv-key { color: var(--text3); }
  .kv-val { color: var(--text2); font-variant-numeric: tabular-nums; }
  .kv-val.accent   { color: var(--amber); }
  .kv-val.warn-col { color: var(--orange); }

  /* ── COLLAPSIBLE SECTION ── */
  .section-toggle {
    cursor: pointer; user-select: none;
    display: flex; align-items: center; gap: 5px;
  }
  .section-toggle .caret {
    font-size: 8px; color: var(--text3); transition: transform 0.15s;
  }
  .section-toggle.open .caret { transform: rotate(90deg); }
  .section-body { overflow: hidden; }
  .section-body.collapsed { display: none; }

  /* ── MODEL SWITCHER ── */
  .model-list { display: flex; flex-direction: column; gap: 1px; }
  .model-opt {
    display: flex; align-items: center; gap: 6px;
    padding: 3px 5px; border-radius: 2px; cursor: pointer;
    color: var(--text3); transition: background 0.1s;
    border: none; background: none; width: 100%;
    font-family: inherit; font-size: 11px; text-align: left;
  }
  .model-opt:hover { background: var(--bg2); color: var(--text2); }
  .model-opt.active { color: var(--text2); background: var(--bg2); }
  .model-dot { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; }
  .model-tag { margin-left: auto; font-size: 8px; opacity: 0.7; }
  .model-tag.cheap   { color: var(--green); }
  .model-tag.premium { color: var(--amber); }

  /* ── DEPT BARS ── */
  .dept-row { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
  .dept-label { width: 50px; color: var(--text3); font-size: 10px; flex-shrink: 0; }
  .dept-bar-bg { flex: 1; height: 4px; background: var(--bg3); border-radius: 2px; overflow: hidden; }
  .dept-bar-fill { height: 100%; border-radius: 2px; }
  .dept-pct { width: 26px; text-align: right; font-size: 10px; color: var(--text3); font-variant-numeric: tabular-nums; }
  .dept-row.you .dept-label { color: var(--text2); }
  .dept-row.you .dept-pct   { color: var(--orange); }

  /* ── SUGGESTIONS ── */
  .suggest-line { color: var(--text3); line-height: 1.5; margin-bottom: 4px; }
  .suggest-line strong { color: var(--text2); font-weight: 400; }
  .suggest-btn {
    display: inline-flex; align-items: center; gap: 3px;
    padding: 2px 6px; border-radius: 2px;
    border: 1px solid rgba(34,197,94,0.3); color: var(--green);
    font-size: 10px; cursor: pointer; background: none;
    font-family: inherit; opacity: 0.8; margin-top: 3px;
    transition: all 0.1s;
  }
  .suggest-btn:hover { opacity: 1; background: rgba(34,197,94,0.08); }

  /* ── TRAINING ── */
  .training-link {
    display: block; color: var(--text3); text-decoration: none;
    padding: 3px 0; border-bottom: 1px solid var(--border);
    font-size: 10px; transition: color 0.1s;
  }
  .training-link:last-of-type { border-bottom: none; }
  .training-link:hover { color: var(--blue); }
  .training-cta {
    margin-top: 6px; width: 100%; padding: 4px;
    background: none; border: 1px solid var(--amber-dim);
    color: var(--amber-dim); font-family: inherit; font-size: 10px;
    border-radius: 2px; cursor: pointer; text-align: left;
    transition: all 0.15s;
  }
  .training-cta:hover { border-color: var(--amber); color: var(--amber); }

  /* ── AMBIENT STATUS ── */
  .ambient {
    padding: 6px 10px;
    display: flex; flex-wrap: wrap; gap: 5px 8px;
    font-size: 9px; color: var(--text3);
    border-top: 1px solid var(--border);
  }
  .amb-item { display: flex; align-items: center; gap: 3px; }
  .amb-dot  { width: 4px; height: 4px; border-radius: 50%; }
</style>
</head>
<body>

<!-- LIVE BADGE -->
<div class="live-badge">
  <div class="live-dot" id="live-dot"></div>
  <span id="live-label">CONNECTING…</span>
  <span style="margin-left:auto;font-variant-numeric:tabular-nums" id="sb-clock"></span>
</div>

<!-- TOKEN METER -->
<div class="meter-section">
  <div class="token-big" id="meter-count">287,441</div>
  <div class="token-of">of 500,000 tokens / hr</div>
  <div class="seg-bar-wrap">
    <div class="seg-bar">
      <div class="seg seg-1" id="seg1"></div>
      <div class="seg seg-2" id="seg2"></div>
      <div class="seg seg-3" id="seg3"></div>
      <div class="seg seg-4" id="seg4"></div>
      <div class="seg seg-5" id="seg5"></div>
    </div>
    <div class="thresh-marks">
      <div class="thresh-mark" data-pct="40" data-label="40%"></div>
      <div class="thresh-mark" data-pct="60" data-label="60%"></div>
      <div class="thresh-mark" data-pct="80" data-label="80%"></div>
      <div class="thresh-mark" data-pct="90" data-label="90%"></div>
    </div>
  </div>
  <div class="pct-badge" id="pct-badge">
    <div class="pct-dot"></div>
    <span id="pct-text">57.5% · caution zone</span>
  </div>
  <div class="thresh-alert" id="thresh-alert"></div>
</div>

<!-- SESSION STATS (collapsible) -->
<div class="section">
  <div class="section-label section-toggle open" id="toggle-session" onclick="toggleSection('session')">
    <span class="caret">▶</span> Session
  </div>
  <div class="section-body" id="body-session">
    <div class="kv"><span class="kv-key">prompt</span><span class="kv-val" id="s-prompt">124,820</span></div>
    <div class="kv"><span class="kv-key">completion</span><span class="kv-val" id="s-completion">71,440</span></div>
    <div class="kv"><span class="kv-key">total</span><span class="kv-val accent" id="s-total">196,260</span></div>
    <div class="kv"><span class="kv-key">requests</span><span class="kv-val" id="s-req">47</span></div>
    <div class="kv"><span class="kv-key">cost</span><span class="kv-val accent" id="s-cost">$3.24</span></div>
    <div class="kv"><span class="kv-key">burn rate</span><span class="kv-val warn-col" id="s-burn">$0.04/min</span></div>
    <div class="kv" style="margin-top:5px"><span class="kv-key">remaining</span><span class="kv-val" id="remain-count">212,559</span></div>
    <div class="kv"><span class="kv-key">resets in</span><span class="kv-val" id="reset-timer">42:17</span></div>
    <div class="kv"><span class="kv-key">limit hit in</span><span class="kv-val warn-col" id="limit-hit">~28 min</span></div>
  </div>
</div>

<!-- MODEL SWITCHER (collapsible) -->
<div class="section">
  <div class="section-label section-toggle open" id="toggle-model" onclick="toggleSection('model')">
    <span class="caret">▶</span> Switch Model
  </div>
  <div class="section-body" id="body-model">
    <div class="model-list">
      <button class="model-opt" data-model="gemini-2.5-flash" onclick="pickModel('gemini-2.5-flash')">
        <div class="model-dot" style="background:#22c55e"></div>
        gemini-2.5-flash <span class="model-tag cheap">cheapest</span>
      </button>
      <button class="model-opt" data-model="claude-haiku-4-5-20251001" onclick="pickModel('claude-haiku-4-5-20251001')">
        <div class="model-dot" style="background:#a855f7"></div>
        claude-haiku-4-5
      </button>
      <button class="model-opt" data-model="gpt-4o" onclick="pickModel('gpt-4o')">
        <div class="model-dot" style="background:#3b82f6"></div>
        gpt-4o
      </button>
      <button class="model-opt active" data-model="claude-sonnet-4-6" onclick="pickModel('claude-sonnet-4-6')">
        <div class="model-dot" style="background:#a855f7"></div>
        claude-sonnet-4-6
      </button>
      <button class="model-opt" data-model="claude-opus-4-7" onclick="pickModel('claude-opus-4-7')">
        <div class="model-dot" style="background:#f0a500"></div>
        claude-opus-4-7 <span class="model-tag premium">premium</span>
      </button>
    </div>
  </div>
</div>

<!-- DEPT COMPARISON (collapsible) -->
<div class="section">
  <div class="section-label section-toggle" id="toggle-dept" onclick="toggleSection('dept')">
    <span class="caret">▶</span> Dept usage · this hour
  </div>
  <div class="section-body collapsed" id="body-dept">
    <div class="dept-row you">
      <div class="dept-label">You</div>
      <div class="dept-bar-bg"><div class="dept-bar-fill" id="dept-you" style="width:57.5%;background:var(--orange)"></div></div>
      <div class="dept-pct" id="dept-you-pct">57.5%</div>
    </div>
    <div class="dept-row">
      <div class="dept-label">R&amp;D avg</div>
      <div class="dept-bar-bg"><div class="dept-bar-fill" style="width:38.2%;background:var(--text3)"></div></div>
      <div class="dept-pct">38.2%</div>
    </div>
    <div class="dept-row">
      <div class="dept-label">Eng avg</div>
      <div class="dept-bar-bg"><div class="dept-bar-fill" style="width:22.1%;background:var(--text3)"></div></div>
      <div class="dept-pct">22.1%</div>
    </div>
    <div class="dept-row">
      <div class="dept-label">Finance</div>
      <div class="dept-bar-bg"><div class="dept-bar-fill" style="width:11.4%;background:var(--text3)"></div></div>
      <div class="dept-pct">11.4%</div>
    </div>
    <div style="font-size:9px;color:var(--orange);margin-top:4px">▲ 19.3% above R&amp;D avg</div>
  </div>
</div>

<!-- SUGGESTIONS (collapsible) -->
<div class="section">
  <div class="section-label section-toggle" id="toggle-suggest" onclick="toggleSection('suggest')">
    <span class="caret">▶</span> Suggestions
  </div>
  <div class="section-body collapsed" id="body-suggest">
    <div class="suggest-line">Last prompt ratio <strong>19×</strong> — try shorter phrasing</div>
    <button class="suggest-btn" onclick="pickModel('gemini-2.5-flash')">→ route to gemini-2.5-flash</button>
    <div class="suggest-line" style="margin-top:7px">System prompt <strong>847 tokens</strong> — compression saves ~400/req</div>
  </div>
</div>

<!-- LEARNING (collapsible) -->
<div class="section">
  <div class="section-label section-toggle" id="toggle-learn" onclick="toggleSection('learn')">
    <span class="caret">▶</span> Learning
  </div>
  <div class="section-body collapsed" id="body-learn">
    <a href="https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview" class="training-link">→ Prompt Engineering for Claude ↗</a>
    <a href="#" class="training-link">→ Reducing Token Cost ↗</a>
    <a href="#" class="training-link">→ Kong Rate Limit Practices ↗</a>
    <button class="training-cta">Personalised Training ↗</button>
  </div>
</div>

<!-- AMBIENT -->
<div class="ambient">
  <div class="amb-item"><div class="amb-dot" style="background:#22c55e"></div>PII guard</div>
  <div class="amb-item"><div class="amb-dot" style="background:#3b82f6"></div>ctx 7.1%</div>
  <div class="amb-item">latency <span style="color:var(--text2);margin-left:2px">▁▂▄▃▆ 2.1s</span></div>
</div>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const LIMIT  = 500000;

const THRESH = [
  { min:90, cls:'critical', color:'var(--t-critical)', zone:'CRITICAL',    alert:'🚨 90% critical — throttling imminent' },
  { min:80, cls:'danger',   color:'var(--t-danger)',   zone:'danger zone',  alert:'⚠ 80% — high usage detected' },
  { min:60, cls:'caution',  color:'var(--t-caution)',  zone:'caution zone', alert:'⚡ 60% — consider a cheaper model' },
  { min:40, cls:'warn',     color:'var(--t-warn)',     zone:'watch zone',   alert:'● 40% — monitoring usage' },
  { min:0,  cls:'safe',     color:'var(--t-safe)',     zone:'normal',       alert:'' },
];

const SEG_ZONES = [
  { start:0,   end:0.4 },
  { start:0.4, end:0.6 },
  { start:0.6, end:0.8 },
  { start:0.8, end:0.9 },
  { start:0.9, end:1.0 },
];

const EL = {};
const SEG_ELS = [];
let resetSeconds = 60 * 60; // 1 hour window, counts down
let limitHitMins = null;   // null = unknown until live data arrives

function fmt(n) { return Number(n).toLocaleString(); }
function threshInfo(p) { return THRESH.find(t => p >= t.min); }

function renderMeter(tokensUsed, remaining) {
  const p = (tokensUsed / LIMIT) * 100;
  const info = threshInfo(p);

  EL.meterCount.textContent = fmt(tokensUsed);
  EL.meterCount.style.color = info.color;

  const ratio = tokensUsed / LIMIT;
  SEG_ELS.forEach((el, i) => {
    const z = SEG_ZONES[i];
    const segSize = z.end - z.start;
    const fill = ratio > z.start ? Math.min((ratio - z.start) / segSize, 1) * 100 : 0;
    el.style.width = fill + '%';
  });

  EL.pctBadge.style.color = info.color;
  EL.pctText.textContent = \`\${p.toFixed(1)}% · \${info.zone}\`;

  const alertEl = EL.threshAlert;
  if (info.alert) {
    alertEl.className = \`thresh-alert visible \${info.cls}\`;
    alertEl.textContent = info.alert;
  } else {
    alertEl.className = 'thresh-alert';
  }

  if (remaining !== undefined) EL.remainCount.textContent = fmt(remaining);
}

function renderSession(d) {
  const total = (d.sessionPrompt || 0) + (d.sessionCompletion || 0);
  EL.sPrompt.textContent     = fmt(d.sessionPrompt || 0);
  EL.sCompletion.textContent = fmt(d.sessionCompletion || 0);
  EL.sTotal.textContent      = fmt(total);
  EL.sReq.textContent        = d.requests || 0;
  EL.sCost.textContent       = '$' + Number(d.sessionCost || 0).toFixed(2);
  if (EL.sBurn) {
    const elapsedMin = Math.max((Date.now() - renderSession._startTime) / 60000, 0.1);
    const burn = d.sessionCost > 0 ? (d.sessionCost / elapsedMin).toFixed(3) : '0.000';
    EL.sBurn.textContent = '$' + burn + '/min';
  }
}
renderSession._startTime = Date.now();

function updateLiveBadge(live) {
  const dot = EL.liveDot;
  dot.classList.toggle('mock', !live);
  EL.liveLabel.textContent = live ? 'LIVE · kong-ai-gateway:8002' : 'SIMULATION · backend offline';
}

function tickClock() {
  const now = new Date();
  const pad = n => String(n).padStart(2,'0');
  EL.sbClock.textContent = \`\${pad(now.getHours())}:\${pad(now.getMinutes())}:\${pad(now.getSeconds())}\`;
}

function tickReset() {
  if (resetSeconds > 0) resetSeconds--;
  const m = String(Math.floor(resetSeconds / 60)).padStart(2,'0');
  const s = String(resetSeconds % 60).padStart(2,'0');
  EL.resetTimer.textContent = \`\${m}:\${s}\`;
  EL.limitHit.textContent   = limitHitMins === null ? '> 1 hr' : limitHitMins < 60 ? \`~\${limitHitMins} min\` : '> 1 hr';
}

function toggleSection(name) {
  const toggle = document.getElementById('toggle-' + name);
  const body   = document.getElementById('body-' + name);
  const open   = !body.classList.contains('collapsed');
  body.classList.toggle('collapsed', open);
  toggle.classList.toggle('open', !open);
}

function pickModel(key) {
  document.querySelectorAll('.model-opt').forEach(el => {
    el.classList.toggle('active', el.dataset.model === key);
  });
  vscode.postMessage({ command: 'switchModel', model: key });
}

function init() {
  EL.meterCount   = document.getElementById('meter-count');
  EL.pctBadge     = document.getElementById('pct-badge');
  EL.pctText      = document.getElementById('pct-text');
  EL.threshAlert  = document.getElementById('thresh-alert');
  EL.remainCount  = document.getElementById('remain-count');
  EL.resetTimer   = document.getElementById('reset-timer');
  EL.limitHit     = document.getElementById('limit-hit');
  EL.sPrompt      = document.getElementById('s-prompt');
  EL.sCompletion  = document.getElementById('s-completion');
  EL.sTotal       = document.getElementById('s-total');
  EL.sReq         = document.getElementById('s-req');
  EL.sCost        = document.getElementById('s-cost');
  EL.sBurn        = document.getElementById('s-burn');
  EL.liveDot      = document.getElementById('live-dot');
  EL.liveLabel    = document.getElementById('live-label');
  EL.sbClock      = document.getElementById('sb-clock');

  for (let i = 1; i <= 5; i++) SEG_ELS.push(document.getElementById('seg' + i));

  // initial render with zeros — live data fills in after first poll
  renderMeter(0, LIMIT);
  renderSession({ sessionPrompt:0, sessionCompletion:0, sessionCost:0, requests:0 });
  updateLiveBadge(false);
  tickClock();

  setInterval(tickClock, 1000);
  setInterval(tickReset, 1000);
}

window.addEventListener('message', ({ data: msg }) => {
  if (msg.type === 'data') {
    const d = msg.payload;
    renderMeter(d.tokensUsed, d.remaining);
    renderSession(d);
    updateLiveBadge(d.live);
    if (d.tokensUsed > 0) {
      const elapsedMin = Math.max((Date.now() - renderSession._startTime) / 60000, 0.1);
      const burnRate = d.tokensUsed / elapsedMin;
      limitHitMins = burnRate > 0 ? Math.round((LIMIT - d.tokensUsed) / burnRate) : null;
    }
  }
  if (msg.type === 'sim') {
    renderMeter(msg.tokensUsed, msg.remaining);
  }
});

init();
</script>
</body>
</html>`;
  }
}

// ---------------------------------------------------------------------------
// Extension activation
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Full-screen terminal panel (editor area)
// ---------------------------------------------------------------------------

class AiraTerminalPanel {
  /** @type {AiraTerminalPanel | null} */
  static currentPanel = null;

  static createOrShow(extensionUri) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (AiraTerminalPanel.currentPanel) {
      AiraTerminalPanel.currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'airaTerminal',
      'AIRA Terminal',
      column || vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    AiraTerminalPanel.currentPanel = new AiraTerminalPanel(panel, extensionUri);
  }

  constructor(panel, extensionUri) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._panel.webview.html = this._getHtml(this._panel.webview);
    this._panel.onDidDispose(() => { AiraTerminalPanel.currentPanel = null; });
    this._panel.webview.onDidReceiveMessage(msg => {
      if (msg.command === 'switchModel') {
        vscode.window.showInformationMessage(`AIRA: Model set to ${msg.model}`);
      }
    });
  }

  _getHtml(webview) {
    const nonce = Math.random().toString(36).slice(2);
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src http://localhost:8000 http://localhost:8002 http://localhost:8080;">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root {
  --bg:#0c0c0e; --bg1:#111113; --bg2:#18181c; --bg3:#222228;
  --border:#2a2a32; --border2:#38383f;
  --amber:#f0a500; --amber-dim:#7a5200;
  --green:#22c55e; --red:#ef4444; --orange:#f97316;
  --blue:#3b82f6; --purple:#a855f7;
  --text:#e8e8ec; --text2:#9898a8; --text3:#55555f;
  --t-safe:#22c55e; --t-warn:#f0a500; --t-caution:#f97316;
  --t-danger:#ef4444; --t-critical:#dc2626;
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);font-family:'Cascadia Code','Cascadia Mono',Consolas,'Courier New',monospace;height:100vh;overflow:hidden;display:flex;flex-direction:column}
.terminal-body{flex:1;display:flex;overflow:hidden}
.gutter{width:38px;background:#0a0a0c;border-right:1px solid var(--border);display:flex;flex-direction:column;align-items:center;padding:12px 0;gap:14px;flex-shrink:0}
.gutter-line{width:1px;flex:1;background:var(--border)}
.gutter-num{font-size:9px;color:var(--text3);writing-mode:vertical-rl;letter-spacing:2px}
.conn-dot{width:8px;height:8px;border-radius:50%;background:var(--amber);box-shadow:0 0 6px var(--amber)}
.conn-dot.live{background:var(--green);box-shadow:0 0 6px var(--green);animation:pulse-conn 2.5s ease-in-out infinite}
.conn-dot.err{background:var(--red);box-shadow:0 0 6px var(--red)}
@keyframes pulse-conn{0%,100%{box-shadow:0 0 4px var(--green)}50%{box-shadow:0 0 10px var(--green)}}
.main-pane{flex:1;display:flex;flex-direction:column;overflow:hidden}
.chat-layout{flex:1;display:flex;overflow:hidden}
.terminal-area{flex:1;display:flex;flex-direction:column;overflow:hidden;border-right:1px solid var(--border)}
.terminal-output{flex:1;overflow-y:auto;padding:16px 20px;display:flex;flex-direction:column;gap:4px;scrollbar-width:thin;scrollbar-color:var(--border2) transparent}
.term-line{font-size:12px;line-height:1.7;color:var(--text2);display:flex;gap:10px}
.term-time{color:var(--text3);flex-shrink:0;min-width:58px}
.term-tag{flex-shrink:0;font-size:10px;padding:1px 5px;border-radius:3px;margin-top:2px;height:fit-content}
.term-tag.ok{background:rgba(34,197,94,.15);color:var(--green)}
.term-tag.sys{background:rgba(240,165,0,.12);color:var(--amber)}
.term-tag.warn{background:rgba(239,68,68,.15);color:var(--red)}
.term-tag.info{background:rgba(59,130,246,.15);color:var(--blue)}
.term-msg{color:var(--text2)}
.term-msg.highlight{color:var(--text)}
.term-msg.muted{color:var(--text3)}
.term-msg.success{color:var(--green)}
.term-msg.danger{color:var(--red)}
.term-msg.caution{color:var(--orange)}
.term-msg.user{color:var(--amber)}
.term-msg.assistant{color:var(--text)}
.term-msg.thinking{color:var(--text3);font-style:italic}
.term-divider{height:1px;background:var(--border);margin:8px 0}
.input-bar{height:50px;border-top:1px solid var(--border);display:flex;align-items:center;padding:0 16px;gap:10px;background:var(--bg);flex-shrink:0}
.input-prompt{font-size:12px;color:var(--amber);white-space:nowrap;display:flex;align-items:center;gap:6px}
.input-prompt-model{font-size:10px;color:var(--text3);border:1px solid var(--border2);padding:1px 6px;border-radius:3px}
.input-field{flex:1;background:none;border:none;outline:none;font-family:inherit;font-size:12px;color:var(--text);caret-color:var(--amber)}
.input-field::placeholder{color:var(--text3)}
.input-cost{font-size:10px;color:var(--text3);white-space:nowrap;transition:color .3s}
.sidebar{width:240px;flex-shrink:0;overflow-y:auto;display:flex;flex-direction:column;scrollbar-width:thin;scrollbar-color:var(--border2) transparent;background:var(--bg1);border-left:1px solid var(--border)}
.meter-section{padding:14px 14px 12px;border-bottom:1px solid var(--border)}
.data-section{padding:10px 14px;border-bottom:1px solid var(--border)}
.data-section:last-child{border-bottom:none}
.section-label{font-size:8px;letter-spacing:1.5px;text-transform:uppercase;color:var(--text3);margin-bottom:7px}
.kv-row{display:flex;justify-content:space-between;align-items:baseline;padding:2px 0;font-size:11px}
.kv-key{color:var(--text3)}
.kv-val{color:var(--text2);font-variant-numeric:tabular-nums}
.kv-val.accent{color:var(--amber)}
.kv-val.warn-col{color:var(--orange)}
.token-big{font-size:24px;font-weight:600;color:var(--t-caution);letter-spacing:-1px;line-height:1;font-variant-numeric:tabular-nums;transition:color .4s}
.token-of{font-size:10px;color:var(--text3);margin-top:2px;margin-bottom:10px}
.seg-bar-wrap{position:relative;margin-bottom:18px}
.seg-bar{height:10px;background:var(--bg3);border-radius:3px;overflow:hidden;display:flex}
.seg{height:100%;transition:width .8s ease}
.seg-1{background:var(--t-safe)}.seg-2{background:var(--t-warn)}.seg-3{background:var(--t-caution)}.seg-4{background:var(--t-danger)}.seg-5{background:var(--t-critical)}
.thresh-marks{position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none}
.thresh-mark{position:absolute;top:-4px;width:1px;height:18px;background:var(--bg3)}
.thresh-mark::after{content:attr(data-label);position:absolute;top:100%;left:50%;transform:translateX(-50%);font-size:8px;color:var(--text3);margin-top:2px;white-space:nowrap}
.thresh-mark[data-pct="40"]{left:40%}.thresh-mark[data-pct="60"]{left:60%}.thresh-mark[data-pct="80"]{left:80%}.thresh-mark[data-pct="90"]{left:90%}
.pct-badge{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:500;color:var(--t-caution);transition:color .4s}
.pct-badge-dot{width:6px;height:6px;border-radius:50%;background:currentColor}
.thresh-alert{margin-top:6px;padding:5px 8px;border-radius:3px;font-size:10px;display:none;align-items:center;gap:6px}
.thresh-alert.visible{display:flex}
.thresh-alert.warn{background:rgba(240,165,0,.12);color:var(--amber);border:1px solid rgba(240,165,0,.2)}
.thresh-alert.caution{background:rgba(249,115,22,.12);color:var(--orange);border:1px solid rgba(249,115,22,.2)}
.thresh-alert.danger{background:rgba(239,68,68,.12);color:var(--red);border:1px solid rgba(239,68,68,.2)}
.thresh-alert.critical{background:rgba(220,38,38,.15);color:var(--t-critical);border:1px solid rgba(220,38,38,.3)}
.dept-row{display:flex;align-items:center;gap:8px;margin-bottom:5px}
.dept-label{width:52px;color:var(--text3);flex-shrink:0;font-size:10px}
.dept-bar-bg{flex:1;height:4px;background:var(--bg3);border-radius:2px;overflow:hidden}
.dept-bar-fill{height:100%;border-radius:2px}
.dept-pct{width:28px;text-align:right;color:var(--text3);font-size:10px;flex-shrink:0;font-variant-numeric:tabular-nums}
.dept-row.you .dept-label{color:var(--text2)}.dept-row.you .dept-pct{color:var(--orange)}
.model-list{display:flex;flex-direction:column;gap:1px}
.model-option{display:flex;align-items:center;gap:7px;padding:4px 6px;border-radius:3px;cursor:pointer;font-size:11px;color:var(--text3);transition:background .1s}
.model-option:hover{background:var(--bg2);color:var(--text2)}
.model-option.active{color:var(--text2);background:var(--bg2)}
.dot-m{width:5px;height:5px;border-radius:50%;flex-shrink:0;opacity:.7}
.model-option.active .dot-m{opacity:1}
.model-tag{margin-left:auto;font-size:8px;padding:1px 4px;border-radius:2px}
.model-tag.cheap{color:var(--green);opacity:.7}.model-tag.premium{color:var(--amber);opacity:.7}
.status-bar{height:26px;background:#080809;border-top:1px solid var(--border);display:flex;align-items:center;padding:0 14px;gap:0;font-size:10px;color:var(--text3);flex-shrink:0}
.sb-item{display:flex;align-items:center;gap:5px;padding:0 10px;border-right:1px solid var(--border);height:100%}
.sb-item:first-child{padding-left:0}.sb-item:last-child{border-right:none;margin-left:auto;padding-right:0}
.sb-model{color:var(--text2)}.sb-tokens{font-variant-numeric:tabular-nums;transition:color .4s}
.sb-pct{padding:1px 6px;border-radius:2px;font-weight:500;transition:all .4s}
.sb-clock{color:var(--text2);font-variant-numeric:tabular-nums}
</style>
</head>
<body>

<div class="terminal-body">
  <div class="gutter">
    <div class="conn-dot" id="conn-dot"></div>
    <div class="gutter-line"></div>
    <div class="gutter-num">AIRA</div>
    <div class="gutter-line"></div>
  </div>

  <div class="main-pane">
    <div class="chat-layout">
        <div class="terminal-area">
          <div class="terminal-output" id="terminal-output"></div>
          <div class="input-bar">
            <div class="input-prompt">
              $
              <span class="input-prompt-model" id="input-model-label">claude-sonnet-4-6</span>
              ›
            </div>
            <input class="input-field" id="user-input" type="text" placeholder="Type your prompt here…" oninput="updateInputCost(this.value)" />
            <span class="input-cost" id="input-cost-hint">~0 tokens</span>
          </div>
        </div>

        <div class="sidebar">
          <div class="meter-section">
            <div class="token-big" id="meter-count">0</div>
            <div class="token-of">of 500,000 tokens / hr</div>
            <div class="seg-bar-wrap">
              <div class="seg-bar">
                <div class="seg seg-1" id="seg1"></div>
                <div class="seg seg-2" id="seg2"></div>
                <div class="seg seg-3" id="seg3"></div>
                <div class="seg seg-4" id="seg4"></div>
                <div class="seg seg-5" id="seg5"></div>
              </div>
              <div class="thresh-marks">
                <div class="thresh-mark" data-pct="40" data-label="40%"></div>
                <div class="thresh-mark" data-pct="60" data-label="60%"></div>
                <div class="thresh-mark" data-pct="80" data-label="80%"></div>
                <div class="thresh-mark" data-pct="90" data-label="90%"></div>
              </div>
            </div>
            <div class="pct-badge" id="pct-badge">
              <div class="pct-badge-dot"></div>
              <span id="pct-badge-text">0.0% used · normal</span>
            </div>
            <div class="thresh-alert" id="thresh-alert"></div>
          </div>

          <div class="data-section">
            <div class="section-label">Session</div>
            <div class="kv-row"><span class="kv-key">prompt</span><span class="kv-val" id="s-prompt">0</span></div>
            <div class="kv-row"><span class="kv-key">completion</span><span class="kv-val" id="s-completion">0</span></div>
            <div class="kv-row"><span class="kv-key">total</span><span class="kv-val accent" id="s-total">0</span></div>
            <div class="kv-row"><span class="kv-key">requests</span><span class="kv-val" id="s-req">0</span></div>
            <div class="kv-row"><span class="kv-key">cost</span><span class="kv-val accent" id="s-cost">$0.00</span></div>
            <div class="kv-row"><span class="kv-key">burn rate</span><span class="kv-val warn-col" id="s-burn">$0.000/min</span></div>
            <div class="kv-row"><span class="kv-key">elapsed</span><span class="kv-val" id="s-elapsed">00:00:00</span></div>
            <div class="kv-row" style="margin-top:6px"><span class="kv-key">remaining</span><span class="kv-val" id="remain-count">500,000</span></div>
            <div class="kv-row"><span class="kv-key">limit hit in</span><span class="kv-val warn-col" id="limit-hit">&gt; 1 hr</span></div>
          </div>

          <div class="data-section">
            <div class="section-label">Switch Model</div>
            <div class="model-list">
              <div class="model-option" onclick="switchModel('gemini-2.5-flash')"><div class="dot-m" style="background:var(--green)"></div>gemini-2.5-flash<span class="model-tag cheap">cheapest</span></div>
              <div class="model-option" onclick="switchModel('claude-haiku-4-5-20251001')"><div class="dot-m" style="background:var(--purple)"></div>claude-haiku-4-5</div>
              <div class="model-option" onclick="switchModel('gpt-4o')"><div class="dot-m" style="background:var(--blue)"></div>gpt-4o</div>
              <div class="model-option active" onclick="switchModel('claude-sonnet-4-6')"><div class="dot-m" style="background:var(--purple)"></div>claude-sonnet-4-6</div>
              <div class="model-option" onclick="switchModel('claude-opus-4-7')"><div class="dot-m" style="background:var(--amber)"></div>claude-opus-4-7<span class="model-tag premium">premium</span></div>
            </div>
          </div>

          <div class="data-section">
            <div class="section-label">Dept usage · this hour</div>
            <div class="dept-row you"><div class="dept-label">You</div><div class="dept-bar-bg"><div class="dept-bar-fill" id="dept-you-bar" style="width:0%;background:var(--orange)"></div></div><div class="dept-pct" id="dept-you-pct">0.0%</div></div>
            <div class="dept-row"><div class="dept-label">R&amp;D</div><div class="dept-bar-bg"><div class="dept-bar-fill" id="dept-rnd-bar" style="width:0%;background:var(--text3)"></div></div><div class="dept-pct" id="dept-rnd-pct">0.0%</div></div>
            <div class="dept-row"><div class="dept-label">Eng</div><div class="dept-bar-bg"><div class="dept-bar-fill" id="dept-eng-bar" style="width:0%;background:var(--text3)"></div></div><div class="dept-pct" id="dept-eng-pct">0.0%</div></div>
            <div class="dept-row"><div class="dept-label">Finance</div><div class="dept-bar-bg"><div class="dept-bar-fill" id="dept-fin-bar" style="width:0%;background:var(--text3)"></div></div><div class="dept-pct" id="dept-fin-pct">0.0%</div></div>
          </div>

          <div class="data-section" style="border-bottom:none">
            <div style="font-size:10px;color:var(--text3);display:flex;flex-wrap:wrap;gap:6px 10px">
              <div style="display:flex;align-items:center;gap:4px"><div style="width:5px;height:5px;border-radius:50%;background:var(--green)"></div>PII guard</div>
              <div style="display:flex;align-items:center;gap:4px"><div style="width:5px;height:5px;border-radius:50%;background:var(--blue)"></div>ctx <span id="ctx-pct">0.0%</span></div>
              <div id="conn-label" style="color:var(--text3)">connecting</div>
            </div>
          </div>
        </div>
    </div>
  </div>
</div>

<div class="status-bar">
  <div class="sb-item"><span id="sb-conn" style="color:var(--amber)">◉</span><span id="sb-conn-text">CONNECTING</span></div>
  <div class="sb-item"><span class="sb-model" id="sb-model">claude-sonnet-4-6</span></div>
  <div class="sb-item"><span class="sb-tokens" id="sb-tokens" style="color:var(--t-safe)">0 / 500k</span></div>
  <div class="sb-item"><span class="sb-pct" id="sb-pct" style="background:rgba(34,197,94,.12);color:var(--t-safe)">0.0%</span></div>
  <div class="sb-item" style="border-right:1px solid var(--border)"><span style="color:var(--text3)">dept: R&amp;D</span></div>
  <div class="sb-item"><span class="sb-clock" id="sb-clock">--:--:--</span></div>
</div>

<script nonce="${nonce}">
const vscode  = acquireVsCodeApi();
const BACKEND = 'http://localhost:8002';
const OAUTH2  = 'http://localhost:8080/default/token';
const LIMIT   = 500000;

const MODELS = {
  'gemini-2.5-flash':       { color:'var(--green)',  inRate:0.075, outRate:0.30  },
  'claude-haiku-4-5-20251001': { color:'var(--purple)', inRate:0.80,  outRate:4.00  },
  'gpt-4o':                 { color:'var(--blue)',   inRate:2.50,  outRate:10.00 },
  'claude-sonnet-4-6':      { color:'var(--purple)', inRate:3.00,  outRate:15.00 },
  'claude-opus-4-7':        { color:'var(--amber)',  inRate:15.00, outRate:75.00 },
};

const THRESH = [
  { min:90, cls:'critical', color:'var(--t-critical)', zone:'CRITICAL',    alert:'🚨 90% critical — throttling imminent' },
  { min:80, cls:'danger',   color:'var(--t-danger)',   zone:'danger zone', alert:'⚠ 80% — high usage detected' },
  { min:60, cls:'caution',  color:'var(--t-caution)',  zone:'caution zone',alert:'⚡ 60% — consider a cheaper model' },
  { min:40, cls:'warn',     color:'var(--t-warn)',     zone:'watch zone',  alert:'● 40% — monitoring usage' },
  { min:0,  cls:'safe',     color:'var(--t-safe)',     zone:'normal',      alert:'' },
];

const SEG_ZONES = [
  {start:0,end:0.4},{start:0.4,end:0.6},{start:0.6,end:0.8},{start:0.8,end:0.9},{start:0.9,end:1.0}
];

const state = {
  tokensUsed:0, sessionPrompt:0, sessionCompletion:0,
  requests:0, sessionCost:0, currentModel:'claude-sonnet-4-6',
  startTime:Date.now(), bearerToken:null, connStatus:'connecting',
  sending:false,
};

function fmt(n) { return Math.round(n).toLocaleString(); }
function nowStr() {
  const d = new Date();
  return [d.getHours(),d.getMinutes(),d.getSeconds()].map(n=>String(n).padStart(2,'0')).join(':');
}
function threshInfo(p) { return THRESH.find(t => p >= t.min); }

const EL = {};
let SEG_ELS;

function initEls() {
  ['meter-count','pct-badge','pct-badge-text','thresh-alert','remain-count','limit-hit',
   's-prompt','s-completion','s-total','s-req','s-cost','s-burn','s-elapsed',
   'sb-tokens','sb-pct','sb-model','sb-clock','sb-conn','sb-conn-text',
   'terminal-output','input-model-label','input-cost-hint',
   'conn-dot','conn-label','ctx-pct','dept-you-bar','dept-you-pct'
  ].forEach(id => { EL[id.replace(/-([a-z])/g,(_,c)=>c.toUpperCase())] = document.getElementById(id); });
  SEG_ELS = [1,2,3,4,5].map(i => document.getElementById('seg'+i));
}

function updateMeter() {
  const p = (state.tokensUsed / LIMIT) * 100;
  const info = threshInfo(p);
  EL.meterCount.textContent = fmt(state.tokensUsed);
  EL.meterCount.style.color = info.color;

  const ratio = state.tokensUsed / LIMIT;
  SEG_ELS.forEach((el,i) => {
    const z = SEG_ZONES[i];
    const fill = ratio > z.start ? Math.min((ratio-z.start)/(z.end-z.start),1)*100 : 0;
    el.style.width = fill + '%';
  });

  EL.pctBadge.style.color = info.color;
  EL.pctBadgeText.textContent = \`\${p.toFixed(1)}% used · \${info.zone}\`;

  EL.threshAlert.className = info.alert ? \`thresh-alert visible \${info.cls}\` : 'thresh-alert';
  if (info.alert) EL.threshAlert.textContent = info.alert;

  EL.sbTokens.textContent = fmt(state.tokensUsed) + ' / 500k';
  EL.sbTokens.style.color = info.color;
  EL.sbPct.textContent = p.toFixed(1) + '%';
  EL.sbPct.style.color = info.color;
  EL.remainCount.textContent = fmt(Math.max(LIMIT - state.tokensUsed, 0));

  const deptPct = p.toFixed(1);
  EL.deptYouBar.style.width = Math.min(p,100) + '%';
  EL.deptYouPct.textContent = deptPct + '%';
}

function updateSession() {
  const total = state.sessionPrompt + state.sessionCompletion;
  EL.sPrompt.textContent = fmt(state.sessionPrompt);
  EL.sCompletion.textContent = fmt(state.sessionCompletion);
  EL.sTotal.textContent = fmt(total);
  EL.sReq.textContent = state.requests;
  EL.sCost.textContent = '$' + state.sessionCost.toFixed(2);
  EL.ctxPct.textContent = (total / 200000 * 100).toFixed(1) + '%';

  const elapsedMin = Math.max((Date.now() - state.startTime) / 60000, 0.1);
  EL.sBurn.textContent = '$' + (state.sessionCost / elapsedMin).toFixed(3) + '/min';

  if (state.tokensUsed > 0) {
    const rate = state.tokensUsed / elapsedMin;
    const minsLeft = Math.round((LIMIT - state.tokensUsed) / rate);
    EL.limitHit.textContent = minsLeft < 60 ? \`~\${minsLeft} min\` : '> 1 hr';
  }
}

function setConnStatus(status) {
  state.connStatus = status;
  const dot = EL.connDot;
  const sb = EL.sbConn;
  if (status === 'connected') {
    dot.className = 'conn-dot live';
    sb.style.color = 'var(--green)';
    EL.sbConnText.textContent = 'CONNECTED';
    EL.connLabel.textContent = 'live';
    EL.connLabel.style.color = 'var(--green)';
  } else if (status === 'error') {
    dot.className = 'conn-dot err';
    sb.style.color = 'var(--red)';
    EL.sbConnText.textContent = 'OFFLINE';
    EL.connLabel.textContent = 'offline';
    EL.connLabel.style.color = 'var(--red)';
  } else {
    dot.className = 'conn-dot';
    sb.style.color = 'var(--amber)';
    EL.sbConnText.textContent = 'CONNECTING';
    EL.connLabel.textContent = 'connecting';
  }
}

function appendLine(tag, tagCls, msg, msgCls) {
  const out = EL.terminalOutput;
  const line = document.createElement('div');
  line.className = 'term-line';
  line.innerHTML = \`<span class="term-time">\${nowStr()}</span><span class="term-tag \${tagCls}">\${tag}</span><span class="term-msg \${msgCls}">\${msg}</span>\`;
  out.appendChild(line);
  out.scrollTop = out.scrollHeight;
}

function appendDivider() {
  const out = EL.terminalOutput;
  const d = document.createElement('div');
  d.className = 'term-divider';
  out.appendChild(d);
  out.scrollTop = out.scrollHeight;
}

function switchModel(key) {
  state.currentModel = key;
  EL.sbModel.textContent = key;
  EL.inputModelLabel.textContent = key;
  document.querySelectorAll('.model-option').forEach(el => {
    el.classList.toggle('active', el.getAttribute('onclick').includes(key));
  });
  appendLine('SYS', 'sys', 'Model preference set to ' + key, 'muted');
  vscode.postMessage({ command: 'switchModel', model: key });
}

function updateInputCost(val) {
  const est = Math.ceil(val.length / 4);
  const model = MODELS[state.currentModel] ?? MODELS['claude-sonnet-4-6'];
  const cost = est * model.inRate / 1000000;
  EL.inputCostHint.textContent = \`~\${est} tokens · ~$\${cost.toFixed(6)}\`;
  EL.inputCostHint.style.color = est > 500 ? 'var(--orange)' : 'var(--text3)';
}

async function bootstrap() {
  try {
    const body = new URLSearchParams({
      grant_type:'client_credentials', client_id:'aira-local',
      client_secret:'aira-secret', scope:'engineering',
    });
    const r = await fetch(OAUTH2, { method:'POST', body });
    if (!r.ok) throw new Error('OAuth2 ' + r.status);
    const { access_token } = await r.json();
    state.bearerToken = access_token;
    setConnStatus('connected');
    appendLine('OK', 'ok', 'Connected to kong-ai-gateway:8000', 'success');
    appendLine('OK', 'ok', 'OIDC bearer validated · scope: engineering', 'success');
  } catch (e) {
    setConnStatus('error');
    appendLine('INFO', 'info', 'Kong gateway offline — start the stack with docker compose up', 'muted');
  }
  appendDivider();
  appendLine('INFO', 'info', 'Session started · model: ' + state.currentModel, 'muted');
  appendLine('SYS', 'sys', 'PII Guard active · 3 rules enforced · ready', 'muted');
}

async function pollBackend() {
  try {
    const today = new Date().toISOString().slice(0,10);
    const [summaryRes, deptRes] = await Promise.all([
      fetch(BACKEND + '/usage/summary?group_by=user_id&session_date=' + today),
      fetch(BACKEND + '/usage/cost/by-department?since=' + today),
    ]);
    const rows    = summaryRes.ok ? await summaryRes.json() : [];
    const deptCost = deptRes.ok  ? await deptRes.json()    : [];

    const arr = Array.isArray(rows) ? rows : [];
    const polledTokens = arr.reduce((a,r)=>a+(r.total_tokens??0),0);
    state.tokensUsed        = Math.max(polledTokens, state.tokensUsed);
    state.sessionPrompt     = Math.max(arr.reduce((a,r)=>a+(r.prompt_tokens??0),0), state.sessionPrompt);
    state.sessionCompletion = Math.max(arr.reduce((a,r)=>a+(r.completion_tokens??0),0), state.sessionCompletion);
    state.sessionCost       = Math.max(arr.reduce((a,r)=>a+(r.total_cost_usd??r.cost_usd??0),0), state.sessionCost);
    state.requests          = Math.max(arr.reduce((a,r)=>a+(r.requests??0),0), state.requests);

    const DEPT_ID = { 'r&d':'rnd', 'engineering':'eng', 'finance':'fin' };
    const deptArr = Array.isArray(deptCost) ? deptCost : [];
    deptArr.forEach(r => {
      if (!r.department) return;
      const pct = ((r.total_tokens ?? 0) / LIMIT) * 100;
      const key = DEPT_ID[r.department.toLowerCase()] ?? r.department.toLowerCase();
      const el    = document.getElementById('dept-' + key + '-bar');
      const pctEl = document.getElementById('dept-' + key + '-pct');
      if (el)    el.style.width = Math.min(pct, 100) + '%';
      if (pctEl) pctEl.textContent = pct.toFixed(1) + '%';
    });

    updateMeter();
    updateSession();
  } catch { /* backend may not be running */ }
}

async function sendPrompt() {
  const input = document.getElementById('user-input');
  const text = input.value.trim();
  if (!text || state.sending) return;
  const estimatedInputTokens = Math.ceil(text.length / 4);
  input.value = '';
  state.sending = true;
  updateInputCost('');

  appendLine('$', 'sys', text, 'user');

  const thinkId = 'think-' + Date.now();
  const out = EL.terminalOutput;
  const thinkEl = document.createElement('div');
  thinkEl.id = thinkId;
  thinkEl.className = 'term-line';
  thinkEl.innerHTML = \`<span class="term-time">\${nowStr()}</span><span class="term-tag info">INFO</span><span class="term-msg thinking">Waiting for response…</span>\`;
  out.appendChild(thinkEl);
  out.scrollTop = out.scrollHeight;

  try {
    const res = await fetch(BACKEND + '/chat', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({
        messages:[{role:'user',content:text}],
        model: state.currentModel,
        max_tokens:1024,
      }),
    });
    document.getElementById(thinkId)?.remove();

    if (res.status === 429) { appendLine('WARN','warn','Rate limit exceeded — token limit reached','danger'); state.sending=false; return; }
    if (res.status === 400) {
      const err = await res.json().catch(()=>({}));
      const msg = err.message ?? err.error?.message ?? 'policy violation';
      const isPii = msg.toLowerCase().includes('pii') || msg.toLowerCase().includes('guard') || msg.toLowerCase().includes('blocked') || msg.toLowerCase().includes('deny');
      appendLine('WARN','warn', isPii ? 'PII Guard blocked: '+msg : 'Kong error 400: '+msg,'danger');
      state.sending=false; return;
    }
    if (!res.ok) { appendLine('WARN','warn','Kong error '+res.status+' — '+res.statusText,'danger'); state.sending=false; return; }

    const data = await res.json();
    const reply = data?.choices?.[0]?.message?.content ?? data?.content?.[0]?.text ?? JSON.stringify(data);
    const promptTok = data?.usage?.input_tokens ?? data?.usage?.prompt_tokens ?? 0;
    const compTok = data?.usage?.output_tokens ?? data?.usage?.completion_tokens ?? 0;

    appendLine('OK', 'ok', reply, 'assistant');

    const actualPrompt = promptTok || estimatedInputTokens;
    const actualComp   = compTok   || Math.ceil(reply.length / 4);
    const model = MODELS[state.currentModel] ?? MODELS['claude-sonnet-4-6'];
    const cost = (actualPrompt * model.inRate + actualComp * model.outRate) / 1000000;
    state.sessionPrompt     += actualPrompt;
    state.sessionCompletion += actualComp;
    state.tokensUsed        += actualPrompt + actualComp;
    state.sessionCost       += cost;
    state.requests++;
    appendLine('INFO','info',\`tokens: \${fmt(actualPrompt + actualComp)} (prompt \${fmt(actualPrompt)} + completion \${fmt(actualComp)}) · cost: $\${cost.toFixed(5)}\`,'muted');
    updateMeter();
    updateSession();
    setTimeout(pollBackend, 3000);
  } catch {
    document.getElementById(thinkId)?.remove();
    appendLine('INFO','info','Kong gateway unreachable — check that the stack is running','muted');
  }
  state.sending = false;
  input.focus();
}

document.getElementById('user-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendPrompt(); }
});

setInterval(() => {
  const d = new Date();
  EL.sbClock.textContent = [d.getHours(),d.getMinutes(),d.getSeconds()].map(n=>String(n).padStart(2,'0')).join(':');
  const sec = Math.floor((Date.now()-state.startTime)/1000);
  EL.sElapsed.textContent = [Math.floor(sec/3600),Math.floor(sec%3600/60),sec%60].map(n=>String(n).padStart(2,'0')).join(':');
}, 1000);

setInterval(pollBackend, 15000);

initEls();
bootstrap();
pollBackend();
</script>
</body>
</html>`;
  }
}

// ---------------------------------------------------------------------------
// Extension activation
// ---------------------------------------------------------------------------

/** @param {vscode.ExtensionContext} context */
function activate(context) {
  const provider = new AiraPanelProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('aira.panel', provider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  // Status bar item — always visible, shows token usage
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = 'aira.openTerminal';
  statusBar.text    = '$(pulse) AIRA  Terminal';
  statusBar.tooltip = 'AIRA Terminal — click to open';
  statusBar.show();
  context.subscriptions.push(statusBar);

  // Open full terminal panel in editor area
  context.subscriptions.push(
    vscode.commands.registerCommand('aira.openTerminal', () => {
      AiraTerminalPanel.createOrShow(context.extensionUri);
    })
  );

  // Toggle sidebar panel
  context.subscriptions.push(
    vscode.commands.registerCommand('aira.togglePanel', () => {
      if (provider.visible) {
        vscode.commands.executeCommand('workbench.action.toggleSidebarVisibility');
      } else {
        vscode.commands.executeCommand('workbench.view.extension.aira-container');
      }
    })
  );

  // Refresh command — re-fetches backend data on demand
  context.subscriptions.push(
    vscode.commands.registerCommand('aira.refreshData', async () => {
      const data = await loadData('praveen.valavan');
      if (data) {
        provider.postData(data);
        statusBar.text = `$(pulse) AIRA  ${data.pct}%`;
        statusBar.tooltip = `AIRA · ${data.currentModel} · ${Number(data.tokensUsed).toLocaleString()} / 500k tokens`;
      }
    })
  );

  // Poll backend every 10 seconds and push data into sidebar webview
  const poll = setInterval(async () => {
    const data = await loadData('praveen.valavan');
    if (data) {
      provider.postData(data);
      statusBar.text    = `$(pulse) AIRA  ${data.pct}%`;
      statusBar.tooltip = `AIRA · ${data.currentModel} · ${Number(data.tokensUsed).toLocaleString()} / 500k tokens`;
    }
  }, POLL_MS);

  context.subscriptions.push({ dispose: () => clearInterval(poll) });
}

function deactivate() {}

module.exports = { activate, deactivate };
