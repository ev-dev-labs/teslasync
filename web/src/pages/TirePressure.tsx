import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getVehicles, getTirePressure } from '../api'
import { PageHeader, GlassPanel, FadeIn, Skeleton } from '../components/ui'
import { Gauge, AlertTriangle, CheckCircle, TrendingDown, TrendingUp } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import clsx from 'clsx'
import { useSettings } from '../hooks/useSettings'

interface TooltipPayload { name: string; value: number; color?: string }
function ChartTooltip({ active, payload, label, unit = 'PSI' }: { active?: boolean; payload?: TooltipPayload[]; label?: string; unit?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="glass-panel p-3 text-xs" style={{ background: 'var(--surface-2)', borderColor: 'var(--glass-border)' }}>
      <p style={{ color: 'var(--text-secondary)' }} className="mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: 'var(--text-primary)' }}>
          <span style={{ color: p.color }}>●</span> {p.name}: {p.value?.toFixed(1)} {unit}
        </p>
      ))}
    </div>
  )
}

function PressureGauge({ label, value, min = 30, max = 50, unit = 'PSI' }: { label: string; value: number | null; min?: number; max?: number; unit?: string }) {
  const psi = value ?? 0
  const pct = Math.min(100, Math.max(0, ((psi - min) / (max - min)) * 100))
  const isLow = psi > 0 && psi < 35
  const isHigh = psi > 45
  const isOk = psi >= 35 && psi <= 45
  const color = isLow ? 'text-neon-red' : isHigh ? 'text-neon-amber' : 'text-neon-green'
  const bg = isLow ? 'bg-neon-red/20' : isHigh ? 'bg-neon-amber/20' : 'bg-neon-green/20'

  return (
    <div className="glass-card p-4 sm:p-5 flex flex-col items-center justify-center gap-3 h-full">
      <p className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>{label}</p>
      <div className="relative w-24 h-24 flex items-center justify-center">
        <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="6" className="text-white/5" />
          <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="6" strokeDasharray={`${pct * 2.64} 264`} strokeLinecap="round" className={color} />
        </svg>
        <span className={clsx('text-2xl font-bold', color)}>{psi > 0 ? psi.toFixed(1) : '--'}</span>
      </div>
      <div className="flex items-center gap-1.5">
        {psi === 0 ? (
          <span className="text-xs text-[var(--text-muted)]">No data</span>
        ) : isOk ? (
          <><CheckCircle className="h-3.5 w-3.5 text-neon-green" /><span className="text-xs text-neon-green">Normal</span></>
        ) : isLow ? (
          <><TrendingDown className="h-3.5 w-3.5 text-neon-red" /><span className="text-xs text-neon-red">Low</span></>
        ) : (
          <><TrendingUp className="h-3.5 w-3.5 text-neon-amber" /><span className="text-xs text-neon-amber">High</span></>
        )}
      </div>
      <span className={clsx('text-[10px] px-2 py-0.5 rounded-full font-medium', bg, color)}>{psi > 0 ? `${psi.toFixed(1)} ${unit}` : 'N/A'}</span>
    </div>
  )
}

function TireCarVisualization({ fl, fr, rl, rr, unit = 'PSI', timestamps }: {
  fl: number | null; fr: number | null; rl: number | null; rr: number | null;
  unit?: string;
  timestamps?: { fl?: string; fr?: string; rl?: string; rr?: string }
}) {
  const getStatus = (v: number | null): 'green' | 'amber' | 'red' => {
    if (v === null || v === 0) return 'amber'
    if (v < 30 || v > 50) return 'red'
    if (v < 35 || v > 45) return 'amber'
    return 'green'
  }
  const statusColors = { green: '#10b981', amber: '#f59e0b', red: '#ef4444' } as const
  const statusLabels = { green: 'OK', amber: 'WARN', red: 'CRIT' } as const
  const getColor = (v: number | null) => statusColors[getStatus(v)]
  const allNormal = [fl, fr, rl, rr].every(v => v !== null && v >= 35 && v <= 45)
  const fmt = (v: number | null) => (v !== null && v > 0 ? v.toFixed(1) : '--')
  // Pressure ring: percentage fill for the pressure ring (0-100)
  const pressurePct = (v: number | null) => {
    if (v === null || v === 0) return 0
    return Math.min(100, Math.max(0, ((v - 20) / (55 - 20)) * 100))
  }
  const fmtTimestamp = (ts?: string) => {
    if (!ts) return ''
    const d = new Date(ts)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffMin = Math.floor(diffMs / 60000)
    if (diffMin < 1) return 'just now'
    if (diffMin < 60) return `${diffMin}m ago`
    const diffH = Math.floor(diffMin / 60)
    if (diffH < 24) return `${diffH}h ago`
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }

  const tires = [
    { psi: fl, cx: 92, cy: 165, label: 'FL', fullLabel: 'FRONT LEFT', side: 'left' as const, ts: timestamps?.fl },
    { psi: fr, cx: 308, cy: 165, label: 'FR', fullLabel: 'FRONT RIGHT', side: 'right' as const, ts: timestamps?.fr },
    { psi: rl, cx: 92, cy: 435, label: 'RL', fullLabel: 'REAR LEFT', side: 'left' as const, ts: timestamps?.rl },
    { psi: rr, cx: 308, cy: 435, label: 'RR', fullLabel: 'REAR RIGHT', side: 'right' as const, ts: timestamps?.rr },
  ]

  const ringR = 30
  const ringCirc = 2 * Math.PI * ringR

  return (
    <svg viewBox="0 0 400 600" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', maxWidth: '100%' }} role="img" aria-label="Tire pressure vehicle visualization">
      <style>{`
        .tcv-pulse{animation:tcvPulse 2.5s ease-in-out infinite}
        .tcv-glow{animation:tcvGlow 3s ease-in-out infinite}
        .tcv-scan{animation:tcvScan 4s linear infinite}
        @keyframes tcvPulse{0%,100%{opacity:0.6}50%{opacity:1}}
        @keyframes tcvGlow{0%,100%{opacity:.3}50%{opacity:.8}}
        @keyframes tcvScan{0%{transform:translateY(0)}100%{transform:translateY(400px)}}
      `}</style>
      <defs>
        <linearGradient id="tcvStroke" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#06b6d4" /><stop offset="100%" stopColor="#10b981" />
        </linearGradient>
        <linearGradient id="tcvBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1e293b" stopOpacity="0.9" /><stop offset="100%" stopColor="#0f172a" stopOpacity="0.95" />
        </linearGradient>
        <linearGradient id="tcvGlass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.18" /><stop offset="100%" stopColor="#06b6d4" stopOpacity="0.04" />
        </linearGradient>
        <linearGradient id="tcvRoof" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1e293b" stopOpacity="0.5" /><stop offset="100%" stopColor="#0f172a" stopOpacity="0.3" />
        </linearGradient>
        <filter id="tcvGlowF"><feGaussianBlur stdDeviation="4" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        <filter id="tcvSoftGlow"><feGaussianBlur stdDeviation="6" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>

      {/* === Model Y Top-Down Body === */}
      {/* Main body shape — rounded SUV silhouette */}
      <path d="M200,72 C248,72 275,95 280,132 L284,200 L286,290 L285,380 L282,450 C278,500 255,525 200,528 C145,525 122,500 118,450 L115,380 L114,290 L116,200 L120,132 C125,95 152,72 200,72Z"
        fill="url(#tcvBody)" stroke="url(#tcvStroke)" strokeWidth="2.5" />

      {/* Roof panel with subtle pillar lines */}
      <path d="M200,105 C232,105 248,118 253,140 L256,195 L258,280 L257,370 L254,420 C250,455 235,468 200,470 C165,468 150,455 146,420 L143,370 L142,280 L144,195 L147,140 C152,118 168,105 200,105Z"
        fill="url(#tcvRoof)" stroke="#334155" strokeWidth="0.5" opacity="0.5" />

      {/* Windshield — large panoramic */}
      <path d="M168,125 C174,108 185,98 200,95 C215,98 226,108 232,125 L237,172 L163,172Z"
        fill="url(#tcvGlass)" stroke="#22d3ee" strokeWidth="1.2" strokeOpacity="0.35" />

      {/* Rear window */}
      <path d="M163,432 L237,432 L232,465 C226,488 215,498 200,500 C185,498 174,488 168,465Z"
        fill="url(#tcvGlass)" stroke="#22d3ee" strokeWidth="1" strokeOpacity="0.25" />

      {/* Roof cross-bar lines (B-pillar, C-pillar hints) */}
      <line x1="148" y1="218" x2="252" y2="218" stroke="#334155" strokeWidth="0.6" opacity="0.35" />
      <line x1="145" y1="385" x2="255" y2="385" stroke="#334155" strokeWidth="0.6" opacity="0.35" />

      {/* Headlights — LED strip style */}
      <path d="M140,108 Q145,100 160,98" fill="none" stroke="#fbbf24" strokeWidth="2.5" strokeLinecap="round" className="tcv-glow" filter="url(#tcvGlowF)" />
      <path d="M260,108 Q255,100 240,98" fill="none" stroke="#fbbf24" strokeWidth="2.5" strokeLinecap="round" className="tcv-glow" filter="url(#tcvGlowF)" />

      {/* DRL accents */}
      <circle cx="145" cy="106" r="2" fill="#fbbf24" opacity="0.8" />
      <circle cx="255" cy="106" r="2" fill="#fbbf24" opacity="0.8" />

      {/* Taillights — Model Y continuous lightbar */}
      <path d="M145,492 Q155,498 200,500 Q245,498 255,492" fill="none" stroke="#ef4444" strokeWidth="3" strokeLinecap="round" opacity="0.7" filter="url(#tcvGlowF)">
        <animate attributeName="opacity" values="0.4;0.8;0.4" dur="2.5s" repeatCount="indefinite" />
      </path>

      {/* Side mirrors */}
      <ellipse cx="110" cy="170" rx="9" ry="5" fill="#1e293b" stroke="#475569" strokeWidth="0.8" />
      <ellipse cx="290" cy="170" rx="9" ry="5" fill="#1e293b" stroke="#475569" strokeWidth="0.8" />

      {/* Door handles — subtle lines */}
      <line x1="120" y1="260" x2="120" y2="275" stroke="#475569" strokeWidth="1" strokeLinecap="round" opacity="0.4" />
      <line x1="280" y1="260" x2="280" y2="275" stroke="#475569" strokeWidth="1" strokeLinecap="round" opacity="0.4" />
      <line x1="120" y1="340" x2="120" y2="355" stroke="#475569" strokeWidth="1" strokeLinecap="round" opacity="0.4" />
      <line x1="280" y1="340" x2="280" y2="355" stroke="#475569" strokeWidth="1" strokeLinecap="round" opacity="0.4" />

      {/* === Wheel wells === */}
      {tires.map(t => {
        const c = getColor(t.psi)
        const pct = pressurePct(t.psi)
        const dashLen = (pct / 100) * ringCirc
        const status = getStatus(t.psi)
        const isL = t.side === 'left'
        const labelX = isL ? 18 : 382
        const boxX = isL ? -5 : 350

        return (
          <g key={t.label}>
            {/* Pressure ring — background track */}
            <circle cx={t.cx} cy={t.cy} r={ringR} fill="none" stroke="#1e293b" strokeWidth="5" />

            {/* Pressure ring — colored fill based on percentage */}
            <circle cx={t.cx} cy={t.cy} r={ringR} fill="none" stroke={c} strokeWidth="5"
              strokeDasharray={`${dashLen} ${ringCirc}`} strokeLinecap="round"
              transform={`rotate(-90 ${t.cx} ${t.cy})`} opacity="0.85" />

            {/* Glow pulse on warning/critical */}
            {status !== 'green' && (
              <circle cx={t.cx} cy={t.cy} r={ringR + 4} fill="none" stroke={c} strokeWidth="1.5" opacity="0">
                <animate attributeName="r" values={`${ringR + 4};${ringR + 18}`} dur="2s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.5;0" dur="2s" repeatCount="indefinite" />
              </circle>
            )}

            {/* Tire body (rounded rect) */}
            <rect x={t.cx - 14} y={t.cy - 26} width={28} height={52} rx={7} fill="#111827" stroke={c} strokeWidth="1.8" />
            {/* Tread pattern */}
            {[-16, -8, 0, 8, 16].map(dy => (
              <line key={dy} x1={t.cx - 8} y1={t.cy + dy} x2={t.cx + 8} y2={t.cy + dy} stroke={c} strokeWidth="0.8" opacity="0.25" />
            ))}

            {/* Hub center dot */}
            <circle cx={t.cx} cy={t.cy} r="4" fill="#0f172a" stroke={c} strokeWidth="1" />

            {/* Connecting dashed line */}
            <line x1={isL ? t.cx - ringR - 6 : t.cx + ringR + 6} y1={t.cy} x2={isL ? boxX + 58 : boxX} y2={t.cy}
              stroke={c} strokeWidth="0.8" strokeDasharray="3 3" opacity="0.4" />

            {/* Info panel */}
            <rect x={boxX} y={t.cy - 28} width={56} height={56} rx={10} fill="#0f172a" fillOpacity="0.95" stroke={c} strokeWidth="1.2" />

            {/* PSI value */}
            <text x={labelX} y={t.cy - 8} textAnchor="middle" fontSize="16" fontWeight="bold" fill={c} fontFamily="system-ui,sans-serif">
              {fmt(t.psi)}
            </text>

            {/* Unit label */}
            <text x={labelX} y={t.cy + 5} textAnchor="middle" fontSize="7" fill="#9ca3af" fontFamily="system-ui,sans-serif">
              {unit}
            </text>

            {/* Status badge */}
            <text x={labelX} y={t.cy + 17} textAnchor="middle" fontSize="6.5" fontWeight="600" fill={c} fontFamily="system-ui,sans-serif">
              {statusLabels[status]}
            </text>

            {/* Timestamp */}
            {t.ts && (
              <text x={labelX} y={t.cy + 26} textAnchor="middle" fontSize="5.5" fill="#64748b" fontFamily="system-ui,sans-serif">
                {fmtTimestamp(t.ts)}
              </text>
            )}
          </g>
        )
      })}

      {/* Center HUD */}
      <rect x="160" y="272" width="80" height="56" rx="12" fill="#0f172a" fillOpacity="0.9" stroke="#22d3ee" strokeWidth="1" />
      <text x="200" y="292" textAnchor="middle" fontSize="12" fontWeight="bold" fill="#22d3ee" fontFamily="system-ui,sans-serif" letterSpacing="2">TPMS</text>
      <text x="200" y="308" textAnchor="middle" fontSize="8" fontWeight="600" fill={allNormal ? '#10b981' : '#f59e0b'} fontFamily="system-ui,sans-serif">
        {allNormal ? 'ALL NORMAL' : 'ATTENTION'}
      </text>
      <circle cx="200" cy="320" r="3" fill={allNormal ? '#10b981' : '#f59e0b'}>
        <animate attributeName="opacity" values="1;0.3;1" dur="2s" repeatCount="indefinite" />
      </circle>

      {/* Tesla T watermark */}
      <text x="200" y="260" textAnchor="middle" fontSize="14" fontWeight="bold" fill="#22d3ee" opacity="0.3" fontFamily="system-ui,sans-serif">
        T
        <animate attributeName="opacity" values="0.15;0.4;0.15" dur="4s" repeatCount="indefinite" />
      </text>

      {/* Scan line */}
      <line x1="130" y1="100" x2="270" y2="100" stroke="#22d3ee" strokeWidth="1" opacity="0">
        <animate attributeName="y1" values="100;500" dur="4s" repeatCount="indefinite" />
        <animate attributeName="y2" values="100;500" dur="4s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0;0.15;0.15;0" dur="4s" repeatCount="indefinite" />
      </line>
    </svg>
  )
}

export default function TirePressure() {
  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: getVehicles })
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null)
  const vehicleId = selectedVehicle ?? vehicles?.[0]?.id ?? null
  const { convertPressure, pressureUnit } = useSettings()

  // Thresholds in the display unit
  const lowThreshold = convertPressure(2.4)   // ~35 PSI

  const { data: history, isLoading: loadingHistory } = useQuery({
    queryKey: ['tire-pressure-history', vehicleId],
    queryFn: () => getTirePressure(vehicleId!, 200),
    enabled: vehicleId !== null,
    refetchInterval: 10000,
  })

  // Build composite latest from history: most recent non-null value for each tire + timestamps
  const compositeLatest = useMemo(() => {
    if (!history || history.length === 0) return null
    let fl: number | null = null, fr: number | null = null, rl: number | null = null, rr: number | null = null
    let flTs: string | undefined, frTs: string | undefined, rlTs: string | undefined, rrTs: string | undefined
    for (const s of history) {
      if (fl === null && s.front_left !== null) { fl = s.front_left; flTs = s.created_at }
      if (fr === null && s.front_right !== null) { fr = s.front_right; frTs = s.created_at }
      if (rl === null && s.rear_left !== null) { rl = s.rear_left; rlTs = s.created_at }
      if (rr === null && s.rear_right !== null) { rr = s.rear_right; rrTs = s.created_at }
      if (fl !== null && fr !== null && rl !== null && rr !== null) break
    }
    return { front_left: fl, front_right: fr, rear_left: rl, rear_right: rr, timestamps: { fl: flTs, fr: frTs, rl: rlTs, rr: rrTs } }
  }, [history])

  // Convert all values for display
  const convFL = compositeLatest?.front_left != null ? convertPressure(compositeLatest.front_left) : null
  const convFR = compositeLatest?.front_right != null ? convertPressure(compositeLatest.front_right) : null
  const convRL = compositeLatest?.rear_left != null ? convertPressure(compositeLatest.rear_left) : null
  const convRR = compositeLatest?.rear_right != null ? convertPressure(compositeLatest.rear_right) : null

  const chartData = (history ?? []).slice().reverse().map(s => ({
    time: new Date(s.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
    fl: s.front_left != null ? convertPressure(s.front_left) : null,
    fr: s.front_right != null ? convertPressure(s.front_right) : null,
    rl: s.rear_left != null ? convertPressure(s.rear_left) : null,
    rr: s.rear_right != null ? convertPressure(s.rear_right) : null,
  }))

  const anyLow = [convFL, convFR, convRL, convRR].some(v => v !== null && v < lowThreshold)

  return (
    <FadeIn>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0 mb-6 sm:mb-8">
        <PageHeader title="Tire Pressure" subtitle="Monitor tire pressure across all four tires" icon={<Gauge className="h-7 w-7 text-neon-cyan" />} />
        {vehicles && vehicles.length > 1 && (
          <select
            value={vehicleId ?? ''}
            onChange={e => setSelectedVehicle(Number(e.target.value))}
            className="glass-card px-3 py-2 text-sm rounded-lg border-0 focus:ring-1 focus:ring-neon-cyan/50"
            style={{ background: 'var(--surface-2)', color: 'var(--text-primary)' }}
          >
            {vehicles.map(v => <option key={v.id} value={v.id}>{v.display_name || v.vin}</option>)}
          </select>
        )}
      </div>

      {anyLow && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-neon-red/30 bg-neon-red/5 p-4">
          <AlertTriangle className="h-5 w-5 text-neon-red shrink-0" />
          <p className="text-sm text-neon-red">One or more tires have low pressure. Check and inflate to recommended levels.</p>
        </div>
      )}

      {!loadingHistory && compositeLatest && (
        <div className="mb-6">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-4 items-stretch">
            {/* Car Visualization — constrained to viewport */}
            <GlassPanel className="p-4 flex items-center justify-center">
              <div className="w-full max-h-[55vh]" style={{ aspectRatio: '2/3', maxWidth: '340px' }}>
                <TireCarVisualization
                  fl={convFL}
                  fr={convFR}
                  rl={convRL}
                  rr={convRR}
                  unit={pressureUnit}
                  timestamps={compositeLatest?.timestamps}
                />
              </div>
            </GlassPanel>

            {/* Pressure Gauges — 2×2 grid beside car, same height */}
            <div className="grid grid-cols-2 gap-3 h-full">
              <PressureGauge label="Front Left" value={convFL} min={convertPressure(2.0)} max={convertPressure(3.5)} unit={pressureUnit} />
              <PressureGauge label="Front Right" value={convFR} min={convertPressure(2.0)} max={convertPressure(3.5)} unit={pressureUnit} />
              <PressureGauge label="Rear Left" value={convRL} min={convertPressure(2.0)} max={convertPressure(3.5)} unit={pressureUnit} />
              <PressureGauge label="Rear Right" value={convRR} min={convertPressure(2.0)} max={convertPressure(3.5)} unit={pressureUnit} />
            </div>
          </div>
        </div>
      )}

      {loadingHistory && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-48 rounded-xl" />)}
        </div>
      )}

      {/* History Chart */}
      <GlassPanel className="p-4 sm:p-6">
        <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Pressure History</h3>
        {loadingHistory ? <Skeleton className="h-72 rounded-xl" /> : chartData.length === 0 ? (
          <div className="flex items-center justify-center h-72 text-[var(--text-muted)] text-sm">No pressure history data available</div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis domain={[convertPressure(2.0), convertPressure(3.6)]} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickFormatter={v => `${v.toFixed(0)}`} />
              <Tooltip content={<ChartTooltip unit={pressureUnit} />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="fl" name="Front Left" stroke="#00f0ff" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="fr" name="Front Right" stroke="#a855f7" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="rl" name="Rear Left" stroke="#10b981" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="rr" name="Rear Right" stroke="#f59e0b" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </GlassPanel>
    </FadeIn>
  )
}
