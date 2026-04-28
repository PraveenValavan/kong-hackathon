import { useState, useEffect, useRef, useCallback } from 'react';

const BACKEND_URL  = 'http://localhost:8002';
const OAUTH2_URL   = 'http://localhost:8080/default/token';
const LIMIT        = 500_000;

const MODEL_COSTS = {
  'gemini-2.5-flash':       { inRate: 0.075, outRate: 0.30,  color: '#22c55e', provider: 'Google',    tag: 'cheapest' },
  'claude-haiku-4-5-20251001': { inRate: 0.80,  outRate: 4.00,  color: '#a855f7', provider: 'Anthropic', tag: null },
  'gpt-4o':                 { inRate: 2.50,  outRate: 10.00, color: '#3b82f6', provider: 'OpenAI',    tag: null },
  'claude-sonnet-4-6':      { inRate: 3.00,  outRate: 15.00, color: '#a855f7', provider: 'Anthropic', tag: null },
  'claude-opus-4-7':        { inRate: 15.00, outRate: 75.00, color: '#f0a500', provider: 'Anthropic', tag: 'premium' },
};

const SEG_ZONES = [
  { start: 0,   end: 0.4 },
  { start: 0.4, end: 0.6 },
  { start: 0.6, end: 0.8 },
  { start: 0.8, end: 0.9 },
  { start: 0.9, end: 1.0 },
];

const THRESH_TABLE = [
  { min: 90, cls: 'critical', color: '#dc2626', zone: 'CRITICAL',    alert: '🚨 90% critical — requests will be throttled shortly' },
  { min: 80, cls: 'danger',   color: '#ef4444', zone: 'danger zone', alert: '⚠ 80% threshold — high usage detected' },
  { min: 60, cls: 'caution',  color: '#f97316', zone: 'caution zone',alert: '⚡ 60% — consider switching to a cheaper model' },
  { min: 40, cls: 'warn',     color: '#f0a500', zone: 'watch zone',  alert: '● 40% threshold — monitoring usage' },
  { min: 0,  cls: 'safe',     color: '#22c55e', zone: 'normal',      alert: '' },
];

function threshInfo(p) { return THRESH_TABLE.find(t => p >= t.min); }
function fmt(n) { return Math.round(n).toLocaleString(); }
function nowStr() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
}

// ── Styles ────────────────────────────────────────────────────────────────────
const S = {
  wrap: {
    display:'flex', flexDirection:'column', flex:1, minHeight:0,
    fontFamily:"'IBM Plex Mono', monospace", fontSize:12,
    background:'#0c0c0e', color:'#e8e8ec', overflow:'hidden',
  },
  body: { flex:1, display:'flex', overflow:'hidden' },
  gutter: {
    width:38, background:'#0a0a0c', borderRight:'1px solid #2a2a32',
    display:'flex', flexDirection:'column', alignItems:'center',
    padding:'12px 0', gap:14, flexShrink:0,
  },
  gutterLine: { width:1, flex:1, background:'#2a2a32' },
  gutterNum: { fontSize:9, color:'#55555f', writingMode:'vertical-rl', letterSpacing:2 },
  mainPane: { flex:1, display:'flex', flexDirection:'column', overflow:'hidden' },
  chatLayout: { flex:1, display:'flex', overflow:'hidden' },
  termArea: { flex:1, display:'flex', flexDirection:'column', overflow:'hidden', borderRight:'1px solid #2a2a32' },
  termOutput: {
    flex:1, overflowY:'auto', padding:'16px 20px',
    display:'flex', flexDirection:'column', gap:4,
    scrollbarWidth:'thin', scrollbarColor:'#38383f transparent',
  },
  termLine: { fontSize:12, lineHeight:1.7, color:'#9898a8', display:'flex', gap:10 },
  termTime: { color:'#55555f', flexShrink:0, minWidth:58 },
  termTag: (type) => ({
    flexShrink:0, fontSize:10, padding:'1px 5px', borderRadius:3,
    marginTop:2, height:'fit-content',
    ...(type==='ok'   && { background:'rgba(34,197,94,0.15)',  color:'#22c55e' }),
    ...(type==='sys'  && { background:'rgba(240,165,0,0.12)',  color:'#f0a500' }),
    ...(type==='warn' && { background:'rgba(239,68,68,0.15)',  color:'#ef4444' }),
    ...(type==='info' && { background:'rgba(59,130,246,0.15)', color:'#3b82f6' }),
  }),
  termMsg: (variant) => ({
    ...(variant==='highlight' && { color:'#e8e8ec' }),
    ...(variant==='muted'     && { color:'#55555f' }),
    ...(variant==='success'   && { color:'#22c55e' }),
    ...(variant==='danger'    && { color:'#ef4444' }),
    ...(variant==='caution'   && { color:'#f97316' }),
    ...(variant==='user'      && { color:'#f0a500' }),
    ...(variant==='assistant' && { color:'#e8e8ec' }),
    ...(variant==='thinking'  && { color:'#55555f', fontStyle:'italic' }),
  }),
  termDivider: { height:1, background:'#2a2a32', margin:'8px 0' },
  inputBar: {
    height:50, borderTop:'1px solid #2a2a32', display:'flex',
    alignItems:'center', padding:'0 16px', gap:10, background:'#0c0c0e', flexShrink:0,
  },
  inputPrompt: { fontSize:12, color:'#f0a500', whiteSpace:'nowrap', display:'flex', alignItems:'center', gap:6 },
  inputModelLabel: { fontSize:10, color:'#55555f', border:'1px solid #38383f', padding:'1px 6px', borderRadius:3 },
  inputField: {
    flex:1, background:'none', border:'none', outline:'none',
    fontFamily:"'IBM Plex Mono', monospace", fontSize:12, color:'#e8e8ec', caretColor:'#f0a500',
  },
  inputCost: { fontSize:10, color:'#55555f', whiteSpace:'nowrap', transition:'color 0.3s' },
  sidebar: {
    width:240, flexShrink:0, overflowY:'auto', padding:0,
    display:'flex', flexDirection:'column',
    scrollbarWidth:'thin', scrollbarColor:'#38383f transparent',
    background:'#111113', borderLeft:'1px solid #2a2a32',
  },
  meterSection: { padding:'14px 14px 12px', borderBottom:'1px solid #2a2a32' },
  dataSection: { padding:'10px 14px', borderBottom:'1px solid #2a2a32' },
  sectionLabel: { fontSize:8, letterSpacing:'1.5px', textTransform:'uppercase', color:'#55555f', marginBottom:7 },
  kvRow: { display:'flex', justifyContent:'space-between', alignItems:'baseline', padding:'2px 0', fontSize:11 },
  kvKey: { color:'#55555f' },
  kvVal: (accent, warn) => ({ color: accent ? '#f0a500' : warn ? '#f97316' : '#9898a8', fontVariantNumeric:'tabular-nums' }),
  tokenBig: (color) => ({ fontSize:24, fontWeight:600, color, letterSpacing:-1, lineHeight:1, fontVariantNumeric:'tabular-nums', transition:'color 0.4s' }),
  tokenOf: { fontSize:10, color:'#55555f', marginTop:2, marginBottom:10 },
  segBarWrap: { position:'relative', marginBottom:18 },
  segBar: { height:10, background:'#222228', borderRadius:3, overflow:'hidden', display:'flex' },
  pctBadge: (color) => ({ display:'inline-flex', alignItems:'center', gap:5, fontSize:11, fontWeight:500, color }),
  threshAlert: (cls, visible) => ({
    marginTop:6, padding:'5px 8px', borderRadius:3, fontSize:10,
    display: visible ? 'flex' : 'none', alignItems:'center', gap:6,
    ...(cls==='caution'  && { background:'rgba(249,115,22,0.12)',  color:'#f97316', border:'1px solid rgba(249,115,22,0.2)' }),
    ...(cls==='danger'   && { background:'rgba(239,68,68,0.12)',   color:'#ef4444', border:'1px solid rgba(239,68,68,0.2)' }),
    ...(cls==='critical' && { background:'rgba(220,38,38,0.15)',   color:'#dc2626', border:'1px solid rgba(220,38,38,0.3)' }),
    ...(cls==='warn'     && { background:'rgba(240,165,0,0.12)',   color:'#f0a500', border:'1px solid rgba(240,165,0,0.2)' }),
  }),
  modelList: { display:'flex', flexDirection:'column', gap:1 },
  modelOption: (active) => ({
    display:'flex', alignItems:'center', gap:7, padding:'4px 6px', borderRadius:3,
    cursor:'pointer', fontSize:11,
    color: active ? '#9898a8' : '#55555f',
    background: active ? '#18181c' : 'none',
  }),
  modelTag: (type) => ({
    marginLeft:'auto', fontSize:8, padding:'1px 4px', borderRadius:2,
    ...(type==='cheap'   && { color:'#22c55e', opacity:0.7 }),
    ...(type==='premium' && { color:'#f0a500', opacity:0.7 }),
  }),
  deptRow: (isYou) => ({
    display:'flex', alignItems:'center', gap:8, marginBottom:5,
  }),
  statusBar: {
    height:26, background:'#080809', borderTop:'1px solid #2a2a32',
    display:'flex', alignItems:'center', padding:'0 14px', gap:0,
    fontSize:10, color:'#55555f', flexShrink:0,
  },
  sbItem: (last) => ({
    display:'flex', alignItems:'center', gap:5, padding:'0 10px',
    borderRight: last ? 'none' : '1px solid #2a2a32', height:'100%',
    ...(last && { marginLeft:'auto', paddingRight:0 }),
  }),
  connDot: { width:8, height:8, borderRadius:'50%' },
};

// ── Component ──────────────────────────────────────────────────────────────────
export default function Terminal({ currentRole }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [connStatus, setConnStatus] = useState('connecting'); // connecting | connected | error
  const [bearerToken, setBearerToken] = useState(null);
  const [currentModel, setCurrentModel] = useState('claude-sonnet-4-6');
  const [startTime] = useState(Date.now());
  const [clock, setClock] = useState(nowStr());
  const [elapsed, setElapsed] = useState('00:00:00');

  // Live usage stats from backend
  const [usage, setUsage] = useState({
    tokensUsed: 0, sessionPrompt: 0, sessionCompletion: 0,
    requests: 0, sessionCost: 0, depts: {},
  });

  const outputRef = useRef(null);
  const inputRef = useRef(null);

  const scrollBottom = useCallback(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, []);

  const addMessage = useCallback((role, content, variant, tag = 'info') => {
    const msg = { id: Date.now() + Math.random(), role, content, variant, tag, ts: nowStr() };
    setMessages(prev => [...prev, msg]);
    setTimeout(scrollBottom, 50);
    return msg;
  }, [scrollBottom]);

  // ── Bootstrap: OAuth2 token + initial backend poll ──────────────────────────
  useEffect(() => {
    async function bootstrap() {
      // Map role to oauth2 scope
      const scopeMap = { admin: 'engineering', engineering: 'engineering', finops: 'finops' };
      const scope = scopeMap[currentRole] ?? 'engineering';

      try {
        const body = new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: 'aira-local',
          client_secret: 'aira-secret',
          scope,
        });
        const r = await fetch(OAUTH2_URL, { method: 'POST', body });
        if (!r.ok) throw new Error(`OAuth2 ${r.status}`);
        const { access_token } = await r.json();
        setBearerToken(access_token);
        setConnStatus('connected');
        addMessage('sys', `Connected to kong-ai-gateway:8000 · route /chat`, 'success', 'ok');
        addMessage('sys', `OIDC bearer validated · scope: ${scope}`, 'success', 'ok');
      } catch (e) {
        setConnStatus('error');
        addMessage('sys', `Kong connection failed: ${e.message} — running in offline mode`, 'danger', 'warn');
      }
    }
    bootstrap();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRole]);

  // ── Poll backend for live usage stats ───────────────────────────────────────
  const pollUsage = useCallback(async () => {
    try {
      const since = new Date(Date.now() - 3600_000).toISOString().slice(0, 10);
      const [summaryRes, deptRes] = await Promise.all([
        fetch(`${BACKEND_URL}/usage/summary?group_by=user_id&since=${since}`),
        fetch(`${BACKEND_URL}/usage/cost/by-department?since=${since}`),
      ]);
      const summary  = summaryRes.ok  ? await summaryRes.json()  : [];
      const deptCost = deptRes.ok     ? await deptRes.json()     : [];

      const totalTokens     = (summary ?? []).reduce((a, r) => a + (r.total_tokens  ?? 0), 0);
      const totalPrompt     = (summary ?? []).reduce((a, r) => a + (r.prompt_tokens  ?? 0), 0);
      const totalCompletion = (summary ?? []).reduce((a, r) => a + (r.completion_tokens ?? 0), 0);
      const totalCost       = (summary ?? []).reduce((a, r) => a + (r.cost_usd ?? 0), 0);
      const totalReqs       = (summary ?? []).reduce((a, r) => a + (r.requests ?? 0), 0);

      const depts = {};
      (deptCost ?? []).forEach(r => {
        if (r.department) {
          depts[r.department] = { totalTokens: r.total_tokens ?? 0, pct: ((r.total_tokens ?? 0) / LIMIT) * 100 };
        }
      });

      setUsage(prev => ({
        tokensUsed: Math.max(totalTokens, prev.tokensUsed),
        sessionPrompt: Math.max(totalPrompt, prev.sessionPrompt),
        sessionCompletion: Math.max(totalCompletion, prev.sessionCompletion),
        requests: Math.max(totalReqs, prev.requests),
        sessionCost: Math.max(totalCost, prev.sessionCost),
        depts,
      }));
    } catch {
      // silently ignore — local state is already updated from responses
    }
  }, []);

  useEffect(() => {
    pollUsage();
    const t = setInterval(pollUsage, 15_000);
    return () => clearInterval(t);
  }, [pollUsage]);

  // ── Clock & elapsed ──────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => {
      setClock(nowStr());
      const sec = Math.floor((Date.now() - startTime) / 1000);
      const h = String(Math.floor(sec / 3600)).padStart(2,'0');
      const m = String(Math.floor((sec % 3600) / 60)).padStart(2,'0');
      const s = String(sec % 60).padStart(2,'0');
      setElapsed(`${h}:${m}:${s}`);
    }, 1000);
    return () => clearInterval(t);
  }, [startTime]);

  // ── Initial boot messages ────────────────────────────────────────────────────
  useEffect(() => {
    setTimeout(() => addMessage('sys', `Session started · model: ${currentModel}`, 'muted', 'info'), 600);
    setTimeout(() => addMessage('sys', `PII Guard active · 3 rules enforced · ready`, 'muted', 'sys'), 900);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Send prompt to Kong ───────────────────────────────────────────────────────
  const sendPrompt = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    setSending(true);

    addMessage('user', `$ ${text}`, 'user', 'sys');

    const thinkingId = Date.now();
    setMessages(prev => [...prev, { id: thinkingId, role:'sys', content:'Waiting for response…', variant:'thinking', tag:'info', ts: nowStr() }]);
    setTimeout(scrollBottom, 50);

    // Always route through backend — it handles all providers (Anthropic/OpenAI/Google)
    const endpoint = `${BACKEND_URL}/chat`;
    const headers = { 'Content-Type': 'application/json' };

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          messages: [{ role: 'user', content: text }],
          model: currentModel,
          max_tokens: 1024,
        }),
      });

      // Remove thinking line
      setMessages(prev => prev.filter(m => m.id !== thinkingId));

      if (res.status === 429) {
        addMessage('sys', 'Rate limit exceeded — token limit reached for this hour', 'danger', 'warn');
        setSending(false);
        return;
      }
      if (res.status === 400) {
        const err = await res.json().catch(() => ({}));
        addMessage('sys', `PII Guard blocked request: ${err.message ?? 'policy violation'}`, 'danger', 'warn');
        setSending(false);
        return;
      }
      if (!res.ok) {
        addMessage('sys', `Kong error ${res.status} — ${res.statusText}`, 'danger', 'warn');
        setSending(false);
        return;
      }

      const data = await res.json();
      const reply = data?.choices?.[0]?.message?.content ?? data?.content?.[0]?.text ?? JSON.stringify(data);
      const usedTokens = data?.usage?.total_tokens ?? 0;
      const promptTokens = data?.usage?.input_tokens ?? data?.usage?.prompt_tokens ?? 0;
      const completionTokens = data?.usage?.output_tokens ?? data?.usage?.completion_tokens ?? 0;

      addMessage('assistant', reply, 'assistant', 'ok');

      if (promptTokens || completionTokens) {
        const modelCosts = MODEL_COSTS[currentModel] ?? MODEL_COSTS['claude-sonnet-4-6'];
        const cost = (promptTokens * modelCosts.inRate + completionTokens * modelCosts.outRate) / 1_000_000;
        addMessage('sys', `tokens: ${fmt(usedTokens)} (prompt ${fmt(promptTokens)} + completion ${fmt(completionTokens)}) · cost: $${cost.toFixed(5)}`, 'muted', 'info');

        // Update sidebar immediately without waiting for next poll
        setUsage(prev => ({
          ...prev,
          tokensUsed:        prev.tokensUsed        + promptTokens + completionTokens,
          sessionPrompt:     prev.sessionPrompt     + promptTokens,
          sessionCompletion: prev.sessionCompletion + completionTokens,
          requests:          prev.requests          + 1,
          sessionCost:       prev.sessionCost       + cost,
        }));
      }

      // Refresh from backend after a short delay for http-log propagation
      setTimeout(pollUsage, 3000);
    } catch {
      setMessages(prev => prev.filter(m => m.id !== thinkingId));
      addMessage('sys', 'Kong gateway unreachable — check that the stack is running', 'caution', 'info');
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }, [input, sending, bearerToken, currentModel, startTime, addMessage, scrollBottom, pollUsage]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendPrompt(); }
  };

  const switchModel = (key) => {
    setCurrentModel(key);
    addMessage('sys', `Model preference set to ${key} · next request will use this model`, 'muted', 'sys');
  };

  // ── Derived meter values ────────────────────────────────────────────────────
  const pctRaw = (usage.tokensUsed / LIMIT) * 100;
  const info = threshInfo(pctRaw);
  const model = MODEL_COSTS[currentModel] ?? MODEL_COSTS['claude-sonnet-4-6'];
  const estimatedTokens = Math.ceil(input.length / 4);
  const inputCost = estimatedTokens * model.inRate / 1_000_000;

  const elapsedMin = Math.max((Date.now() - startTime) / 60_000, 0.1);
  const burnRate = usage.sessionCost > 0 ? (usage.sessionCost / elapsedMin).toFixed(3) : '0.000';
  const limitHitMins = usage.tokensUsed > 0
    ? Math.round((LIMIT - usage.tokensUsed) / (usage.tokensUsed / elapsedMin))
    : null;

  return (
    <div style={S.wrap}>
      {/* BODY */}
      <div style={S.body}>
        {/* LEFT GUTTER */}
        <div style={S.gutter}>
          <div style={{
            ...S.connDot,
            background: connStatus==='connected' ? '#22c55e' : connStatus==='error' ? '#ef4444' : '#f0a500',
            boxShadow: `0 0 6px ${connStatus==='connected' ? '#22c55e' : connStatus==='error' ? '#ef4444' : '#f0a500'}`,
          }} />
          <div style={S.gutterLine} />
          <div style={S.gutterNum}>AIRA</div>
          <div style={S.gutterLine} />
        </div>

        {/* MAIN PANE */}
        <div style={S.mainPane}>

            <div style={S.chatLayout}>
              {/* Terminal output */}
              <div style={S.termArea}>
                <div style={S.termOutput} ref={outputRef}>
                  {messages.map(m => (
                    <div key={m.id} style={S.termLine}>
                      <span style={S.termTime}>{m.ts}</span>
                      <span style={S.termTag(m.tag)}>{m.tag.toUpperCase()}</span>
                      <span style={S.termMsg(m.variant)}>{m.content}</span>
                    </div>
                  ))}
                  {messages.length > 0 && <div style={S.termDivider} />}
                </div>

                {/* Input bar */}
                <div style={S.inputBar}>
                  <div style={S.inputPrompt}>
                    $
                    <span style={S.inputModelLabel}>{currentModel}</span>
                    ›
                  </div>
                  <input
                    ref={inputRef}
                    style={S.inputField}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={sending ? 'Waiting for response…' : 'Type your prompt here…'}
                    disabled={sending}
                  />
                  <span style={{ ...S.inputCost, color: estimatedTokens > 500 ? '#f97316' : '#55555f' }}>
                    ~{estimatedTokens} tokens · ~${inputCost.toFixed(6)}
                  </span>
                </div>
              </div>

              {/* ── RIGHT SIDEBAR ── */}
              <div style={S.sidebar}>
                {/* Token meter */}
                <div style={S.meterSection}>
                  <div style={S.tokenBig(info.color)}>{fmt(usage.tokensUsed)}</div>
                  <div style={S.tokenOf}>of 500,000 tokens / hr</div>
                  <div style={S.segBarWrap}>
                    <div style={S.segBar}>
                      {SEG_ZONES.map((z, i) => {
                        const ratio = usage.tokensUsed / LIMIT;
                        const fill = ratio > z.start ? Math.min((ratio - z.start) / (z.end - z.start), 1) * 100 : 0;
                        const colors = ['#22c55e','#f0a500','#f97316','#ef4444','#dc2626'];
                        return <div key={i} style={{ height:'100%', width:`${fill}%`, background:colors[i], transition:'width 0.8s ease' }} />;
                      })}
                    </div>
                  </div>
                  <div style={S.pctBadge(info.color)}>
                    <div style={{ width:6, height:6, borderRadius:'50%', background:'currentColor' }} />
                    {pctRaw.toFixed(1)}% used · {info.zone}
                  </div>
                  {info.alert && (
                    <div style={S.threshAlert(info.cls, true)}>{info.alert}</div>
                  )}
                </div>

                {/* Session stats */}
                <div style={S.dataSection}>
                  <div style={S.sectionLabel}>Session</div>
                  {[
                    ['prompt',      fmt(usage.sessionPrompt),           false, false],
                    ['completion',  fmt(usage.sessionCompletion),        false, false],
                    ['total',       fmt(usage.sessionPrompt + usage.sessionCompletion), true, false],
                    ['requests',    usage.requests,                      false, false],
                    ['cost',        `$${usage.sessionCost.toFixed(2)}`,  true,  false],
                    ['burn rate',   `$${burnRate}/min`,                  false, true ],
                    ['elapsed',     elapsed,                             false, false],
                  ].map(([k, v, accent, warn]) => (
                    <div key={k} style={S.kvRow}>
                      <span style={S.kvKey}>{k}</span>
                      <span style={S.kvVal(accent, warn)}>{v}</span>
                    </div>
                  ))}
                  <div style={{ ...S.kvRow, marginTop:6 }}>
                    <span style={S.kvKey}>remaining</span>
                    <span style={S.kvVal(false, false)}>{fmt(Math.max(LIMIT - usage.tokensUsed, 0))}</span>
                  </div>
                  <div style={S.kvRow}>
                    <span style={S.kvKey}>limit hit in</span>
                    <span style={S.kvVal(false, true)}>{limitHitMins ? `~${limitHitMins} min` : '> 1 hr'}</span>
                  </div>
                </div>

                {/* Model switcher */}
                <div style={S.dataSection}>
                  <div style={S.sectionLabel}>Switch Model</div>
                  <div style={S.modelList}>
                    {Object.entries(MODEL_COSTS).map(([key, m]) => (
                      <div
                        key={key}
                        style={S.modelOption(currentModel === key)}
                        onClick={() => switchModel(key)}
                      >
                        <div style={{ width:5, height:5, borderRadius:'50%', background:m.color, flexShrink:0 }} />
                        <span style={{ flex:1 }}>{key}</span>
                        {m.tag && <span style={S.modelTag(m.tag === 'cheapest' ? 'cheap' : 'premium')}>{m.tag}</span>}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Dept comparison */}
                <div style={S.dataSection}>
                  <div style={S.sectionLabel}>Dept usage · this hour</div>
                  {[
                    { label:'You',  pct: pctRaw,                                  color:'#f97316', isYou:true },
                    { label:'R&D',  pct: usage.depts['R&D']?.pct ?? 0,            color:'#555560', isYou:false },
                    { label:'Eng',  pct: usage.depts['Engineering']?.pct ?? 0,    color:'#555560', isYou:false },
                    { label:'Fin',  pct: usage.depts['Finance']?.pct ?? 0,        color:'#555560', isYou:false },
                  ].map(({ label, pct, color, isYou }) => (
                    <div key={label} style={{ display:'flex', alignItems:'center', gap:8, marginBottom:5 }}>
                      <div style={{ width:52, color: isYou ? '#9898a8' : '#55555f', flexShrink:0, fontSize:10 }}>{label}</div>
                      <div style={{ flex:1, height:4, background:'#222228', borderRadius:2, overflow:'hidden' }}>
                        <div style={{ height:'100%', width:`${Math.min(pct,100)}%`, background:color, borderRadius:2 }} />
                      </div>
                      <div style={{ width:28, textAlign:'right', color: isYou ? '#f97316' : '#55555f', fontSize:10, flexShrink:0 }}>{pct.toFixed(1)}%</div>
                    </div>
                  ))}
                </div>

                {/* Ambient status */}
                <div style={{ fontSize:10, color:'#55555f', display:'flex', flexWrap:'wrap', gap:'6px 10px', padding:'8px 14px', borderTop:'1px solid #2a2a32' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                    <div style={{ width:5, height:5, borderRadius:'50%', background:'#22c55e' }} />PII guard
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                    <div style={{ width:5, height:5, borderRadius:'50%', background:'#3b82f6' }} />ctx {((usage.sessionPrompt + usage.sessionCompletion) / 200_000 * 100).toFixed(1)}%
                  </div>
                  <div style={{ color:'#55555f' }}>
                    {connStatus === 'connected' ? 'live' : connStatus === 'error' ? 'offline' : 'connecting'}
                  </div>
                </div>
              </div>
            </div>
        </div>
      </div>

      {/* STATUS BAR */}
      <div style={S.statusBar}>
        <div style={S.sbItem(false)}>
          <span style={{ color: connStatus==='connected' ? '#22c55e' : '#ef4444' }}>◉</span>
          <span>{connStatus.toUpperCase()}</span>
        </div>
        <div style={S.sbItem(false)}>
          <span style={{ color:'#9898a8' }}>{currentModel}</span>
        </div>
        <div style={S.sbItem(false)}>
          <span style={{ color: info.color, fontVariantNumeric:'tabular-nums' }}>{fmt(usage.tokensUsed)} / 500k</span>
        </div>
        <div style={S.sbItem(false)}>
          <span style={{ padding:'1px 6px', borderRadius:2, fontWeight:500, background:`${info.color}1e`, color:info.color }}>
            {pctRaw.toFixed(1)}%
          </span>
        </div>
        <div style={{ ...S.sbItem(false), borderRight:'1px solid #2a2a32' }}>
          <span style={{ color:'#55555f' }}>dept: R&D</span>
        </div>
        <div style={S.sbItem(true)}>
          <span style={{ color:'#9898a8', fontVariantNumeric:'tabular-nums' }}>{clock}</span>
        </div>
      </div>
    </div>
  );
}
