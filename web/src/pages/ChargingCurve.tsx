import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getVehicles, getChargingSessions, type ChargingSession } from '../api'
import { PageHeader, GlassPanel, FadeIn, Skeleton } from '../components/ui'
import {
  Zap,
  BatteryCharging,
  Clock,
  DollarSign,
  TrendingDown,
  Activity,
  BarChart3,
} from 'lucide-react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  AreaChart,
  Area,
  ComposedChart,
  Bar,
} from 'recharts'
import clsx from 'clsx'
import { formatDateShort, formatDateTime } from '../lib/dateFormat'
import { useSettings } from '../hooks/useSettings'
import { fmtNumber, fmtInt, fmtWithUnit } from '../lib/numberFormat'

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------
interface CurveTooltipPayload {
  name: string
  value: number
  color?: string
}

function CurveTooltip({
  active,
  payload,
  label,
  unit = 'kW',
}: {
  active?: boolean
  payload?: CurveTooltipPayload[]
  label?: string
  unit?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div
      className="glass-panel p-3 text-xs"
      style={{
        background: 'var(--surface-2)',
        borderColor: 'var(--glass-border)',
      }}
    >
      <p style={{ color: 'var(--text-secondary)' }} className="mb-1">
        {label}
      </p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: 'var(--text-primary)' }}>
          <span style={{ color: p.color }}>●</span> {p.name}:{' '}
          {fmtNumber(p.value)} {unit}
        </p>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Charging curve simulation
// ---------------------------------------------------------------------------
function generateChargingCurve(
  session: ChargingSession,
): { soc: number; kw: number }[] {
  const start = session.start_battery_level ?? 20
  const end = session.end_battery_level ?? 80
  const maxPower = session.charger_power ?? 50
  const isDC = maxPower > 20
  const points: { soc: number; kw: number }[] = []

  for (let soc = start; soc <= end; soc += 1) {
    let kw: number
    if (!isDC) {
      kw = maxPower
    } else {
      if (soc < 50) kw = maxPower
      else if (soc < 80) kw = maxPower * (1 - (soc - 50) / 60)
      else kw = maxPower * 0.3 * (1 - (soc - 80) / 40)
    }
    points.push({ soc, kw: Math.max(kw, 5) })
  }
  return points
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const CURVE_COLORS = [
  '#00f0ff',
  '#a855f7',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#3b82f6',
  '#ec4899',
  '#14b8a6',
  '#f97316',
  '#8b5cf6',
]

function chargerLabel(session: ChargingSession): string {
  if (session.fast_charger_type) return session.fast_charger_type
  if ((session.charger_power ?? 0) > 20) return 'DC'
  return 'Home / AC'
}

function chargerColor(session: ChargingSession): string {
  const label = chargerLabel(session).toLowerCase()
  if (label.includes('supercharger') || label.includes('tesla')) return '#00f0ff'
  if (label.includes('home') || label.includes('ac')) return '#10b981'
  return '#f59e0b'
}

function sessionLabel(session: ChargingSession): string {
  const date = formatDateShort(session.start_date)
  return `${date} · ${chargerLabel(session)} · ${fmtWithUnit(session.charge_energy_added, 'kWh', 1)}`
}

function fmtDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------
export default function ChargingCurve() {
  const { data: vehicles } = useQuery({
    queryKey: ['vehicles'],
    queryFn: getVehicles,
  })
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null)
  const vehicleId = selectedVehicle ?? vehicles?.[0]?.id ?? null
  const { convertDistance, distanceUnit } = useSettings()

  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(
    null,
  )

  // Fetch recent sessions
  const { data: sessions, isLoading: loadingSessions } = useQuery({
    queryKey: ['charging-sessions', vehicleId],
    queryFn: () => getChargingSessions(vehicleId!, 100),
    enabled: vehicleId !== null,
  })

  const selectedSession = useMemo(
    () =>
      sessions?.find((s) => s.id === selectedSessionId) ?? sessions?.[0] ?? null,
    [sessions, selectedSessionId],
  )

  // -----------------------------------------------------------------------
  // Section 3 – Selected session curve
  // -----------------------------------------------------------------------
  const selectedCurve = useMemo(
    () => (selectedSession ? generateChargingCurve(selectedSession) : []),
    [selectedSession],
  )

  // -----------------------------------------------------------------------
  // Section 5 – Comparison (last 10 sessions)
  // -----------------------------------------------------------------------
  const comparisonSessions = useMemo(
    () => (sessions ?? []).slice(0, 10),
    [sessions],
  )

  const comparisonData = useMemo(() => {
    if (comparisonSessions.length === 0) return []
    const curves = comparisonSessions.map((s) => ({
      id: s.id,
      curve: generateChargingCurve(s),
    }))
    const allSocs = new Set<number>()
    curves.forEach((c) => c.curve.forEach((p) => allSocs.add(p.soc)))
    const sortedSocs = Array.from(allSocs).sort((a, b) => a - b)

    return sortedSocs.map((soc) => {
      const row: Record<string, number> = { soc }
      curves.forEach((c) => {
        const pt = c.curve.find((p) => p.soc === soc)
        if (pt) row[`s${c.id}`] = pt.kw
      })
      return row
    })
  }, [comparisonSessions])

  // -----------------------------------------------------------------------
  // Section 6 – Charge rate by charger type
  // -----------------------------------------------------------------------
  const chargerTypeStats = useMemo(() => {
    if (!sessions || sessions.length === 0) return []
    const groups: Record<
      string,
      { totalKw: number; totalDur: number; totalEnergy: number; count: number }
    > = {}
    for (const s of sessions) {
      const label = chargerLabel(s)
      if (!groups[label])
        groups[label] = { totalKw: 0, totalDur: 0, totalEnergy: 0, count: 0 }
      groups[label].totalKw += s.charger_power ?? 0
      groups[label].totalDur += s.duration_min
      groups[label].totalEnergy += s.charge_energy_added
      groups[label].count += 1
    }
    return Object.entries(groups).map(([type, g]) => ({
      type,
      avgKw: g.totalKw / g.count,
      avgDuration: g.totalDur / g.count,
      avgEnergy: g.totalEnergy / g.count,
    }))
  }, [sessions])

  // -----------------------------------------------------------------------
  // Section 7 – Charging speed trend by month
  // -----------------------------------------------------------------------
  const speedTrend = useMemo(() => {
    if (!sessions || sessions.length === 0) return []
    const months: Record<
      string,
      { dcTotal: number; dcCount: number; acTotal: number; acCount: number }
    > = {}
    for (const s of sessions) {
      const key = new Date(s.start_date).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
      })
      if (!months[key])
        months[key] = { dcTotal: 0, dcCount: 0, acTotal: 0, acCount: 0 }
      const isDC = (s.charger_power ?? 0) > 20
      if (isDC) {
        months[key].dcTotal += s.charger_power ?? 0
        months[key].dcCount += 1
      } else {
        months[key].acTotal += s.charger_power ?? 0
        months[key].acCount += 1
      }
    }
    return Object.entries(months)
      .map(([month, g]) => ({
        month,
        dc: g.dcCount > 0 ? g.dcTotal / g.dcCount : null,
        ac: g.acCount > 0 ? g.acTotal / g.acCount : null,
      }))
      .reverse()
  }, [sessions])

  // -----------------------------------------------------------------------
  // Section 8 – Time-to-charge analysis
  // -----------------------------------------------------------------------
  const timeToChargeStats = useMemo(() => {
    if (!sessions || sessions.length === 0)
      return {
        avg10to80: null,
        avg20to80: null,
        fastest: null,
        slowest: null,
        trend: [] as { year: string; avgMin: number }[],
      }

    const dcSessions = sessions.filter((s) => (s.charger_power ?? 0) > 20)

    const spans10to80 = dcSessions
      .filter(
        (s) =>
          s.start_battery_level <= 15 &&
          (s.end_battery_level ?? 0) >= 75,
      )
      .map((s) => s.duration_min)

    const spans20to80 = dcSessions
      .filter(
        (s) =>
          s.start_battery_level <= 25 &&
          (s.end_battery_level ?? 0) >= 75,
      )
      .map((s) => s.duration_min)

    const avg = (arr: number[]) =>
      arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null

    const sorted = [...dcSessions].sort((a, b) => {
      const rateA =
        a.duration_min > 0
          ? a.charge_energy_added / (a.duration_min / 60)
          : 0
      const rateB =
        b.duration_min > 0
          ? b.charge_energy_added / (b.duration_min / 60)
          : 0
      return rateB - rateA
    })

    // Yearly trend
    const years: Record<string, { total: number; count: number }> = {}
    for (const s of dcSessions) {
      const y = new Date(s.start_date).getFullYear().toString()
      if (!years[y]) years[y] = { total: 0, count: 0 }
      years[y].total += s.duration_min
      years[y].count += 1
    }

    return {
      avg10to80: avg(spans10to80),
      avg20to80: avg(spans20to80),
      fastest: sorted[0] ?? null,
      slowest: sorted[sorted.length - 1] ?? null,
      trend: Object.entries(years)
        .map(([year, g]) => ({ year, avgMin: g.total / g.count }))
        .sort((a, b) => a.year.localeCompare(b.year)),
    }
  }, [sessions])

  // -----------------------------------------------------------------------
  // Section 9 – Summary stats
  // -----------------------------------------------------------------------
  const summary = useMemo(() => {
    if (!sessions || sessions.length === 0) return null
    const totalEnergy = sessions.reduce(
      (acc, s) => acc + s.charge_energy_added,
      0,
    )
    const totalCost = sessions.reduce((acc, s) => acc + (s.cost ?? 0), 0)
    const totalDur = sessions.reduce((acc, s) => acc + s.duration_min, 0)
    const powers = sessions
      .map((s) => s.charger_power ?? 0)
      .filter((p) => p > 0)
    const avgKw =
      powers.length > 0 ? powers.reduce((a, b) => a + b, 0) / powers.length : 0
    const maxKw = powers.length > 0 ? Math.max(...powers) : 0
    return {
      count: sessions.length,
      totalEnergy,
      avgKw,
      maxKw,
      avgDuration: totalDur / sessions.length,
      totalCost,
    }
  }, [sessions])

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  return (
    <FadeIn>
      {/* Section 1 – Header + selectors */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0 mb-6 sm:mb-8">
        <PageHeader
          title="Charging Curve"
          subtitle="Charge rate analysis, session comparison, and charging performance trends"
          icon={<Zap className="h-7 w-7 text-neon-cyan" />}
        />
        {vehicles && vehicles.length > 1 && (
          <select
            value={vehicleId ?? ''}
            onChange={(e) => setSelectedVehicle(Number(e.target.value))}
            className="glass-card px-3 py-2 text-sm rounded-lg border-0 focus:ring-1 focus:ring-neon-cyan/50"
            style={{
              background: 'var(--surface-2)',
              color: 'var(--text-primary)',
            }}
          >
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.display_name || v.vin}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Section 2 – Session selector */}
      {sessions && sessions.length > 0 && (
        <div className="mb-6">
          <label
            className="block text-xs font-medium mb-2"
            style={{ color: 'var(--text-secondary)' }}
          >
            Select Charging Session
          </label>
          <select
            value={selectedSession?.id ?? ''}
            onChange={(e) => setSelectedSessionId(Number(e.target.value))}
            className="glass-card px-3 py-2 text-sm rounded-lg border-0 w-full sm:w-auto sm:min-w-[400px] focus:ring-1 focus:ring-neon-cyan/50"
            style={{
              background: 'var(--surface-2)',
              color: 'var(--text-primary)',
            }}
          >
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {sessionLabel(s)}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Loading state */}
      {loadingSessions && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
          <Skeleton className="h-80 rounded-xl" />
          <Skeleton className="h-80 rounded-xl" />
        </div>
      )}

      {!loadingSessions && (!sessions || sessions.length === 0) && (
        <GlassPanel className="p-10 text-center">
          <BatteryCharging className="h-12 w-12 mx-auto mb-3 text-[var(--text-muted)]" />
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            No charging sessions found for this vehicle.
          </p>
        </GlassPanel>
      )}

      {!loadingSessions && selectedSession && (
        <>
          {/* Section 9 – Summary stats */}
          {summary && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 mb-6 sm:mb-8">
              <SummaryCard
                icon={<BatteryCharging className="h-4 w-4" />}
                label="Total Sessions"
                value={String(summary.count)}
                accent="text-neon-cyan"
              />
              <SummaryCard
                icon={<Zap className="h-4 w-4" />}
                label="Total Energy"
                value={fmtWithUnit(summary.totalEnergy, 'kWh', 1)}
                accent="text-neon-green"
              />
              <SummaryCard
                icon={<Activity className="h-4 w-4" />}
                label="Avg Charge Rate"
                value={fmtWithUnit(summary.avgKw, 'kW', 1)}
                accent="text-neon-purple"
              />
              <SummaryCard
                icon={<Zap className="h-4 w-4" />}
                label="Peak Rate"
                value={fmtWithUnit(summary.maxKw, 'kW', 0)}
                accent="text-neon-amber"
              />
              <SummaryCard
                icon={<Clock className="h-4 w-4" />}
                label="Avg Duration"
                value={fmtDuration(summary.avgDuration)}
                accent="text-neon-cyan"
              />
              <SummaryCard
                icon={<DollarSign className="h-4 w-4" />}
                label="Total Cost"
                value={`$${fmtNumber(summary.totalCost, 2)}`}
                accent="text-neon-green"
              />
            </div>
          )}

          {/* Section 3 + 4 – Selected session curve + details */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6 sm:mb-8">
            <GlassPanel className="lg:col-span-2 p-4 sm:p-6">
              <h3
                className="text-sm font-semibold mb-4"
                style={{ color: 'var(--text-primary)' }}
              >
                Charging Curve – {sessionLabel(selectedSession)}
              </h3>
              {selectedCurve.length === 0 ? (
                <div className="flex items-center justify-center h-72 text-[var(--text-muted)] text-sm">
                  No curve data for this session
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <AreaChart data={selectedCurve}>
                    <defs>
                      <linearGradient
                        id="curveGrad"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="5%"
                          stopColor={chargerColor(selectedSession)}
                          stopOpacity={0.4}
                        />
                        <stop
                          offset="95%"
                          stopColor={chargerColor(selectedSession)}
                          stopOpacity={0.05}
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--glass-border)"
                      strokeOpacity={0.5}
                    />
                    <XAxis
                      dataKey="soc"
                      tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                      label={{
                        value: 'SOC %',
                        position: 'insideBottomRight',
                        offset: -5,
                        fontSize: 10,
                        fill: 'var(--text-muted)',
                      }}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                      label={{
                        value: 'kW',
                        angle: -90,
                        position: 'insideLeft',
                        fontSize: 10,
                        fill: 'var(--text-muted)',
                      }}
                    />
                    <Tooltip content={<CurveTooltip unit="kW" />} />
                    <Area
                      type="monotone"
                      dataKey="kw"
                      name="Charge Rate"
                      stroke={chargerColor(selectedSession)}
                      strokeWidth={2}
                      fill="url(#curveGrad)"
                      dot={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </GlassPanel>

            {/* Section 4 – Session details card */}
            <GlassPanel className="p-4 sm:p-6">
              <h3
                className="text-sm font-semibold mb-4"
                style={{ color: 'var(--text-primary)' }}
              >
                Session Details
              </h3>
              <SessionDetailRow
                label="Date"
                value={formatDateTime(selectedSession.start_date)}
              />
              <SessionDetailRow
                label="Duration"
                value={fmtDuration(selectedSession.duration_min)}
              />
              <SessionDetailRow
                label="Energy Added"
                value={fmtWithUnit(selectedSession.charge_energy_added, 'kWh', 1)}
              />
              <SessionDetailRow
                label="Charger Type"
                value={chargerLabel(selectedSession)}
              />
              <SessionDetailRow
                label="Voltage"
                value={
                  selectedSession.charger_voltage != null
                    ? `${selectedSession.charger_voltage} V`
                    : '—'
                }
              />
              <SessionDetailRow
                label="Phases"
                value={
                  selectedSession.charger_phases != null
                    ? String(selectedSession.charger_phases)
                    : '—'
                }
              />
              <SessionDetailRow
                label="Current"
                value={
                  selectedSession.charger_actual_current != null
                    ? `${selectedSession.charger_actual_current} A`
                    : '—'
                }
              />
              <SessionDetailRow
                label="Avg Charge Rate"
                value={
                  selectedSession.duration_min > 0
                    ? fmtWithUnit((selectedSession.charge_energy_added / selectedSession.duration_min) * 60, 'kW', 1)
                    : '—'
                }
              />
              <SessionDetailRow
                label="Cost"
                value={
                  selectedSession.cost != null
                    ? `$${fmtNumber(selectedSession.cost, 2)}`
                    : '—'
                }
              />
              <SessionDetailRow
                label="Cost / kWh"
                value={
                  selectedSession.cost != null &&
                  selectedSession.charge_energy_added > 0
                    ? `$${fmtNumber(selectedSession.cost / selectedSession.charge_energy_added, 3)}/kWh`
                    : '—'
                }
              />
              <SessionDetailRow
                label="Battery"
                value={`${selectedSession.start_battery_level}% → ${selectedSession.end_battery_level ?? '?'}%`}
              />
              <SessionDetailRow
                label="Range Gained"
                value={
                  selectedSession.start_range_km != null &&
                  selectedSession.end_range_km != null
                    ? `+${fmtNumber(convertDistance(selectedSession.end_range_km - selectedSession.start_range_km), 1)} ${distanceUnit}`
                    : '—'
                }
              />
            </GlassPanel>
          </div>

          {/* Section 5 – Session comparison */}
          <GlassPanel className="p-4 sm:p-6 mb-6 sm:mb-8">
            <h3
              className="text-sm font-semibold mb-4"
              style={{ color: 'var(--text-primary)' }}
            >
              Session Comparison (Last {comparisonSessions.length} Sessions)
            </h3>
            {comparisonData.length === 0 ? (
              <div className="flex items-center justify-center h-72 text-[var(--text-muted)] text-sm">
                Not enough data for comparison
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={comparisonData}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--glass-border)"
                    strokeOpacity={0.5}
                  />
                  <XAxis
                    dataKey="soc"
                    tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                    label={{
                      value: 'SOC %',
                      position: 'insideBottomRight',
                      offset: -5,
                      fontSize: 10,
                      fill: 'var(--text-muted)',
                    }}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                    label={{
                      value: 'kW',
                      angle: -90,
                      position: 'insideLeft',
                      fontSize: 10,
                      fill: 'var(--text-muted)',
                    }}
                  />
                  <Tooltip content={<CurveTooltip unit="kW" />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {comparisonSessions.map((s, i) => (
                    <Line
                      key={s.id}
                      type="monotone"
                      dataKey={`s${s.id}`}
                      name={sessionLabel(s)}
                      stroke={CURVE_COLORS[i % CURVE_COLORS.length]}
                      strokeWidth={selectedSession?.id === s.id ? 3 : 1.5}
                      dot={false}
                      strokeOpacity={selectedSession?.id === s.id ? 1 : 0.6}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </GlassPanel>

          {/* Section 6 + 7 – Charger type stats + Speed trend */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6 sm:mb-8">
            {/* Section 6 – Charge rate by charger type */}
            <GlassPanel className="p-4 sm:p-6">
              <h3
                className="text-sm font-semibold mb-4 flex items-center gap-2"
                style={{ color: 'var(--text-primary)' }}
              >
                <BarChart3 className="h-4 w-4 text-neon-cyan" />
                Charge Rate by Charger Type
              </h3>
              {chargerTypeStats.length === 0 ? (
                <div className="flex items-center justify-center h-64 text-[var(--text-muted)] text-sm">
                  No data available
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <ComposedChart data={chargerTypeStats}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--glass-border)"
                      strokeOpacity={0.5}
                    />
                    <XAxis
                      dataKey="type"
                      tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                    />
                    <YAxis
                      yAxisId="kw"
                      tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                      label={{
                        value: 'kW',
                        angle: -90,
                        position: 'insideLeft',
                        fontSize: 10,
                        fill: 'var(--text-muted)',
                      }}
                    />
                    <YAxis
                      yAxisId="kwh"
                      orientation="right"
                      tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                      label={{
                        value: 'kWh',
                        angle: 90,
                        position: 'insideRight',
                        fontSize: 10,
                        fill: 'var(--text-muted)',
                      }}
                    />
                    <Tooltip content={<CurveTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar
                      yAxisId="kw"
                      dataKey="avgKw"
                      name="Avg kW"
                      fill="#00f0ff"
                      radius={[4, 4, 0, 0]}
                      barSize={32}
                    />
                    <Bar
                      yAxisId="kwh"
                      dataKey="avgEnergy"
                      name="Avg kWh"
                      fill="#a855f7"
                      radius={[4, 4, 0, 0]}
                      barSize={32}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </GlassPanel>

            {/* Section 7 – Charging speed trend */}
            <GlassPanel className="p-4 sm:p-6">
              <h3
                className="text-sm font-semibold mb-4 flex items-center gap-2"
                style={{ color: 'var(--text-primary)' }}
              >
                <TrendingDown className="h-4 w-4 text-neon-amber" />
                Charging Speed Trend
              </h3>
              {speedTrend.length === 0 ? (
                <div className="flex items-center justify-center h-64 text-[var(--text-muted)] text-sm">
                  No data available
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={speedTrend}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--glass-border)"
                      strokeOpacity={0.5}
                    />
                    <XAxis
                      dataKey="month"
                      tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                      label={{
                        value: 'Avg kW',
                        angle: -90,
                        position: 'insideLeft',
                        fontSize: 10,
                        fill: 'var(--text-muted)',
                      }}
                    />
                    <Tooltip content={<CurveTooltip unit="kW" />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line
                      type="monotone"
                      dataKey="dc"
                      name="DC Fast"
                      stroke="#00f0ff"
                      strokeWidth={2}
                      dot={{ r: 3, fill: '#00f0ff' }}
                      connectNulls
                    />
                    <Line
                      type="monotone"
                      dataKey="ac"
                      name="AC / Home"
                      stroke="#10b981"
                      strokeWidth={2}
                      dot={{ r: 3, fill: '#10b981' }}
                      connectNulls
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </GlassPanel>
          </div>

          {/* Section 8 – Time-to-charge analysis */}
          <GlassPanel className="p-4 sm:p-6 mb-6 sm:mb-8">
            <h3
              className="text-sm font-semibold mb-4 flex items-center gap-2"
              style={{ color: 'var(--text-primary)' }}
            >
              <Clock className="h-4 w-4 text-neon-purple" />
              Time-to-Charge Analysis (DC Fast Sessions)
            </h3>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-6">
              <TimeToChargeCard
                label="Avg 10% → 80%"
                value={
                  timeToChargeStats.avg10to80 != null
                    ? fmtDuration(timeToChargeStats.avg10to80)
                    : '—'
                }
              />
              <TimeToChargeCard
                label="Avg 20% → 80%"
                value={
                  timeToChargeStats.avg20to80 != null
                    ? fmtDuration(timeToChargeStats.avg20to80)
                    : '—'
                }
              />
              <TimeToChargeCard
                label="Fastest Session"
                value={
                  timeToChargeStats.fastest
                    ? `${fmtInt((timeToChargeStats.fastest.charge_energy_added / timeToChargeStats.fastest.duration_min) * 60)} kW avg`
                    : '—'
                }
                sub={
                  timeToChargeStats.fastest
                    ? fmtDuration(timeToChargeStats.fastest.duration_min)
                    : undefined
                }
              />
              <TimeToChargeCard
                label="Slowest Session"
                value={
                  timeToChargeStats.slowest
                    ? `${fmtInt((timeToChargeStats.slowest.charge_energy_added / timeToChargeStats.slowest.duration_min) * 60)} kW avg`
                    : '—'
                }
                sub={
                  timeToChargeStats.slowest
                    ? fmtDuration(timeToChargeStats.slowest.duration_min)
                    : undefined
                }
              />
            </div>

            {timeToChargeStats.trend.length > 0 && (
              <>
                <h4
                  className="text-xs font-medium mb-3"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  DC Charge Duration Trend by Year
                </h4>
                <ResponsiveContainer width="100%" height={200}>
                  <ComposedChart data={timeToChargeStats.trend}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--glass-border)"
                      strokeOpacity={0.5}
                    />
                    <XAxis
                      dataKey="year"
                      tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                      label={{
                        value: 'Avg min',
                        angle: -90,
                        position: 'insideLeft',
                        fontSize: 10,
                        fill: 'var(--text-muted)',
                      }}
                    />
                    <Tooltip content={<CurveTooltip unit="min" />} />
                    <Bar
                      dataKey="avgMin"
                      name="Avg Duration"
                      fill="#a855f7"
                      radius={[4, 4, 0, 0]}
                      barSize={40}
                    />
                    <Line
                      type="monotone"
                      dataKey="avgMin"
                      name="Trend"
                      stroke="#f59e0b"
                      strokeWidth={2}
                      dot={{ r: 3, fill: '#f59e0b' }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </>
            )}
          </GlassPanel>
        </>
      )}
    </FadeIn>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
function SummaryCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode
  label: string
  value: string
  accent: string
}) {
  return (
    <div className="glass-card p-4 flex flex-col gap-2">
      <div
        className="flex items-center gap-1.5 text-xs"
        style={{ color: 'var(--text-secondary)' }}
      >
        <span className={accent}>{icon}</span>
        {label}
      </div>
      <p className={clsx('text-lg font-bold', accent)}>{value}</p>
    </div>
  )
}

function SessionDetailRow({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="flex justify-between items-center py-1.5 border-b border-[var(--glass-border)]">
      <span
        className="text-xs"
        style={{ color: 'var(--text-secondary)' }}
      >
        {label}
      </span>
      <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
        {value}
      </span>
    </div>
  )
}

function TimeToChargeCard({
  label,
  value,
  sub,
}: {
  label: string
  value: string
  sub?: string
}) {
  return (
    <div className="glass-card p-3 sm:p-4 text-center">
      <p
        className="text-[10px] uppercase tracking-wider mb-1"
        style={{ color: 'var(--text-secondary)' }}
      >
        {label}
      </p>
      <p className="text-lg font-bold text-neon-cyan">{value}</p>
      {sub && (
        <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
          {sub}
        </p>
      )}
    </div>
  )
}
