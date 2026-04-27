const W = 820, H = 140, PAD = 20, TOP = 10, BOT = 120, MAX_V = 280;

function xScale(i, len) { return PAD + (i / Math.max(len - 1, 1)) * (W - PAD * 2); }
function yScale(v) { return TOP + (BOT - TOP) * (1 - Math.min(v, MAX_V) / MAX_V); }

function linePath(values) {
  if (!values.length) return '';
  return values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i, values.length).toFixed(1)},${yScale(v).toFixed(1)}`).join(' ');
}

function areaPath(values) {
  if (!values.length) return '';
  const line = linePath(values);
  const last = values.length - 1;
  return `${line} L ${xScale(last, values.length).toFixed(1)},${BOT} L ${PAD},${BOT} Z`;
}

export function SpendLineChart({ byDay }) {
  const costs = (byDay ?? []).map(d => d.cost_usd ?? 0);

  return (
    <svg className="chart" width="100%" height="140" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="amberGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f0a500" stopOpacity="0.3"/>
          <stop offset="100%" stopColor="#f0a500" stopOpacity="0"/>
        </linearGradient>
      </defs>
      <line x1="0" y1="35" x2={W} y2="35" stroke="#2a2a32" strokeWidth="1"/>
      <line x1="0" y1="70" x2={W} y2="70" stroke="#2a2a32" strokeWidth="1"/>
      <line x1="0" y1="105" x2={W} y2="105" stroke="#2a2a32" strokeWidth="1"/>
      <text x="0" y="33" fill="#555560" fontSize="9" fontFamily="IBM Plex Mono">$250</text>
      <text x="0" y="68" fill="#555560" fontSize="9" fontFamily="IBM Plex Mono">$150</text>
      <text x="0" y="103" fill="#555560" fontSize="9" fontFamily="IBM Plex Mono">$50</text>
      {costs.length > 0 && (
        <>
          <path d={areaPath(costs)} fill="url(#amberGrad)" opacity="0.15"/>
          <path d={linePath(costs)} fill="none" stroke="#f0a500" strokeWidth="2"/>
        </>
      )}
      <line x1={PAD} y1="21" x2={W - 20} y2="21" stroke="#ef4444" strokeWidth="1" strokeDasharray="4,4" opacity="0.6"/>
      <text x={W - 16} y="24" fill="#ef4444" fontSize="8" fontFamily="IBM Plex Mono">cap</text>
    </svg>
  );
}

export function BarChart({ models }) {
  const data = (models ?? []).slice(0, 4);
  const maxV = Math.max(...data.map(d => d.requests ?? 0), 1);
  const colors = ['#f0a500', '#3b82f6', '#a855f7', '#22c55e'];

  const VW = 380, VH = 130;
  const PAD_L = 12, PAD_R = 12, PAD_TOP = 22, PAD_BOT = 26;
  const chartW = VW - PAD_L - PAD_R;
  const chartH = VH - PAD_TOP - PAD_BOT;
  const n = data.length || 1;
  const slotW = chartW / n;
  const barW = Math.min(52, slotW * 0.48);
  const baseY = PAD_TOP + chartH;

  return (
    <svg className="chart" width="100%" height="130" viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="none">
      <line x1={PAD_L} y1={baseY} x2={VW - PAD_R} y2={baseY} stroke="#2a2a32" strokeWidth="1"/>
      {data.map((d, i) => {
        const h = Math.max((d.requests / maxV) * chartH, 2);
        const cx = PAD_L + (i + 0.5) * slotW;
        const x = cx - barW / 2;
        const y = baseY - h;
        const label = (d.model ?? '').split('-').slice(-1)[0];
        return (
          <g key={d.model ?? i}>
            <rect x={x} y={y} width={barW} height={h} rx="2" fill={colors[i % colors.length]} opacity="0.85"/>
            <text x={cx} y={baseY + 14} textAnchor="middle" fill="#555560" fontSize="8" fontFamily="IBM Plex Mono">{label}</text>
            <text x={cx} y={y - 5} textAnchor="middle" fill={colors[i % colors.length]} fontSize="9" fontFamily="Syne,sans-serif" fontWeight="700">
              {d.requests > 999 ? `${(d.requests / 1000).toFixed(1)}k` : d.requests}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function DonutChart({ byProvider }) {
  const items = byProvider ?? [];
  const total = items.reduce((s, d) => s + (d.total_tokens ?? 0), 0);
  const colors = { anthropic: '#a855f7', openai: '#3b82f6', google: '#f0a500', gemini: '#f0a500' };

  // Fixed square SVG — never use preserveAspectRatio="none" on circles
  const R = 42, CX = 56, CY = 56, SIZE = 112;
  const circ = 2 * Math.PI * R;
  let offset = 0;
  const slices = items.map(d => {
    const pct = total > 0 ? (d.total_tokens ?? 0) / total : 0;
    const dash = pct * circ;
    const s = { ...d, dash, offset, pct };
    offset += dash;
    return s;
  });

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} style={{ flexShrink: 0 }}>
        <circle cx={CX} cy={CY} r={R} fill="none" stroke="#1a1a20" strokeWidth="16"/>
        {slices.map((s, i) => (
          <circle key={i} cx={CX} cy={CY} r={R} fill="none"
            stroke={colors[s.provider] ?? '#555560'}
            strokeWidth="16"
            strokeDasharray={`${s.dash} ${circ - s.dash}`}
            strokeDashoffset={-s.offset}
            transform={`rotate(-90 ${CX} ${CY})`}
          />
        ))}
        <text x={CX} y={CY - 5} textAnchor="middle" fill="#e8e8ec" fontFamily="Syne,sans-serif" fontSize="13" fontWeight="700">
          {total > 1_000_000 ? `${(total / 1_000_000).toFixed(1)}M` : total.toLocaleString()}
        </text>
        <text x={CX} y={CY + 9} textAnchor="middle" fill="#555560" fontFamily="IBM Plex Mono" fontSize="8">tokens</text>
      </svg>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {slices.map((s, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ fontSize: 9, color: '#9898a8', fontFamily: 'IBM Plex Mono' }}>{s.provider}</span>
            <span style={{ fontSize: 15, fontWeight: 700, fontFamily: 'Syne,sans-serif', color: colors[s.provider] ?? '#555560' }}>
              {Math.round(s.pct * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
