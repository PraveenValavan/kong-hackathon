// @ts-check
'use strict';

const vscode = require('vscode');
const http   = require('http');

const BACKEND  = 'http://localhost:8002';
const LIMIT    = 500000;
const POLL_MS  = 10000;

const MODELS = {
  'gemini-2.5-flash':  { inRate: 0.075, outRate: 0.30  },
  'claude-haiku-4-5':  { inRate: 0.80,  outRate: 4.00  },
  'gpt-4o':            { inRate: 2.50,  outRate: 10.00 },
  'claude-sonnet-4-6': { inRate: 3.00,  outRate: 15.00 },
  'claude-opus-4-7':   { inRate: 15.00, outRate: 75.00 },
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
    const [dashboard, session] = await Promise.all([
      fetchJson(`${BACKEND}/usage/dashboard?user_id=${userId}`),
      fetchJson(`${BACKEND}/usage/sessions?user_id=${userId}&limit=1`),
    ]);

    const hourly = dashboard.hourly_tokens_used ?? 0;
    const deptAvg = dashboard.dept_avg_hourly_pct ?? 38.2;
    const currentModel = dashboard.current_model ?? 'claude-sonnet-4-6';
    const sess = Array.isArray(session) && session[0] ? session[0] : null;

    return {
      live: true,
      tokensUsed:  hourly,
      remaining:   LIMIT - hourly,
      pct:         ((hourly / LIMIT) * 100).toFixed(1),
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
    clearInterval(this._simInterval);
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
      <button class="model-opt" data-model="claude-haiku-4-5" onclick="pickModel('claude-haiku-4-5')">
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
let resetSeconds = 42 * 60 + 17;
let limitHitMins = 28;

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
  const total = d.sessionPrompt + d.sessionCompletion;
  EL.sPrompt.textContent     = fmt(d.sessionPrompt);
  EL.sCompletion.textContent = fmt(d.sessionCompletion);
  EL.sTotal.textContent      = fmt(total);
  EL.sReq.textContent        = d.requests;
  EL.sCost.textContent       = '$' + Number(d.sessionCost).toFixed(2);
}

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
  EL.limitHit.textContent   = limitHitMins < 60 ? \`~\${limitHitMins} min\` : '> 1 hr';
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

  // initial render with mock data
  renderMeter(287441, 212559);
  renderSession({ sessionPrompt:124820, sessionCompletion:71440, sessionCost:3.24, requests:47 });
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
    limitHitMins = d.limitHitMins ?? limitHitMins;
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
  statusBar.command = 'aira.togglePanel';
  statusBar.text    = '$(pulse) AIRA  57%';
  statusBar.tooltip = 'AIRA Terminal — click to toggle panel';
  statusBar.show();
  context.subscriptions.push(statusBar);

  // Toggle command — show if hidden, hide sidebar if visible
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
        statusBar.text = \`$(pulse) AIRA  \${data.pct}%\`;
        statusBar.tooltip = \`AIRA · \${data.currentModel} · \${Number(data.tokensUsed).toLocaleString()} / 500k tokens\`;
      }
    })
  );

  // Poll backend every 10 seconds and push data into webview
  const poll = setInterval(async () => {
    const data = await loadData('praveen.valavan');
    if (data) {
      provider.postData(data);
      statusBar.text    = \`$(pulse) AIRA  \${data.pct}%\`;
      statusBar.tooltip = \`AIRA · \${data.currentModel} · \${Number(data.tokensUsed).toLocaleString()} / 500k tokens\`;
    }
  }, POLL_MS);

  context.subscriptions.push({ dispose: () => clearInterval(poll) });
}

function deactivate() {}

module.exports = { activate, deactivate };
