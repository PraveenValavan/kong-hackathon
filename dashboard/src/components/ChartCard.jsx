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
  const data = models ?? [];
  const maxV = Math.max(...data.map(d => d.requests ?? 0), 1);
  const barW = 60, gap = 40, startX = 40;
  const colors = ['#f0a500', '#3b82f6', '#a855f7', '#22c55e'];

  return (
    <svg className="chart" width="100%" height="120" viewBox="0 0 380 120" preserveAspectRatio="none">
      {data.slice(0, 4).map((d, i) => {
        const h = Math.max((d.requests / maxV) * 95, 2);
        const x = startX + i * (barW + gap);
        const y = 110 - h;
        const label = (d.model ?? '').split('-').slice(-1)[0];
        return (
          <g key={d.model ?? i}>
            <rect x={x} y={y} width={barW} height={h} rx="2" fill={colors[i]} opacity="0.8"/>
            <text x={x + barW / 2} y="108" textAnchor="middle" fill="#555560" fontSize="8" fontFamily="IBM Plex Mono">{label}</text>
            <text x={x + barW / 2} y={y - 4} textAnchor="middle" fill={colors[i]} fontSize="9" fontFamily="Syne,sans-serif" fontWeight="700">
              {d.requests > 999 ? `${(d.requests / 1000).toFixed(1)}k` : d.requests}
            </text>
          </g>
        );
      })}
      <line x1="0" y1="110" x2="380" y2="110" stroke="#2a2a32" strokeWidth="1"/>
    </svg>
  );
}

export function DonutChart({ byProvider }) {
  const items = byProvider ?? [];
  const total = items.reduce((s, d) => s + (d.total_tokens ?? 0), 0);
  const colors = { anthropic: '#a855f7', openai: '#3b82f6', google: '#f0a500', gemini: '#f0a500' };
  const R = 45, cx = 60, cy = 60, circ = 2 * Math.PI * R;
  let offset = 0;
  const slices = items.map(d => {
    const pct = total > 0 ? (d.total_tokens ?? 0) / total : 0;
    const dash = pct * circ;
    const slice = { ...d, dash, offset, pct };
    offset += dash;
    return slice;
  });

  return (
    <svg className="chart" width="100%" height="120" viewBox="0 0 380 120" preserveAspectRatio="none">
      <circle cx={cx} cy={cy} r={R} fill="none" stroke="#1a1a20" strokeWidth="18"/>
      {slices.map((s, i) => (
        <circle key={i} cx={cx} cy={cy} r={R} fill="none"
          stroke={colors[s.provider] ?? '#555560'}
          strokeWidth="18"
          strokeDasharray={`${s.dash} ${circ - s.dash}`}
          strokeDashoffset={-s.offset}
          transform={`rotate(-90 ${cx} ${cy})`}
        />
      ))}
      <text x={cx} y="57" textAnchor="middle" fill="#e8e8ec" fontFamily="Syne,sans-serif" fontSize="13" fontWeight="700">
        {total > 1_000_000 ? `${(total / 1_000_000).toFixed(1)}M` : total}
      </text>
      <text x={cx} y="70" textAnchor="middle" fill="#555560" fontFamily="IBM Plex Mono" fontSize="8">tokens</text>
      {slices.slice(0, 3).map((s, i) => {
        const cols = [135, 135, 230];
        const rows = [30, 70, 30];
        return (
          <g key={i}>
            <text x={cols[i]} y={rows[i]} fill="#9898a8" fontFamily="IBM Plex Mono" fontSize="9">{s.provider}</text>
            <text x={cols[i]} y={rows[i] + 13} fill={colors[s.provider] ?? '#555560'} fontFamily="Syne,sans-serif" fontSize="14" fontWeight="700">
              {Math.round(s.pct * 100)}%
            </text>
          </g>
        );
      })}
    </svg>
  );
}
