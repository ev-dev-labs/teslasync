import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getVehicles, getTirePressure, getLatestTirePressure } from '../api'
import { PageHeader, GlassPanel, FadeIn, Skeleton } from '../components/ui'
import { Gauge, AlertTriangle, CheckCircle, TrendingDown, TrendingUp } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import clsx from 'clsx'

interface TooltipPayload { name: string; value: number; color?: string }
function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipPayload[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="glass-panel p-3 text-xs" style={{ background: 'var(--surface-2)', borderColor: 'var(--glass-border)' }}>
      <p style={{ color: 'var(--text-secondary)' }} className="mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: 'var(--text-primary)' }}>
          <span style={{ color: p.color }}>●</span> {p.name}: {p.value?.toFixed(1)} PSI
        </p>
      ))}
    </div>
  )
}

function PressureGauge({ label, value, min = 30, max = 50 }: { label: string; value: number | null; min?: number; max?: number }) {
  const psi = value ?? 0
  const pct = Math.min(100, Math.max(0, ((psi - min) / (max - min)) * 100))
  const isLow = psi > 0 && psi < 35
  const isHigh = psi > 45
  const isOk = psi >= 35 && psi <= 45
  const color = isLow ? 'text-neon-red' : isHigh ? 'text-neon-amber' : 'text-neon-green'
  const bg = isLow ? 'bg-neon-red/20' : isHigh ? 'bg-neon-amber/20' : 'bg-neon-green/20'

  return (
    <div className="glass-card p-4 sm:p-5 flex flex-col items-center gap-3">
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
      <span className={clsx('text-[10px] px-2 py-0.5 rounded-full font-medium', bg, color)}>{psi > 0 ? `${psi.toFixed(1)} PSI` : 'N/A'}</span>
    </div>
  )
}

function TireCarVisualization({ fl, fr, rl, rr }: { fl: number | null; fr: number | null; rl: number | null; rr: number | null }) {
  const getStatus = (psi: number | null): 'green' | 'amber' | 'red' => {
    if (psi === null || psi === 0) return 'amber'
    if (psi < 30 || psi > 50) return 'red'
    if (psi < 35 || psi > 45) return 'amber'
    return 'green'
  }
  const statusColors = { green: '#10b981', amber: '#f59e0b', red: '#ef4444' } as const
  const getColor = (psi: number | null) => statusColors[getStatus(psi)]
  const allNormal = [fl, fr, rl, rr].every(v => v !== null && v >= 35 && v <= 45)
  const fmt = (psi: number | null) => (psi !== null && psi > 0 ? psi.toFixed(1) : '--')

  const tires = [
    { psi: fl, cx: 95, cy: 160, label: 'FRONT L', side: 'left' as const },
    { psi: fr, cx: 305, cy: 160, label: 'FRONT R', side: 'right' as const },
    { psi: rl, cx: 95, cy: 430, label: 'REAR L', side: 'left' as const },
    { psi: rr, cx: 305, cy: 430, label: 'REAR R', side: 'right' as const },
  ]

  return (
    <svg viewBox="0 0 400 600" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', maxWidth: 500 }} role="img" aria-label="Tire pressure vehicle visualization">
      <style>{`
        .tcv-spin{animation:tcvSpin .8s linear infinite}
        .tcv-flow{animation:tcvFlow 1.2s linear infinite}
        .tcv-glow{animation:tcvGlow 3s ease-in-out infinite}
        @keyframes tcvSpin{to{stroke-dashoffset:-12}}
        @keyframes tcvFlow{to{stroke-dashoffset:-8}}
        @keyframes tcvGlow{0%,100%{opacity:.4}50%{opacity:1}}
      `}</style>
      <defs>
        <linearGradient id="tcvStroke" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#06b6d4" /><stop offset="100%" stopColor="#10b981" />
        </linearGradient>
        <linearGradient id="tcvBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1e293b" stopOpacity="0.85" /><stop offset="100%" stopColor="#0f172a" stopOpacity="0.95" />
        </linearGradient>
        <linearGradient id="tcvGlass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.2" /><stop offset="100%" stopColor="#06b6d4" stopOpacity="0.05" />
        </linearGradient>
        <filter id="tcvGlowF">
          <feGaussianBlur stdDeviation="4" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Car body */}
      <path d="M200,78 C245,78 270,100 274,135 L278,210 L280,370 L277,445 C274,495 252,518 200,522 C148,518 126,495 123,445 L120,370 L122,210 L126,135 C130,100 155,78 200,78Z" fill="url(#tcvBody)" stroke="url(#tcvStroke)" strokeWidth="2" />
      <line x1="135" y1="220" x2="265" y2="220" stroke="#334155" strokeWidth="0.8" opacity="0.4" />
      <line x1="132" y1="380" x2="268" y2="380" stroke="#334155" strokeWidth="0.8" opacity="0.4" />

      {/* Windshield */}
      <path d="M165,128 C170,105 182,92 200,88 C218,92 230,105 235,128 L240,168 L160,168Z" fill="url(#tcvGlass)" stroke="#22d3ee" strokeWidth="1" strokeOpacity="0.3" />
      {/* Rear window */}
      <path d="M160,440 L240,440 L235,478 C230,498 218,508 200,512 C182,508 170,498 165,478Z" fill="url(#tcvGlass)" stroke="#22d3ee" strokeWidth="1" strokeOpacity="0.3" />

      {/* Headlights */}
      <ellipse cx="140" cy="118" rx="10" ry="5" fill="#fbbf24" className="tcv-glow" filter="url(#tcvGlowF)" />
      <ellipse cx="260" cy="118" rx="10" ry="5" fill="#fbbf24" className="tcv-glow" filter="url(#tcvGlowF)" />

      {/* Taillights */}
      <ellipse cx="145" cy="490" rx="8" ry="4" fill="#ef4444" opacity="0.6" filter="url(#tcvGlowF)">
        <animate attributeName="opacity" values="0.3;0.7;0.3" dur="2.5s" repeatCount="indefinite" />
      </ellipse>
      <ellipse cx="255" cy="490" rx="8" ry="4" fill="#ef4444" opacity="0.6" filter="url(#tcvGlowF)">
        <animate attributeName="opacity" values="0.3;0.7;0.3" dur="2.5s" repeatCount="indefinite" />
      </ellipse>

      {/* Side mirrors */}
      <ellipse cx="115" cy="175" rx="8" ry="5" fill="#1e293b" stroke="#334155" strokeWidth="1" />
      <ellipse cx="285" cy="175" rx="8" ry="5" fill="#1e293b" stroke="#334155" strokeWidth="1" />

      {/* Tires with pulse rings, data lines, and PSI labels */}
      {tires.map(t => {
        const c = getColor(t.psi)
        const isL = t.side === 'left'
        return (
          <g key={t.label}>
            {/* Pulse rings */}
            <circle cx={t.cx} cy={t.cy} fill="none" stroke={c} strokeWidth="1.5" r="22" opacity="0">
              <animate attributeName="r" values="22;42" dur="2s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.6;0" dur="2s" repeatCount="indefinite" />
            </circle>
            <circle cx={t.cx} cy={t.cy} fill="none" stroke={c} strokeWidth="1" r="22" opacity="0">
              <animate attributeName="r" values="22;48" dur="2s" begin="0.6s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.4;0" dur="2s" begin="0.6s" repeatCount="indefinite" />
            </circle>

            {/* Data line: tire → car body */}
            <line x1={isL ? t.cx + 15 : t.cx - 15} y1={t.cy} x2={isL ? 125 : 275} y2={t.cy} stroke={c} strokeWidth="1" strokeDasharray="4 4" opacity="0.5" className="tcv-flow" />

            {/* Tire rectangle */}
            <rect x={t.cx - 15} y={t.cy - 30} width={30} height={60} rx={8} fill="#111827" stroke={c} strokeWidth="2" />
            {/* Spinning tread overlay */}
            <rect x={t.cx - 15} y={t.cy - 30} width={30} height={60} rx={8} fill="none" stroke={c} strokeWidth="1.5" strokeDasharray="6 6" opacity="0.4" className="tcv-spin" />
            {/* Tread lines */}
            {[-18, -6, 6, 18].map(dy => (
              <line key={dy} x1={t.cx - 10} y1={t.cy + dy} x2={t.cx + 10} y2={t.cy + dy} stroke={c} strokeWidth="1" opacity="0.2" />
            ))}

            {/* Connecting line: label → tire */}
            <line x1={isL ? 60 : 340} y1={t.cy} x2={isL ? t.cx - 15 : t.cx + 15} y2={t.cy} stroke={c} strokeWidth="0.8" strokeDasharray="3 3" opacity="0.35" className="tcv-flow" />

            {/* PSI label box */}
            <rect x={isL ? 4 : 340} y={t.cy - 22} width={56} height={44} rx={8} fill="#0f172a" stroke={c} strokeWidth="1.2" opacity="0.9" />
            <text x={isL ? 32 : 368} y={t.cy - 4} textAnchor="middle" fontSize="15" fontWeight="bold" fill={c} fontFamily="system-ui,sans-serif">{fmt(t.psi)}</text>
            <text x={isL ? 32 : 368} y={t.cy + 12} textAnchor="middle" fontSize="7" fill="#9ca3af" fontFamily="system-ui,sans-serif">{t.label}</text>
          </g>
        )
      })}

      {/* Center HUD */}
      <rect x="165" y="268" width="70" height="62" rx="10" fill="#0f172a" stroke="#22d3ee" strokeWidth="1" opacity="0.8" />
      <text x="200" y="288" textAnchor="middle" fontSize="11" fontWeight="bold" fill="#22d3ee" fontFamily="system-ui,sans-serif" letterSpacing="2">TPMS</text>
      <text x="200" y="306" textAnchor="middle" fontSize="7" fontWeight="600" fill={allNormal ? '#10b981' : '#f59e0b'} fontFamily="system-ui,sans-serif">{allNormal ? 'ALL NORMAL' : 'WARNING'}</text>
      <circle cx="200" cy="320" r="3" fill={allNormal ? '#10b981' : '#f59e0b'}>
        <animate attributeName="opacity" values="1;0.3;1" dur="2s" repeatCount="indefinite" />
      </circle>

      {/* Tesla T logo */}
      <text x="200" y="258" textAnchor="middle" fontSize="14" fontWeight="bold" fill="#22d3ee" opacity="0.4" fontFamily="system-ui,sans-serif">
        {'T'}
        <animate attributeName="opacity" values="0.2;0.5;0.2" dur="4s" repeatCount="indefinite" />
      </text>

      {/* Scanner line */}
      <line x1="130" y1="100" x2="270" y2="100" stroke="#22d3ee" strokeWidth="1.5" opacity="0">
        <animate attributeName="y1" values="100;500" dur="4s" repeatCount="indefinite" />
        <animate attributeName="y2" values="100;500" dur="4s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0;0.2;0.2;0" dur="4s" repeatCount="indefinite" />
      </line>
    </svg>
  )
}

export default function TirePressure() {
  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: getVehicles })
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null)
  const vehicleId = selectedVehicle ?? vehicles?.[0]?.id ?? null

  const { data: latest, isLoading: loadingLatest } = useQuery({
    queryKey: ['tire-pressure-latest', vehicleId],
    queryFn: () => getLatestTirePressure(vehicleId!),
    enabled: vehicleId !== null,
  })

  const { data: history, isLoading: loadingHistory } = useQuery({
    queryKey: ['tire-pressure-history', vehicleId],
    queryFn: () => getTirePressure(vehicleId!, 200),
    enabled: vehicleId !== null,
  })

  const chartData = (history ?? []).slice().reverse().map(s => ({
    time: new Date(s.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
    fl: s.front_left,
    fr: s.front_right,
    rl: s.rear_left,
    rr: s.rear_right,
  }))

  const anyLow = latest && [latest.front_left, latest.front_right, latest.rear_left, latest.rear_right].some(v => v !== null && v < 35)

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

      {!loadingLatest && latest && (
        <div className="mb-8">
          <GlassPanel className="p-6 flex justify-center">
            <TireCarVisualization
              fl={latest.front_left}
              fr={latest.front_right}
              rl={latest.rear_left}
              rr={latest.rear_right}
            />
          </GlassPanel>
        </div>
      )}

      {loadingLatest ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-48 rounded-xl" />)}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
            <PressureGauge label="Front Left" value={latest?.front_left ?? null} />
            <PressureGauge label="Front Right" value={latest?.front_right ?? null} />
            <PressureGauge label="Rear Left" value={latest?.rear_left ?? null} />
            <PressureGauge label="Rear Right" value={latest?.rear_right ?? null} />
          </div>

          {/* Animated Car Diagram */}
          <GlassPanel className="mb-6 sm:mb-8 p-4 sm:p-6 overflow-hidden">
            <h3 className="text-sm font-semibold mb-4 sm:mb-6" style={{ color: 'var(--text-primary)' }}>Vehicle Overview</h3>
            <div className="relative mx-auto w-full max-w-lg">
              <svg viewBox="0 0 480 700" className="w-full h-auto drop-shadow-2xl" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <linearGradient id="bodyGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#1e293b" />
                    <stop offset="100%" stopColor="#0f172a" />
                  </linearGradient>
                  <linearGradient id="glassGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.25" />
                    <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.08" />
                  </linearGradient>
                  <linearGradient id="tireOk" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" />
                    <stop offset="100%" stopColor="#059669" />
                  </linearGradient>
                  <linearGradient id="tireLow" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ef4444" />
                    <stop offset="100%" stopColor="#dc2626" />
                  </linearGradient>
                  <filter id="glow">
                    <feGaussianBlur stdDeviation="6" result="blur" />
                    <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                  </filter>
                  <filter id="tireShadow">
                    <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor="#000" floodOpacity="0.5" />
                  </filter>
                </defs>

                {/* Car body */}
                <path d="M160,120 C160,60 180,30 240,25 C300,30 320,60 320,120 L330,180 L340,300 L340,480 L330,580 C325,640 300,665 240,670 C180,665 155,640 150,580 L140,480 L140,300 L150,180 Z"
                  fill="url(#bodyGrad)" stroke="#334155" strokeWidth="2">
                  <animate attributeName="opacity" values="0;1" dur="0.8s" fill="freeze" />
                </path>

                {/* Body accent lines */}
                <path d="M165,200 L315,200" stroke="#334155" strokeWidth="1" opacity="0.5" />
                <path d="M155,400 L325,400" stroke="#334155" strokeWidth="1" opacity="0.5" />

                {/* Windshield */}
                <path d="M180,130 C185,90 210,60 240,55 C270,60 295,90 300,130 L305,175 L175,175 Z"
                  fill="url(#glassGrad)" stroke="#38bdf8" strokeWidth="1.5" strokeOpacity="0.3">
                  <animate attributeName="opacity" values="0;1" dur="1s" begin="0.3s" fill="freeze" />
                </path>

                {/* Rear window */}
                <path d="M175,520 L305,520 L295,580 C285,610 260,625 240,628 C220,625 195,610 185,580 Z"
                  fill="url(#glassGrad)" stroke="#38bdf8" strokeWidth="1.5" strokeOpacity="0.3">
                  <animate attributeName="opacity" values="0;1" dur="1s" begin="0.3s" fill="freeze" />
                </path>

                {/* Headlights */}
                <ellipse cx="175" cy="135" rx="12" ry="6" fill="#fbbf24" opacity="0.8" filter="url(#glow)">
                  <animate attributeName="opacity" values="0.4;0.9;0.4" dur="3s" repeatCount="indefinite" />
                </ellipse>
                <ellipse cx="305" cy="135" rx="12" ry="6" fill="#fbbf24" opacity="0.8" filter="url(#glow)">
                  <animate attributeName="opacity" values="0.4;0.9;0.4" dur="3s" repeatCount="indefinite" />
                </ellipse>

                {/* Taillights */}
                <ellipse cx="178" cy="600" rx="10" ry="5" fill="#ef4444" opacity="0.7" filter="url(#glow)">
                  <animate attributeName="opacity" values="0.3;0.8;0.3" dur="2.5s" repeatCount="indefinite" />
                </ellipse>
                <ellipse cx="302" cy="600" rx="10" ry="5" fill="#ef4444" opacity="0.7" filter="url(#glow)">
                  <animate attributeName="opacity" values="0.3;0.8;0.3" dur="2.5s" repeatCount="indefinite" />
                </ellipse>

                {/* Door handles */}
                <rect x="148" y="290" width="14" height="3" rx="1.5" fill="#475569" />
                <rect x="318" y="290" width="14" height="3" rx="1.5" fill="#475569" />

                {/* Side mirrors */}
                <ellipse cx="138" cy="195" rx="10" ry="7" fill="#1e293b" stroke="#334155" strokeWidth="1.5" />
                <ellipse cx="342" cy="195" rx="10" ry="7" fill="#1e293b" stroke="#334155" strokeWidth="1.5" />

                {/* Tesla logo on hood */}
                <text x="240" y="230" textAnchor="middle" fontSize="16" fontWeight="bold" fill="#00f0ff" opacity="0.6" fontFamily="system-ui">
                  T
                  <animate attributeName="opacity" values="0.3;0.7;0.3" dur="4s" repeatCount="indefinite" />
                </text>

                {/* === FRONT LEFT TIRE === */}
                <g filter="url(#tireShadow)">
                  <rect x="100" y="155" width="40" height="90" rx="12" fill={latest?.front_left && latest.front_left < 35 ? 'url(#tireLow)' : '#1f2937'} stroke={latest?.front_left && latest.front_left < 35 ? '#ef4444' : '#4b5563'} strokeWidth="2">
                    <animate attributeName="y" values="158;152;158" dur="3s" repeatCount="indefinite" />
                  </rect>
                  {/* Tire treads */}
                  <line x1="108" y1="172" x2="132" y2="172" stroke="#374151" strokeWidth="1.5" opacity="0.5"><animate attributeName="y1" values="175;169;175" dur="3s" repeatCount="indefinite" /><animate attributeName="y2" values="175;169;175" dur="3s" repeatCount="indefinite" /></line>
                  <line x1="108" y1="190" x2="132" y2="190" stroke="#374151" strokeWidth="1.5" opacity="0.5"><animate attributeName="y1" values="193;187;193" dur="3s" repeatCount="indefinite" /><animate attributeName="y2" values="193;187;193" dur="3s" repeatCount="indefinite" /></line>
                  <line x1="108" y1="208" x2="132" y2="208" stroke="#374151" strokeWidth="1.5" opacity="0.5"><animate attributeName="y1" values="211;205;211" dur="3s" repeatCount="indefinite" /><animate attributeName="y2" values="211;205;211" dur="3s" repeatCount="indefinite" /></line>
                  <line x1="108" y1="226" x2="132" y2="226" stroke="#374151" strokeWidth="1.5" opacity="0.5"><animate attributeName="y1" values="229;223;229" dur="3s" repeatCount="indefinite" /><animate attributeName="y2" values="229;223;229" dur="3s" repeatCount="indefinite" /></line>
                </g>
                {/* FL label */}
                <g>
                  <rect x="22" y="175" width="68" height="48" rx="10" fill="var(--surface-2)" stroke={latest?.front_left && latest.front_left < 35 ? '#ef4444' : '#00f0ff'} strokeWidth="1.5" opacity="0.9" />
                  <text x="56" y="196" textAnchor="middle" fontSize="18" fontWeight="bold" fill={latest?.front_left && latest.front_left < 35 ? '#ef4444' : '#00f0ff'} fontFamily="system-ui">{latest?.front_left?.toFixed(1) ?? '--'}</text>
                  <text x="56" y="214" textAnchor="middle" fontSize="9" fill="#9ca3af" fontFamily="system-ui">FRONT LEFT</text>
                </g>

                {/* === FRONT RIGHT TIRE === */}
                <g filter="url(#tireShadow)">
                  <rect x="340" y="155" width="40" height="90" rx="12" fill={latest?.front_right && latest.front_right < 35 ? 'url(#tireLow)' : '#1f2937'} stroke={latest?.front_right && latest.front_right < 35 ? '#ef4444' : '#4b5563'} strokeWidth="2">
                    <animate attributeName="y" values="158;152;158" dur="3s" repeatCount="indefinite" />
                  </rect>
                  <line x1="348" y1="172" x2="372" y2="172" stroke="#374151" strokeWidth="1.5" opacity="0.5"><animate attributeName="y1" values="175;169;175" dur="3s" repeatCount="indefinite" /><animate attributeName="y2" values="175;169;175" dur="3s" repeatCount="indefinite" /></line>
                  <line x1="348" y1="190" x2="372" y2="190" stroke="#374151" strokeWidth="1.5" opacity="0.5"><animate attributeName="y1" values="193;187;193" dur="3s" repeatCount="indefinite" /><animate attributeName="y2" values="193;187;193" dur="3s" repeatCount="indefinite" /></line>
                  <line x1="348" y1="208" x2="372" y2="208" stroke="#374151" strokeWidth="1.5" opacity="0.5"><animate attributeName="y1" values="211;205;211" dur="3s" repeatCount="indefinite" /><animate attributeName="y2" values="211;205;211" dur="3s" repeatCount="indefinite" /></line>
                  <line x1="348" y1="226" x2="372" y2="226" stroke="#374151" strokeWidth="1.5" opacity="0.5"><animate attributeName="y1" values="229;223;229" dur="3s" repeatCount="indefinite" /><animate attributeName="y2" values="229;223;229" dur="3s" repeatCount="indefinite" /></line>
                </g>
                {/* FR label */}
                <g>
                  <rect x="390" y="175" width="68" height="48" rx="10" fill="var(--surface-2)" stroke={latest?.front_right && latest.front_right < 35 ? '#ef4444' : '#00f0ff'} strokeWidth="1.5" opacity="0.9" />
                  <text x="424" y="196" textAnchor="middle" fontSize="18" fontWeight="bold" fill={latest?.front_right && latest.front_right < 35 ? '#ef4444' : '#00f0ff'} fontFamily="system-ui">{latest?.front_right?.toFixed(1) ?? '--'}</text>
                  <text x="424" y="214" textAnchor="middle" fontSize="9" fill="#9ca3af" fontFamily="system-ui">FRONT RIGHT</text>
                </g>

                {/* === REAR LEFT TIRE === */}
                <g filter="url(#tireShadow)">
                  <rect x="100" y="455" width="40" height="90" rx="12" fill={latest?.rear_left && latest.rear_left < 35 ? 'url(#tireLow)' : '#1f2937'} stroke={latest?.rear_left && latest.rear_left < 35 ? '#ef4444' : '#4b5563'} strokeWidth="2">
                    <animate attributeName="y" values="458;452;458" dur="3s" repeatCount="indefinite" />
                  </rect>
                  <line x1="108" y1="472" x2="132" y2="472" stroke="#374151" strokeWidth="1.5" opacity="0.5"><animate attributeName="y1" values="475;469;475" dur="3s" repeatCount="indefinite" /><animate attributeName="y2" values="475;469;475" dur="3s" repeatCount="indefinite" /></line>
                  <line x1="108" y1="490" x2="132" y2="490" stroke="#374151" strokeWidth="1.5" opacity="0.5"><animate attributeName="y1" values="493;487;493" dur="3s" repeatCount="indefinite" /><animate attributeName="y2" values="493;487;493" dur="3s" repeatCount="indefinite" /></line>
                  <line x1="108" y1="508" x2="132" y2="508" stroke="#374151" strokeWidth="1.5" opacity="0.5"><animate attributeName="y1" values="511;505;511" dur="3s" repeatCount="indefinite" /><animate attributeName="y2" values="511;505;511" dur="3s" repeatCount="indefinite" /></line>
                  <line x1="108" y1="526" x2="132" y2="526" stroke="#374151" strokeWidth="1.5" opacity="0.5"><animate attributeName="y1" values="529;523;529" dur="3s" repeatCount="indefinite" /><animate attributeName="y2" values="529;523;529" dur="3s" repeatCount="indefinite" /></line>
                </g>
                {/* RL label */}
                <g>
                  <rect x="22" y="475" width="68" height="48" rx="10" fill="var(--surface-2)" stroke={latest?.rear_left && latest.rear_left < 35 ? '#ef4444' : '#a855f7'} strokeWidth="1.5" opacity="0.9" />
                  <text x="56" y="496" textAnchor="middle" fontSize="18" fontWeight="bold" fill={latest?.rear_left && latest.rear_left < 35 ? '#ef4444' : '#a855f7'} fontFamily="system-ui">{latest?.rear_left?.toFixed(1) ?? '--'}</text>
                  <text x="56" y="514" textAnchor="middle" fontSize="9" fill="#9ca3af" fontFamily="system-ui">REAR LEFT</text>
                </g>

                {/* === REAR RIGHT TIRE === */}
                <g filter="url(#tireShadow)">
                  <rect x="340" y="455" width="40" height="90" rx="12" fill={latest?.rear_right && latest.rear_right < 35 ? 'url(#tireLow)' : '#1f2937'} stroke={latest?.rear_right && latest.rear_right < 35 ? '#ef4444' : '#4b5563'} strokeWidth="2">
                    <animate attributeName="y" values="458;452;458" dur="3s" repeatCount="indefinite" />
                  </rect>
                  <line x1="348" y1="472" x2="372" y2="472" stroke="#374151" strokeWidth="1.5" opacity="0.5"><animate attributeName="y1" values="475;469;475" dur="3s" repeatCount="indefinite" /><animate attributeName="y2" values="475;469;475" dur="3s" repeatCount="indefinite" /></line>
                  <line x1="348" y1="490" x2="372" y2="490" stroke="#374151" strokeWidth="1.5" opacity="0.5"><animate attributeName="y1" values="493;487;493" dur="3s" repeatCount="indefinite" /><animate attributeName="y2" values="493;487;493" dur="3s" repeatCount="indefinite" /></line>
                  <line x1="348" y1="508" x2="372" y2="508" stroke="#374151" strokeWidth="1.5" opacity="0.5"><animate attributeName="y1" values="511;505;511" dur="3s" repeatCount="indefinite" /><animate attributeName="y2" values="511;505;511" dur="3s" repeatCount="indefinite" /></line>
                  <line x1="348" y1="526" x2="372" y2="526" stroke="#374151" strokeWidth="1.5" opacity="0.5"><animate attributeName="y1" values="529;523;529" dur="3s" repeatCount="indefinite" /><animate attributeName="y2" values="529;523;529" dur="3s" repeatCount="indefinite" /></line>
                </g>
                {/* RR label */}
                <g>
                  <rect x="390" y="475" width="68" height="48" rx="10" fill="var(--surface-2)" stroke={latest?.rear_right && latest.rear_right < 35 ? '#ef4444' : '#a855f7'} strokeWidth="1.5" opacity="0.9" />
                  <text x="424" y="496" textAnchor="middle" fontSize="18" fontWeight="bold" fill={latest?.rear_right && latest.rear_right < 35 ? '#ef4444' : '#a855f7'} fontFamily="system-ui">{latest?.rear_right?.toFixed(1) ?? '--'}</text>
                  <text x="424" y="514" textAnchor="middle" fontSize="9" fill="#9ca3af" fontFamily="system-ui">REAR RIGHT</text>
                </g>

                {/* Pulse rings on tires when low */}
                {latest?.front_left && latest.front_left < 35 && (
                  <circle cx="120" cy="200" r="30" fill="none" stroke="#ef4444" strokeWidth="2" opacity="0">
                    <animate attributeName="r" values="25;45" dur="1.5s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.6;0" dur="1.5s" repeatCount="indefinite" />
                  </circle>
                )}
                {latest?.front_right && latest.front_right < 35 && (
                  <circle cx="360" cy="200" r="30" fill="none" stroke="#ef4444" strokeWidth="2" opacity="0">
                    <animate attributeName="r" values="25;45" dur="1.5s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.6;0" dur="1.5s" repeatCount="indefinite" />
                  </circle>
                )}
                {latest?.rear_left && latest.rear_left < 35 && (
                  <circle cx="120" cy="500" r="30" fill="none" stroke="#ef4444" strokeWidth="2" opacity="0">
                    <animate attributeName="r" values="25;45" dur="1.5s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.6;0" dur="1.5s" repeatCount="indefinite" />
                  </circle>
                )}
                {latest?.rear_right && latest.rear_right < 35 && (
                  <circle cx="360" cy="500" r="30" fill="none" stroke="#ef4444" strokeWidth="2" opacity="0">
                    <animate attributeName="r" values="25;45" dur="1.5s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.6;0" dur="1.5s" repeatCount="indefinite" />
                  </circle>
                )}

                {/* Scan line animation */}
                <line x1="140" y1="0" x2="340" y2="0" stroke="#00f0ff" strokeWidth="2" opacity="0.15">
                  <animate attributeName="y1" values="30;670" dur="4s" repeatCount="indefinite" />
                  <animate attributeName="y2" values="30;670" dur="4s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0;0.2;0" dur="4s" repeatCount="indefinite" />
                </line>
              </svg>
            </div>
          </GlassPanel>
        </>
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
              <YAxis domain={[28, 52]} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <Tooltip content={<ChartTooltip />} />
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
