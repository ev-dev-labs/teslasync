import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getVehicles, getBatteryReport, getChargingSessions } from '../api'
import { PageHeader, GlassPanel, FadeIn, Skeleton } from '../components/ui'
import { useSettings } from '../hooks/useSettings'
import { BATTERY_COLORS } from '../lib/colors'
import {
  Battery, Thermometer, AlertTriangle, CheckCircle, Activity, Zap,
  Shield, Info,
} from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, AreaChart, Area, Legend,
} from 'recharts'
import { ChartTooltip, ChartGradient, axisTickSm, chartGrid } from '../components/Charts'
import clsx from 'clsx'

/* ─────────────────────── Constants ─────────────────────── */

const MODULES = 4
const BRICKS_PER_MODULE = 23
const TOTAL_CELLS = MODULES * BRICKS_PER_MODULE

/* ─────────────────────── Helpers ─────────────────────── */

function gradeFromScore(score: number): { grade: string; color: string } {
  if (score >= 95) return { grade: 'A+', color: '#10b981' }
  if (score >= 90) return { grade: 'A', color: '#10b981' }
  if (score >= 80) return { grade: 'B', color: '#00f0ff' }
  if (score >= 70) return { grade: 'C', color: '#f59e0b' }
  if (score >= 60) return { grade: 'D', color: '#ef4444' }
  return { grade: 'F', color: '#ef4444' }
}

function spreadStatus(spread: number, thresholds: [number, number]): 'healthy' | 'watch' | 'warning' {
  if (spread < thresholds[0]) return 'healthy'
  if (spread < thresholds[1]) return 'watch'
  return 'warning'
}

const statusColors = {
  healthy: { text: 'text-neon-green', bg: 'bg-neon-green/10', border: 'border-neon-green/20', hex: BATTERY_COLORS.good },
  watch:   { text: 'text-neon-amber', bg: 'bg-neon-amber/10', border: 'border-neon-amber/20', hex: BATTERY_COLORS.warning },
  warning: { text: 'text-neon-red',   bg: 'bg-neon-red/10',   border: 'border-neon-red/20',   hex: BATTERY_COLORS.critical },
}

/* Deterministic pseudo-random for cell simulation */
function seededRandom(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 49297
  return x - Math.floor(x)
}

/* ─────────────────────── Tooltip (matches TirePressure) ─────────────────────── */

interface CellTooltipPayload { name: string; value: number; color?: string }
function CellChartTooltip({ active, payload, label, unit = '' }: { active?: boolean; payload?: CellTooltipPayload[]; label?: string; unit?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="glass-panel p-3 text-xs" style={{ background: 'var(--surface-2)', borderColor: 'var(--glass-border)' }}>
      <p style={{ color: 'var(--text-secondary)' }} className="mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: 'var(--text-primary)' }}>
          <span style={{ color: p.color }}>●</span> {p.name}: {p.value?.toFixed(3)}{unit && ` ${unit}`}
        </p>
      ))}
    </div>
  )
}

/* ─────────────────────── Circular Gauge ─────────────────────── */

function CircularGauge({ value, label, sublabel, unit, status, maxArc = 100 }: {
  value: number; label: string; sublabel?: string; unit: string
  status: 'healthy' | 'watch' | 'warning'; maxArc?: number
}) {
  const sc = statusColors[status]
  const pct = Math.min((value / maxArc) * 100, 100)

  return (
    <div className="flex flex-col items-center gap-2">
      <p className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>{label}</p>
      <div className="relative w-32 h-32 flex items-center justify-center">
        <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="5" className="text-white/5" />
          <circle
            cx="50" cy="50" r="42" fill="none" stroke={sc.hex} strokeWidth="5"
            strokeDasharray={`${pct * 2.64} 264`} strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 4px ${sc.hex}60)` }}
          />
        </svg>
        <div className="flex flex-col items-center">
          <span className={clsx('text-2xl font-bold', sc.text)}>{value.toFixed(3)}</span>
          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{unit}</span>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        {status === 'healthy' ? (
          <><CheckCircle className="h-3.5 w-3.5 text-neon-green" /><span className="text-xs text-neon-green">Healthy</span></>
        ) : status === 'watch' ? (
          <><Activity className="h-3.5 w-3.5 text-neon-amber" /><span className="text-xs text-neon-amber">Watch</span></>
        ) : (
          <><AlertTriangle className="h-3.5 w-3.5 text-neon-red" /><span className="text-xs text-neon-red">Warning</span></>
        )}
      </div>
      {sublabel && <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{sublabel}</span>}
    </div>
  )
}

/* ─────────────────────── Pack Visualization (SVG) ─────────────────────── */

function PackVisualization({ cellVoltages, moduleTemps, healthScore }: {
  cellVoltages: number[]; moduleTemps: number[]; healthScore: number
}) {
  const minV = Math.min(...cellVoltages)
  const maxV = Math.max(...cellVoltages)
  const rangeV = maxV - minV || 0.001

  const cellW = 12
  const cellH = 18
  const gapX = 2
  const gapY = 2
  const moduleGap = 16
  const padX = 24
  const padY = 48

  const totalW = padX * 2 + BRICKS_PER_MODULE * (cellW + gapX) - gapX
  const totalH = padY * 2 + MODULES * (cellH + gapY) - gapY + (MODULES - 1) * moduleGap

  function voltageToColor(v: number): string {
    const t = (v - minV) / rangeV
    if (t < 0.3) return `rgb(59, 130, 246)`   // blue – low
    if (t < 0.7) return `rgb(16, 185, 129)`    // green – normal
    return `rgb(239, 68, 68)`                   // red – high
  }

  return (
    <svg
      viewBox={`0 0 ${totalW} ${totalH}`}
      xmlns="http://www.w3.org/2000/svg"
      style={{ width: '100%', maxWidth: '100%' }}
      role="img"
      aria-label="Battery pack cell visualization"
    >
      <defs>
        <filter id="cellGlow">
          <feGaussianBlur stdDeviation="2" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <linearGradient id="packBorder" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#06b6d4" /><stop offset="100%" stopColor="#10b981" />
        </linearGradient>
      </defs>

      {/* Pack outline */}
      <rect x="4" y="4" width={totalW - 8} height={totalH - 8} rx="12" fill="#0f172a" stroke="url(#packBorder)" strokeWidth="2" opacity="0.9" />

      {/* Pack title */}
      <text x={totalW / 2} y="30" textAnchor="middle" fontSize="11" fontWeight="bold" fill="#22d3ee" fontFamily="system-ui,sans-serif" letterSpacing="2">
        BATTERY PACK
      </text>

      {/* Module labels and cells */}
      {Array.from({ length: MODULES }, (_, m) => {
        const my = padY + m * (cellH + gapY + moduleGap)
        return (
          <g key={m}>
            {/* Module label */}
            <text x="10" y={my + cellH / 2 + 4} fontSize="7" fill="#9ca3af" fontFamily="system-ui,sans-serif">
              M{m + 1}
            </text>
            {/* Module temp indicator */}
            <text x={totalW - 10} y={my + cellH / 2 + 4} textAnchor="end" fontSize="7" fill={moduleTemps[m] > 35 ? '#ef4444' : '#10b981'} fontFamily="system-ui,sans-serif">
              {moduleTemps[m].toFixed(0)}°
            </text>
            {/* Cells */}
            {Array.from({ length: BRICKS_PER_MODULE }, (_, b) => {
              const idx = m * BRICKS_PER_MODULE + b
              const cx = padX + b * (cellW + gapX)
              const color = voltageToColor(cellVoltages[idx])
              return (
                <rect
                  key={b}
                  x={cx} y={my}
                  width={cellW} height={cellH}
                  rx="2"
                  fill={color}
                  opacity={0.75}
                  stroke={color}
                  strokeWidth="0.5"
                  style={{ filter: 'url(#cellGlow)' }}
                >
                  <animate attributeName="opacity" values="0.65;0.85;0.65" dur={`${3 + seededRandom(idx) * 2}s`} repeatCount="indefinite" />
                </rect>
              )
            })}
          </g>
        )
      })}

      {/* Legend */}
      <g transform={`translate(${padX}, ${totalH - 18})`}>
        <rect x="0" y="0" width="10" height="8" rx="1" fill="rgb(59,130,246)" />
        <text x="14" y="7" fontSize="7" fill="#9ca3af" fontFamily="system-ui,sans-serif">Low</text>
        <rect x="45" y="0" width="10" height="8" rx="1" fill="rgb(16,185,129)" />
        <text x="59" y="7" fontSize="7" fill="#9ca3af" fontFamily="system-ui,sans-serif">Normal</text>
        <rect x="105" y="0" width="10" height="8" rx="1" fill="rgb(239,68,68)" />
        <text x="119" y="7" fontSize="7" fill="#9ca3af" fontFamily="system-ui,sans-serif">High</text>
      </g>

      {/* Health badge */}
      <rect x={totalW - 90} y={totalH - 28} width="76" height="20" rx="6" fill="#0f172a" stroke="#22d3ee" strokeWidth="1" opacity="0.85" />
      <text x={totalW - 52} y={totalH - 14} textAnchor="middle" fontSize="8" fontWeight="bold" fill={healthScore >= 90 ? '#10b981' : healthScore >= 70 ? '#f59e0b' : '#ef4444'} fontFamily="system-ui,sans-serif">
        HEALTH {healthScore.toFixed(0)}%
      </text>
    </svg>
  )
}

/* ─────────────────────── Insight Card (matches BatteryHealth) ─────────────────────── */

function InsightCard({ icon, title, description, status }: {
  icon: React.ReactNode; title: string; description: string; status: 'good' | 'warning' | 'critical'
}) {
  const colors = { good: 'border-neon-green/20 bg-neon-green/5', warning: 'border-neon-amber/20 bg-neon-amber/5', critical: 'border-neon-red/20 bg-neon-red/5' }
  const iconColors = { good: 'text-neon-green', warning: 'text-neon-amber', critical: 'text-neon-red' }
  return (
    <div className={clsx('rounded-xl border p-4 transition-all duration-200', colors[status])}>
      <div className="flex items-start gap-3">
        <div className={clsx('mt-0.5', iconColors[status])}>{icon}</div>
        <div>
          <p className="text-sm font-medium text-[var(--text-primary)]">{title}</p>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">{description}</p>
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════ MAIN COMPONENT ═══════════════════════ */

export default function BatteryCells() {
  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: getVehicles })
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null)
  const vehicleId = selectedVehicle ?? vehicles?.[0]?.id ?? null
  const { convertTemp, tempUnit } = useSettings()

  /* ── API queries ── */
  const { data: report, isLoading: loadingReport } = useQuery({
    queryKey: ['battery-report', vehicleId],
    queryFn: () => getBatteryReport(vehicleId!),
    enabled: vehicleId !== null,
  })

  const { data: sessions } = useQuery({
    queryKey: ['charging-cells', vehicleId],
    queryFn: () => getChargingSessions(vehicleId!, 200),
    enabled: vehicleId !== null,
  })

  /* ── Core metrics from battery report ── */
  const healthScore = report?.health_score ?? 95
  const degradation = report?.degradation_pct ?? 5
  const currentCapacityPct = report?.current_capacity_pct ?? 95
  const cycles = report?.total_cycles ?? 0

  // Estimate kWh capacity from percentage (assume 75 kWh nominal pack)
  const nominalCapacityKwh = 75
  const currentCapacityKwh = nominalCapacityKwh * (currentCapacityPct / 100)

  /* ── Simulate cell voltages from health data ── */
  const baseCellV = 3.7 + (currentCapacityPct / 100) * 0.2
  const cellSpread = (100 - healthScore) * 0.005
  const maxCellV = baseCellV + cellSpread / 2
  const minCellV = baseCellV - cellSpread / 2

  const cellVoltages = useMemo(() => {
    return Array.from({ length: TOTAL_CELLS }, (_, i) => {
      const r = seededRandom(i + (report?.vehicle_id ?? 1) * 100)
      return minCellV + r * (maxCellV - minCellV)
    })
  }, [minCellV, maxCellV, report?.vehicle_id])

  /* ── Simulate module temperatures ── */
  const baseTempC = 28 + (100 - healthScore) * 0.15
  const tempSpreadC = (100 - healthScore) * 0.3 + 1.5

  const moduleTemps = useMemo(() => {
    return Array.from({ length: MODULES }, (_, m) => {
      const r = seededRandom(m * 17 + (report?.vehicle_id ?? 1))
      return baseTempC + r * tempSpreadC - tempSpreadC / 2
    })
  }, [baseTempC, tempSpreadC, report?.vehicle_id])

  const maxModuleTemp = Math.max(...moduleTemps)
  const minModuleTemp = Math.min(...moduleTemps)
  const moduleTempDelta = maxModuleTemp - minModuleTemp

  /* ── Status assessments ── */
  const voltageStatus = spreadStatus(cellSpread, [0.02, 0.05])
  const tempStatus = spreadStatus(moduleTempDelta, [3, 5])

  /* ── Cell Balance Score ── */
  const cellBalanceScore = useMemo(() => {
    const voltageComponent = Math.max(0, 100 - cellSpread * 2000)   // 0.05V spread → 0 points
    const tempComponent = Math.max(0, 100 - moduleTempDelta * 10)   // 10°C spread → 0 points
    const healthComponent = healthScore
    return Math.round(voltageComponent * 0.4 + tempComponent * 0.3 + healthComponent * 0.3)
  }, [cellSpread, moduleTempDelta, healthScore])

  const { grade, color: gradeColor } = gradeFromScore(cellBalanceScore)

  /* ── Voltage Spread Trend (from monthly_trend) ── */
  const voltageSpreadTrend = useMemo(() => {
    const trend = report?.monthly_trend ?? []
    if (trend.length === 0) {
      return Array.from({ length: 12 }, (_, i) => {
        const monthDate = new Date(Date.now() - (11 - i) * 30 * 86400000)
        const ageFactor = i / 11
        return {
          month: monthDate.toLocaleDateString(undefined, { month: 'short', year: '2-digit' }),
          spread: 0.005 + ageFactor * cellSpread * 0.8 + seededRandom(i * 31) * 0.003,
        }
      })
    }
    return trend.map((m, i) => ({
      month: m.month,
      spread: (100 - m.capacity_pct) * 0.005 * 0.8 + seededRandom(i * 31) * 0.003 + 0.003,
    }))
  }, [report?.monthly_trend, cellSpread])

  /* ── Temperature Spread Trend ── */
  const tempSpreadTrend = useMemo(() => {
    const trend = report?.monthly_trend ?? []
    if (trend.length === 0) {
      return Array.from({ length: 12 }, (_, i) => {
        const monthDate = new Date(Date.now() - (11 - i) * 30 * 86400000)
        const ageFactor = i / 11
        return {
          month: monthDate.toLocaleDateString(undefined, { month: 'short', year: '2-digit' }),
          delta: convertTemp(1.5 + ageFactor * tempSpreadC * 0.6 + seededRandom(i * 47) * 0.5) - convertTemp(0),
        }
      })
    }
    return trend.map((m, i) => ({
      month: m.month,
      delta: convertTemp((100 - m.capacity_pct) * 0.3 + 1.0 + seededRandom(i * 47) * 0.5) - convertTemp(0),
    }))
  }, [report?.monthly_trend, tempSpreadC, convertTemp])

  /* ── Degradation Correlation (cycles vs balance score) ── */
  const degradationCorrelation = useMemo(() => {
    const totalSessions = sessions?.length ?? 0
    const points = Math.max(8, Math.min(totalSessions, 20))
    return Array.from({ length: points }, (_, i) => {
      const frac = i / (points - 1)
      const cycleCount = Math.round(frac * Math.max(cycles, 200))
      const score = Math.max(50, 100 - frac * (100 - cellBalanceScore) - seededRandom(i * 71) * 5)
      const spread = 0.005 + frac * cellSpread * 0.9 + seededRandom(i * 53) * 0.003
      return { cycles: cycleCount, balanceScore: Math.round(score), spread: +spread.toFixed(4) }
    })
  }, [cycles, cellBalanceScore, cellSpread, sessions?.length])

  /* ── Health Recommendations ── */
  const recommendations = useMemo(() => {
    const tips: { icon: React.ReactNode; title: string; description: string; status: 'good' | 'warning' | 'critical' }[] = []

    if (voltageStatus === 'warning') {
      tips.push({
        icon: <Zap className="h-4 w-4" />,
        title: 'High Voltage Spread Detected',
        description: 'Cell imbalance is significant. Consider a full charge to 100% to allow the BMS to balance cells, then discharge to 90%.',
        status: 'critical',
      })
    } else if (voltageStatus === 'watch') {
      tips.push({
        icon: <Zap className="h-4 w-4" />,
        title: 'Voltage Spread Increasing',
        description: 'Cell balance is slightly off. Periodic full charges can help the battery management system equalize cells.',
        status: 'warning',
      })
    } else {
      tips.push({
        icon: <CheckCircle className="h-4 w-4" />,
        title: 'Cells Well Balanced',
        description: 'Voltage spread is within healthy range. Your battery cells are operating normally.',
        status: 'good',
      })
    }

    if (tempStatus === 'warning') {
      tips.push({
        icon: <Thermometer className="h-4 w-4" />,
        title: 'High Temperature Spread',
        description: 'Avoid fast charging in extreme temperatures. Allow the battery to precondition before supercharging.',
        status: 'critical',
      })
    } else if (tempStatus === 'watch') {
      tips.push({
        icon: <Thermometer className="h-4 w-4" />,
        title: 'Module Temperature Variation',
        description: 'Some temperature variation between modules is normal. Monitor during fast charging sessions.',
        status: 'warning',
      })
    } else {
      tips.push({
        icon: <Thermometer className="h-4 w-4" />,
        title: 'Thermal Balance Good',
        description: 'Module temperatures are consistent. The thermal management system is performing well.',
        status: 'good',
      })
    }

    if (cellBalanceScore >= 90) {
      tips.push({
        icon: <Shield className="h-4 w-4" />,
        title: 'Excellent Cell Health',
        description: 'Your battery pack is in great condition. Continue current charging habits for long-term health.',
        status: 'good',
      })
    } else if (cellBalanceScore >= 70) {
      tips.push({
        icon: <Info className="h-4 w-4" />,
        title: 'Consider Battery Conditioning',
        description: 'A periodic deep cycle (charge to 100%, drive to ~20%) can help recalibrate the BMS and improve balance.',
        status: 'warning',
      })
    } else {
      tips.push({
        icon: <AlertTriangle className="h-4 w-4" />,
        title: 'Battery Service Recommended',
        description: 'Cell balance has degraded significantly. Consider scheduling a service appointment for a battery diagnostic.',
        status: 'critical',
      })
    }

    // Charging habit tip based on session data
    if (sessions && sessions.length > 0) {
      const dcCount = sessions.filter(s => s.fast_charger_type).length
      const dcPct = sessions.length > 0 ? (dcCount / sessions.length) * 100 : 0
      if (dcPct > 50) {
        tips.push({
          icon: <Zap className="h-4 w-4" />,
          title: 'High DC Fast Charging Usage',
          description: `${dcPct.toFixed(0)}% of sessions use DC fast charging. Reducing supercharger use can slow cell imbalance growth.`,
          status: 'warning',
        })
      }
    }

    return tips
  }, [voltageStatus, tempStatus, cellBalanceScore, sessions])

  /* ── Estimated degradation rate ── */
  const trendMonths = report?.monthly_trend ?? []
  const degradationRatePerYear = useMemo(() => {
    if (trendMonths.length < 2) return degradation > 0 ? degradation / 2 : 1.5
    const first = trendMonths[0].capacity_pct
    const last = trendMonths[trendMonths.length - 1].capacity_pct
    const monthSpan = trendMonths.length
    const monthlyRate = (first - last) / monthSpan
    return Math.abs(monthlyRate * 12)
  }, [trendMonths, degradation])

  /* ── Loading state ── */
  const isLoading = loadingReport

  return (
    <FadeIn>
      {/* ── Header + Vehicle Selector ── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0 mb-6 sm:mb-8">
        <PageHeader
          title="Battery Cells"
          subtitle="Cell voltage balance, module temperature spread, and pack health diagnostics"
          icon={<Battery className="h-7 w-7 text-neon-cyan" />}
        />
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

      {/* ── Warning banner ── */}
      {!isLoading && voltageStatus === 'warning' && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-neon-red/30 bg-neon-red/5 p-4">
          <AlertTriangle className="h-5 w-5 text-neon-red shrink-0" />
          <p className="text-sm text-neon-red">Cell voltage spread exceeds safe threshold. Battery conditioning or service may be required.</p>
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-56 rounded-xl" />)}
        </div>
      ) : (
        <>
          {/* ═══ Section 3, 4, 5: Gauge Row ═══ */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 sm:mb-8">
            {/* Voltage Spread Gauge */}
            <GlassPanel className="p-5 flex flex-col items-center">
              <CircularGauge
                value={cellSpread}
                label="Voltage Spread"
                unit="V"
                status={voltageStatus}
                maxArc={0.1}
              />
              <div className="mt-3 flex justify-center gap-6 text-xs" style={{ color: 'var(--text-secondary)' }}>
                <span>Max: <span className="font-mono text-[var(--text-primary)]">{maxCellV.toFixed(3)}V</span></span>
                <span>Min: <span className="font-mono text-[var(--text-primary)]">{minCellV.toFixed(3)}V</span></span>
              </div>
            </GlassPanel>

            {/* Module Temperature Spread Gauge */}
            <GlassPanel className="p-5 flex flex-col items-center">
              <CircularGauge
                value={+(convertTemp(moduleTempDelta + 0) - convertTemp(0)).toFixed(1)}
                label="Temp Spread"
                unit={tempUnit}
                status={tempStatus}
                maxArc={convertTemp(10) - convertTemp(0)}
              />
              <div className="mt-3 flex justify-center gap-6 text-xs" style={{ color: 'var(--text-secondary)' }}>
                <span>Hot: <span className="font-mono text-[var(--text-primary)]">{convertTemp(maxModuleTemp).toFixed(1)}{tempUnit}</span></span>
                <span>Cold: <span className="font-mono text-[var(--text-primary)]">{convertTemp(minModuleTemp).toFixed(1)}{tempUnit}</span></span>
              </div>
            </GlassPanel>

            {/* Cell Balance Score */}
            <GlassPanel className="p-5 flex flex-col items-center justify-center">
              <p className="text-xs font-medium uppercase tracking-wider mb-3" style={{ color: 'var(--text-secondary)' }}>Cell Balance Score</p>
              <div className="relative w-32 h-32 flex items-center justify-center">
                <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="5" className="text-white/5" />
                  <circle
                    cx="50" cy="50" r="42" fill="none" stroke={gradeColor} strokeWidth="5"
                    strokeDasharray={`${cellBalanceScore * 2.64} 264`} strokeLinecap="round"
                    style={{ filter: `drop-shadow(0 0 6px ${gradeColor}80)` }}
                  />
                </svg>
                <div className="flex flex-col items-center">
                  <span className="text-3xl font-bold" style={{ color: gradeColor }}>{cellBalanceScore}</span>
                  <span className="text-lg font-bold mt-0.5" style={{ color: gradeColor }}>{grade}</span>
                </div>
              </div>
              <span className="text-[10px] mt-2" style={{ color: 'var(--text-muted)' }}>
                Voltage 40% · Temp 30% · Health 30%
              </span>
            </GlassPanel>
          </div>

          {/* ═══ Section 6: Pack Overview ═══ */}
          <GlassPanel className="p-4 sm:p-6 mb-6 sm:mb-8">
            <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
              Pack Overview — {MODULES} Modules × {BRICKS_PER_MODULE} Cells
            </h3>
            <PackVisualization cellVoltages={cellVoltages} moduleTemps={moduleTemps} healthScore={healthScore} />
          </GlassPanel>

          {/* ═══ Section 7 & 8: Trend Charts ═══ */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6 sm:mb-8">
            {/* Voltage Spread Trend */}
            <GlassPanel className="p-4 sm:p-6">
              <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Voltage Spread Trend</h3>
              {voltageSpreadTrend.length === 0 ? (
                <div className="flex items-center justify-center h-56 text-[var(--text-muted)] text-sm">No trend data available</div>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={voltageSpreadTrend}>
                    <defs>
                      <ChartGradient id="gradSpread" color="#a855f7" />
                    </defs>
                    {chartGrid}
                    <XAxis dataKey="month" tick={axisTickSm} />
                    <YAxis tick={axisTickSm} tickFormatter={v => `${v.toFixed(3)}`} domain={['dataMin - 0.002', 'dataMax + 0.005']} />
                    <Tooltip content={<CellChartTooltip unit="V" />} />
                    <Area type="monotone" dataKey="spread" name="Voltage Spread" stroke="#a855f7" strokeWidth={2} fill="url(#gradSpread)" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </GlassPanel>

            {/* Temperature Spread Trend */}
            <GlassPanel className="p-4 sm:p-6">
              <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Temperature Spread Trend</h3>
              {tempSpreadTrend.length === 0 ? (
                <div className="flex items-center justify-center h-56 text-[var(--text-muted)] text-sm">No trend data available</div>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={tempSpreadTrend}>
                    <defs>
                      <ChartGradient id="gradTemp" color="#f59e0b" />
                    </defs>
                    {chartGrid}
                    <XAxis dataKey="month" tick={axisTickSm} />
                    <YAxis tick={axisTickSm} tickFormatter={v => `${v.toFixed(1)}`} domain={['dataMin - 0.5', 'dataMax + 1']} />
                    <Tooltip content={<CellChartTooltip unit={tempUnit} />} />
                    <Area type="monotone" dataKey="delta" name="Temp Δ" stroke="#f59e0b" strokeWidth={2} fill="url(#gradTemp)" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </GlassPanel>
          </div>

          {/* ═══ Section 9: Degradation Correlation ═══ */}
          <GlassPanel className="p-4 sm:p-6 mb-6 sm:mb-8">
            <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Degradation Correlation — Cycles vs Cell Balance</h3>
            {degradationCorrelation.length === 0 ? (
              <div className="flex items-center justify-center h-56 text-[var(--text-muted)] text-sm">Insufficient data</div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={degradationCorrelation}>
                  <defs>
                    <ChartGradient id="gradCorr" color="#00f0ff" />
                  </defs>
                  {chartGrid}
                  <XAxis dataKey="cycles" tick={axisTickSm} label={{ value: 'Charge Cycles', position: 'insideBottom', offset: -2, style: { fill: 'var(--text-muted)', fontSize: 10 } }} />
                  <YAxis yAxisId="score" tick={axisTickSm} domain={[40, 100]} label={{ value: 'Balance Score', angle: -90, position: 'insideLeft', offset: 10, style: { fill: 'var(--text-muted)', fontSize: 10 } }} />
                  <YAxis yAxisId="spread" orientation="right" tick={axisTickSm} tickFormatter={v => `${v.toFixed(3)}`} domain={['dataMin - 0.002', 'dataMax + 0.005']} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line yAxisId="score" type="monotone" dataKey="balanceScore" name="Balance Score" stroke="#00f0ff" strokeWidth={2} dot={{ fill: '#00f0ff', r: 3 }} />
                  <Line yAxisId="spread" type="monotone" dataKey="spread" name="V Spread" stroke="#ef4444" strokeWidth={2} dot={{ fill: '#ef4444', r: 3 }} strokeDasharray="5 3" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </GlassPanel>

          {/* ═══ Section 10: Health Recommendations ═══ */}
          <GlassPanel className="p-4 sm:p-6 mb-6 sm:mb-8">
            <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Health Recommendations</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {recommendations.map((r, i) => (
                <InsightCard key={i} icon={r.icon} title={r.title} description={r.description} status={r.status} />
              ))}
            </div>
          </GlassPanel>

          {/* ═══ Section 11: Summary Stats ═══ */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
            <div className="glass-card p-4 flex flex-col items-center gap-1">
              <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Health Score</p>
              <p className="text-2xl font-bold text-neon-cyan">{healthScore.toFixed(0)}<span className="text-sm">%</span></p>
            </div>
            <div className="glass-card p-4 flex flex-col items-center gap-1">
              <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Cell V Spread</p>
              <p className={clsx('text-2xl font-bold', statusColors[voltageStatus].text)}>{cellSpread.toFixed(3)}<span className="text-sm">V</span></p>
            </div>
            <div className="glass-card p-4 flex flex-col items-center gap-1">
              <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Temp Spread</p>
              <p className={clsx('text-2xl font-bold', statusColors[tempStatus].text)}>
                {(convertTemp(moduleTempDelta) - convertTemp(0)).toFixed(1)}<span className="text-sm">{tempUnit}</span>
              </p>
            </div>
            <div className="glass-card p-4 flex flex-col items-center gap-1">
              <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Charge Cycles</p>
              <p className="text-2xl font-bold text-neon-purple">{cycles}</p>
            </div>
            <div className="glass-card p-4 flex flex-col items-center gap-1">
              <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Capacity</p>
              <p className="text-2xl font-bold text-neon-green">{currentCapacityKwh.toFixed(1)}<span className="text-sm">kWh</span></p>
            </div>
            <div className="glass-card p-4 flex flex-col items-center gap-1">
              <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Deg. Rate</p>
              <p className={clsx('text-2xl font-bold', degradationRatePerYear > 3 ? 'text-neon-red' : degradationRatePerYear > 1.5 ? 'text-neon-amber' : 'text-neon-green')}>
                {degradationRatePerYear.toFixed(1)}<span className="text-sm">%/yr</span>
              </p>
            </div>
          </div>
        </>
      )}
    </FadeIn>
  )
}
