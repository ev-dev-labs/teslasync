import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getVehicles, getDrives, getChargingSessions, getAlerts } from '../api'
import type { Alert } from '../api'
import {
  PageHeader,
  GlassPanel,
  MetricCard,
  FadeIn,
  StaggerContainer,
  StaggerItem,
  Skeleton,
  EmptyState,
  AlertBanner,
  Select,
  DataTable,
  type Column,
} from '../components/ui'
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Zap,
  Route,
  DollarSign,
  Leaf,
  Trophy,
  Gauge,
  BatteryCharging,
  AlertTriangle,
  Lightbulb,
  TrendingUp,
  TrendingDown,
  Car,
  Timer,
  BarChart3,
  Clock,
} from 'lucide-react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import clsx from 'clsx'
import { useSettings } from '../hooks/useSettings'
import { formatDateShort, formatDate, formatDateWithDay } from '../lib/dateFormat'
import { fmtNumber, fmtInt, fmtPercent, fmtWithUnit } from '../lib/numberFormat'
import { usePageTitle } from '../hooks/usePageTitle'

// ── WeeklyDigest types ──────────────────────────────────────────────────────

interface ComparisonRow {
  metric: string
  current: number
  previous: number
  fmt: (v: number) => string
}

const comparisonColumns: Column<ComparisonRow>[] = [
  {
    key: 'metric',
    header: 'Metric',
    render: (row) => (
      <span style={{ color: 'var(--text-secondary)' }}>{row.metric}</span>
    ),
  },
  {
    key: 'thisWeek',
    header: 'This Week',
    className: 'text-right',
    render: (row) => (
      <span className="tabular-nums font-medium" style={{ color: 'var(--text-primary)' }}>
        {row.fmt(row.current)}
      </span>
    ),
  },
  {
    key: 'lastWeek',
    header: 'Last Week',
    className: 'text-right',
    render: (row) => (
      <span className="tabular-nums" style={{ color: 'var(--text-muted)' }}>
        {row.fmt(row.previous)}
      </span>
    ),
  },
  {
    key: 'change',
    header: 'Change',
    className: 'text-right',
    render: (row) => {
      const diff = row.current - row.previous
      const isUp = diff > 0
      const isEqual = diff === 0
      if (isEqual) return <span style={{ color: 'var(--text-muted)' }}>—</span>
      return (
        <span className={clsx('inline-flex items-center gap-0.5 text-xs font-medium', isUp ? 'text-neon-green' : 'text-neon-red')}>
          {isUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          {fmtNumber(Math.abs(diff), row.metric.includes('Cost') ? 2 : 1)}
        </span>
      )
    },
  },
]

// ── helpers ──────────────────────────────────────────────────────────────────

function getWeekRange(offset: number): [Date, Date] {
  const now = new Date()
  const dayOfWeek = now.getDay()
  const monday = new Date(now)
  monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1) + offset * 7)
  monday.setHours(0, 0, 0, 0)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  sunday.setHours(23, 59, 59, 999)
  return [monday, sunday]
}

function weekLabel(offset: number): string {
  if (offset === 0) return 'This Week'
  if (offset === -1) return 'Last Week'
  const [start, end] = getWeekRange(offset)
  return `${formatDateShort(start)} – ${formatDateShort(end)}`
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
const DAY_COLORS = [
  'var(--neon-cyan, #00f0ff)',
  'var(--neon-purple, #a855f7)',
  'var(--neon-green, #22c55e)',
  'var(--neon-amber, #f59e0b)',
  'var(--neon-red, #ef4444)',
  'var(--neon-cyan, #00f0ff)',
  'var(--neon-purple, #a855f7)',
]

const CITY_PAIRS: { from: string; to: string; km: number }[] = [
  { from: 'New York', to: 'Philadelphia', km: 150 },
  { from: 'San Francisco', to: 'San Jose', km: 80 },
  { from: 'London', to: 'Oxford', km: 90 },
  { from: 'Paris', to: 'Rouen', km: 135 },
  { from: 'Los Angeles', to: 'San Diego', km: 195 },
  { from: 'Berlin', to: 'Leipzig', km: 190 },
  { from: 'Chicago', to: 'Milwaukee', km: 150 },
  { from: 'Toronto', to: 'Hamilton', km: 70 },
  { from: 'Sydney', to: 'Wollongong', km: 85 },
  { from: 'Tokyo', to: 'Yokohama', km: 30 },
  { from: 'Boston', to: 'Providence', km: 80 },
  { from: 'Seattle', to: 'Tacoma', km: 55 },
  { from: 'Austin', to: 'San Antonio', km: 130 },
  { from: 'Denver', to: 'Colorado Springs', km: 110 },
  { from: 'Miami', to: 'Fort Lauderdale', km: 50 },
  { from: 'Dallas', to: 'Fort Worth', km: 55 },
  { from: 'Rome', to: 'Naples', km: 225 },
  { from: 'Madrid', to: 'Toledo', km: 75 },
  { from: 'Amsterdam', to: 'Rotterdam', km: 80 },
  { from: 'Mumbai', to: 'Pune', km: 150 },
  { from: 'Vancouver', to: 'Whistler', km: 125 },
  { from: 'Melbourne', to: 'Geelong', km: 75 },
  { from: 'Houston', to: 'Galveston', km: 80 },
  { from: 'Las Vegas', to: 'Henderson', km: 25 },
  { from: 'Portland', to: 'Salem', km: 75 },
  { from: 'Atlanta', to: 'Macon', km: 135 },
  { from: 'Montreal', to: 'Quebec City', km: 250 },
  { from: 'New York', to: 'Boston', km: 345 },
  { from: 'San Francisco', to: 'Los Angeles', km: 615 },
  { from: 'Chicago', to: 'Indianapolis', km: 290 },
]

function findCityPair(distanceKm: number): { from: string; to: string } | null {
  let best: (typeof CITY_PAIRS)[0] | null = null
  let bestDiff = Infinity
  for (const pair of CITY_PAIRS) {
    const diff = Math.abs(pair.km - distanceKm)
    if (diff < bestDiff) {
      bestDiff = diff
      best = pair
    }
  }
  if (best && bestDiff < best.km * 0.5) return best
  return null
}

function filterByWeek<T extends { start_date: string }>(items: T[], start: Date, end: Date): T[] {
  return items.filter((item) => {
    const d = new Date(item.start_date)
    return d >= start && d <= end
  })
}

function filterAlertsByWeek(alerts: Alert[], start: Date, end: Date): Alert[] {
  return alerts.filter((a) => {
    const d = new Date(a.created_at)
    return d >= start && d <= end
  })
}

function pctChange(current: number, previous: number): { value: string; positive: boolean } | undefined {
  if (previous === 0 && current === 0) return undefined
  if (previous === 0) return { value: `+${fmtInt(current)}`, positive: true }
  const pct = ((current - previous) / previous) * 100
  const sign = pct >= 0 ? '+' : ''
  return { value: `${sign}${fmtPercent(pct)}`, positive: pct >= 0 }
}

function dayIndex(dateStr: string): number {
  const d = new Date(dateStr)
  const day = d.getDay()
  return day === 0 ? 6 : day - 1
}

// ── chart tooltip ────────────────────────────────────────────────────────────

function DigestTooltip({ active, payload, label, unit }: any) {
  if (!active || !payload?.length) return null
  return (
    <GlassPanel
      className="px-3 py-2 text-xs shadow-lg"
      style={{ background: 'var(--surface-2)', border: '1px solid var(--glass-border)' }}
    >
      <p style={{ color: 'var(--text-primary)' }} className="font-medium mb-1">
        {label}
      </p>
      {payload.map((entry: any, i: number) => (
        <p key={i} style={{ color: entry.color }} className="tabular-nums">
          {fmtNumber(entry.value)} {unit}
        </p>
      ))}
    </GlassPanel>
  )
}

// ── main component───────────────────────────────────────────────────────────

export default function WeeklyDigest() {
  usePageTitle('Weekly Digest')
  const [weekOffset, setWeekOffset] = useState(0)
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null)

  const { convertDistance, convertSpeed, distanceUnit, speedUnit, fmtDistance } = useSettings()

  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: getVehicles })
  const vehicleId = selectedVehicle ?? vehicles?.[0]?.id ?? null

  const [weekStart, weekEnd] = useMemo(() => getWeekRange(weekOffset), [weekOffset])
  const [prevStart, prevEnd] = useMemo(() => getWeekRange(weekOffset - 1), [weekOffset])

  // Fetch enough data to cover both current and previous week
  const { data: drives, isLoading: drivesLoading } = useQuery({
    queryKey: ['drives', vehicleId, 200],
    queryFn: () => getDrives(vehicleId!, 200),
    enabled: vehicleId !== null,
  })

  const { data: charging, isLoading: chargingLoading } = useQuery({
    queryKey: ['charging-sessions', vehicleId, 200],
    queryFn: () => getChargingSessions(vehicleId!, 200),
    enabled: vehicleId !== null,
  })

  const { data: alerts, isLoading: alertsLoading } = useQuery({
    queryKey: ['alerts', 200],
    queryFn: () => getAlerts(200),
  })

  const isLoading= drivesLoading || chargingLoading || alertsLoading

  // ── filtered data ────────────────────────────────────────────────────────

  const weekDrives = useMemo(
    () => (drives ? filterByWeek(drives, weekStart, weekEnd) : []),
    [drives, weekStart, weekEnd],
  )
  const prevDrives = useMemo(
    () => (drives ? filterByWeek(drives, prevStart, prevEnd) : []),
    [drives, prevStart, prevEnd],
  )
  const weekCharging = useMemo(
    () => (charging ? filterByWeek(charging, weekStart, weekEnd) : []),
    [charging, weekStart, weekEnd],
  )
  const prevCharging = useMemo(
    () => (charging ? filterByWeek(charging, prevStart, prevEnd) : []),
    [charging, prevStart, prevEnd],
  )
  const weekAlerts = useMemo(
    () => (alerts ? filterAlertsByWeek(alerts, weekStart, weekEnd) : []),
    [alerts, weekStart, weekEnd],
  )

  // ── computed stats ───────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const totalDist = weekDrives.reduce((s, d) => s + d.distance, 0)
    const prevDist = prevDrives.reduce((s, d) => s + d.distance, 0)
    const totalEnergy = weekCharging.reduce((s, c) => s + c.charge_energy_added, 0)
    const prevEnergy = prevCharging.reduce((s, c) => s + c.charge_energy_added, 0)
    const totalCost = weekCharging.reduce((s, c) => s + (c.cost ?? 0), 0)
    const prevCost = prevCharging.reduce((s, c) => s + (c.cost ?? 0), 0)
    const gasSavings = (totalDist / 100) * 8 * 1.5
    const prevGasSavings = (prevDist / 100) * 8 * 1.5

    const totalDuration = weekDrives.reduce((s, d) => s + d.duration_min, 0)

    return {
      driveCount: weekDrives.length,
      prevDriveCount: prevDrives.length,
      totalDist,
      prevDist,
      totalEnergy,
      prevEnergy,
      totalCost,
      prevCost,
      gasSavings,
      prevGasSavings,
      totalDuration,
    }
  }, [weekDrives, prevDrives, weekCharging, prevCharging])

  // ── daily breakdown ──────────────────────────────────────────────────────

  const dailyData = useMemo(() => {
    const days = DAY_NAMES.map((name) => ({ name, distance: 0, drives: 0, chargingMin: 0 }))
    weekDrives.forEach((d) => {
      const idx = dayIndex(d.start_date)
      if (idx >= 0 && idx < 7) {
        days[idx].distance += d.distance
        days[idx].drives += 1
      }
    })
    weekCharging.forEach((c) => {
      const idx = dayIndex(c.start_date)
      if (idx >= 0 && idx < 7) {
        days[idx].chargingMin += c.duration_min
      }
    })
    return days.map((d) => ({
      ...d,
      distance: Number(convertDistance(d.distance).toFixed(1)),
    }))
  }, [weekDrives, weekCharging, convertDistance])

  // ── drive highlights ─────────────────────────────────────────────────────

  const highlights = useMemo(() => {
    if (weekDrives.length === 0) return null
    const longest = [...weekDrives].sort((a, b) => b.distance - a.distance)[0]
    const fastest = [...weekDrives].sort(
      (a, b) => (b.speed_max ?? 0) - (a.speed_max ?? 0),
    )[0]
    const mostEfficient = [...weekDrives]
      .filter((d) => d.distance > 0 && d.start_battery_level != null && d.end_battery_level != null)
      .sort((a, b) => {
        const effA = a.distance > 0 ? ((a.start_battery_level! - a.end_battery_level!) / a.distance) : Infinity
        const effB = b.distance > 0 ? ((b.start_battery_level! - b.end_battery_level!) / b.distance) : Infinity
        return effA - effB
      })[0]
    return { longest, fastest, mostEfficient }
  }, [weekDrives])

  // ── charging split ───────────────────────────────────────────────────────

  const chargingSplit = useMemo(() => {
    let home = 0
    let supercharger = 0
    let other = 0
    weekCharging.forEach((c) => {
      const brand = (c.fast_charger_brand ?? '').toLowerCase()
      const type = (c.fast_charger_type ?? '').toLowerCase()
      if (brand.includes('tesla') || type.includes('tesla') || type.includes('supercharger')) {
        supercharger++
      } else if (!c.fast_charger_type || c.fast_charger_type === '' || type === 'unknown') {
        home++
      } else {
        other++
      }
    })
    const total = home + supercharger + other
    return { home, supercharger, other, total }
  }, [weekCharging])

  // ── battery bookends ─────────────────────────────────────────────────────

  const batteryBookends = useMemo(() => {
    if (weekDrives.length === 0) return null
    const sorted = [...weekDrives].sort(
      (a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime(),
    )
    const first = sorted[0]
    const last = sorted[sorted.length - 1]
    return {
      startLevel: first.start_battery_level,
      endLevel: last.end_battery_level,
      startDate: first.start_date,
      endDate: last.end_date ?? last.start_date,
    }
  }, [weekDrives])

  // ── fun facts ────────────────────────────────────────────────────────────

  const funFacts = useMemo(() => {
    const facts: string[] = []
    const distKm = stats.totalDist

    const cityPair = findCityPair(distKm)
    if (cityPair) {
      facts.push(
        `You drove the equivalent of ${cityPair.from} to ${cityPair.to} this week!`,
      )
    } else if (distKm > 0) {
      facts.push(
        `You covered ${fmtInt(convertDistance(distKm))} ${distanceUnit} this week — keep rolling!`,
      )
    }

    const coffeeCount = Math.floor(stats.gasSavings / 5)
    if (coffeeCount > 0) {
      facts.push(
        `You saved enough in gas money to buy ${coffeeCount} cup${coffeeCount === 1 ? '' : 's'} of coffee ☕`,
      )
    }

    const totalWeekMinutes = 7 * 24 * 60
    const drivingMinutes = stats.totalDuration
    const parkedPct = totalWeekMinutes > 0
      ? fmtInt(((totalWeekMinutes - drivingMinutes) / totalWeekMinutes) * 100)
      : '100'
    facts.push(`Your car was parked ${parkedPct}% of the time this week`)

    if (stats.totalEnergy > 0) {
      const treeDays = fmtNumber(stats.totalEnergy * 0.4 / 22)
      facts.push(
        `Your EV charging offset ~${treeDays} tree-days worth of CO₂ absorption 🌳`,
      )
    }

    if (weekDrives.length > 0) {
      const avgDriveMin = stats.totalDuration / weekDrives.length
      if (avgDriveMin < 15) facts.push('Your average drive was a quick sprint — under 15 minutes!')
      else if (avgDriveMin > 60) facts.push('You love the open road — average drives over an hour!')
    }

    return facts
  }, [stats, weekDrives, convertDistance, distanceUnit])

  // ── comparison table ─────────────────────────────────────────────────────

  const comparison = useMemo(() => {
    const avgSpeed =
      weekDrives.length > 0
        ? weekDrives.reduce((s, d) => s + (d.speed_max ?? 0), 0) / weekDrives.length
        : 0
    const prevAvgSpeed =
      prevDrives.length > 0
        ? prevDrives.reduce((s, d) => s + (d.speed_max ?? 0), 0) / prevDrives.length
        : 0
    return [
      {
        metric: 'Drives',
        current: stats.driveCount,
        previous: stats.prevDriveCount,
        fmt: (v: number) => String(v),
      },
      {
        metric: `Distance (${distanceUnit})`,
        current: convertDistance(stats.totalDist),
        previous: convertDistance(stats.prevDist),
        fmt: (v: number) => fmtNumber(v),
      },
      {
        metric: 'Energy (kWh)',
        current: stats.totalEnergy,
        previous: stats.prevEnergy,
        fmt: (v: number) => fmtNumber(v),
      },
      {
        metric: 'Cost ($)',
        current: stats.totalCost,
        previous: stats.prevCost,
        fmt: (v: number) => `$${fmtNumber(v)}`,
      },
      {
        metric: `Avg Top Speed (${speedUnit})`,
        current: convertSpeed(avgSpeed),
        previous: convertSpeed(prevAvgSpeed),
        fmt: (v: number) => fmtInt(v),
      },
    ]
  }, [stats, weekDrives, prevDrives, convertDistance, convertSpeed, distanceUnit, speedUnit])

  // ── render ───────────────────────────────────────────────────────────────

  return (
    <FadeIn>
      <div className="space-y-6">
        {/* ── 1. Header ──────────────────────────────────────────────── */}
        <PageHeader
          title="Weekly Digest"
          subtitle="Your car's week in review — drives, charging, costs, and highlights"
          icon={<CalendarDays className="h-7 w-7 text-neon-cyan" />}
          actions={
            vehicles && vehicles.length > 1 ? (
              <Select
                value={vehicleId ?? ''}
                onChange={(e) => setSelectedVehicle(Number(e.target.value))}
                options={vehicles.map((v) => ({ value: String(v.id), label: v.display_name || v.vin }))}
              />
            ) : undefined
          }
        />

        {/* Date range subtitle */}
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {formatDate(weekStart)} – {formatDate(weekEnd)}
        </p>

        {/* ── 2. Week Navigation ─────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => setWeekOffset((o) => o - 1)}
            className="glass-card p-2 rounded-lg hover:shadow-glow-sm transition-all"
            style={{ color: 'var(--text-primary)' }}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <span className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            {weekLabel(weekOffset)}
          </span>
          <button
            onClick={() => setWeekOffset((o) => Math.min(o + 1, 0))}
            disabled={weekOffset >= 0}
            className={clsx(
              'glass-card p-2 rounded-lg transition-all',
              weekOffset >= 0 ? 'opacity-30 cursor-not-allowed' : 'hover:shadow-glow-sm',
            )}
            style={{ color: 'var(--text-primary)' }}
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>

        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
          </div>
        ) : weekDrives.length === 0 && weekCharging.length === 0 ? (
          <EmptyState
            icon={<Car className="h-12 w-12" />}
            title="A quiet week"
            description="No drives or charging sessions recorded for this period."
          />
        ) : (
          <>
            {/* ── 3. Week-at-a-Glance Summary ────────────────────────── */}
            <StaggerContainer className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <StaggerItem>
                <MetricCard
                  label="Total Drives"
                  value={stats.driveCount}
                  icon={<Car className="h-5 w-5" />}
                  change={pctChange(stats.driveCount, stats.prevDriveCount)}
                  color="cyan"
                />
              </StaggerItem>
              <StaggerItem>
                <MetricCard
                  label={`Total Distance`}
                  value={fmtDistance(stats.totalDist, 1)}
                  icon={<Route className="h-5 w-5" />}
                  change={pctChange(stats.totalDist, stats.prevDist)}
                  color="purple"
                />
              </StaggerItem>
              <StaggerItem>
                <MetricCard
                  label="Energy Used"
                  value={fmtWithUnit(stats.totalEnergy, 'kWh')}
                  icon={<Zap className="h-5 w-5" />}
                  change={pctChange(stats.totalEnergy, stats.prevEnergy)}
                  color="amber"
                />
              </StaggerItem>
              <StaggerItem>
                <MetricCard
                  label="Charging Cost"
                  value={`$${fmtNumber(stats.totalCost)}`}
                  icon={<DollarSign className="h-5 w-5" />}
                  change={pctChange(stats.totalCost, stats.prevCost)}
                  color="green"
                />
              </StaggerItem>
              <StaggerItem>
                <MetricCard
                  label="Gas Savings"
                  value={`$${fmtNumber(stats.gasSavings)}`}
                  icon={<Leaf className="h-5 w-5" />}
                  change={pctChange(stats.gasSavings, stats.prevGasSavings)}
                  color="green"
                  subtitle="vs ICE at 8L/100km"
                />
              </StaggerItem>
              <StaggerItem>
                <MetricCard
                  label="Drive Time"
                  value={`${Math.floor(stats.totalDuration / 60)}h ${Math.round(stats.totalDuration % 60)}m`}
                  icon={<Timer className="h-5 w-5" />}
                  color="cyan"
                  subtitle={`${weekDrives.length} session${weekDrives.length === 1 ? '' : 's'}`}
                />
              </StaggerItem>
            </StaggerContainer>

            {/* ── 4. Daily Activity Chart ─────────────────────────────── */}
            <GlassPanel className="p-6">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                <BarChart3 className="h-5 w-5 text-neon-cyan" />
                Daily Activity
              </h2>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dailyData} barCategoryGap="20%">
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" />
                    <XAxis
                      dataKey="name"
                      tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
                      axisLine={{ stroke: 'var(--glass-border)' }}
                    />
                    <YAxis
                      tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
                      axisLine={{ stroke: 'var(--glass-border)' }}
                      label={{
                        value: distanceUnit,
                        angle: -90,
                        position: 'insideLeft',
                        fill: 'var(--text-muted)',
                        fontSize: 12,
                      }}
                    />
                    <Tooltip content={<DigestTooltip unit={distanceUnit} />} />
                    <Bar dataKey="distance" radius={[4, 4, 0, 0]}>
                      {dailyData.map((_, i) => (
                        <Cell key={i} fill={DAY_COLORS[i]} fillOpacity={0.8} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-3 flex flex-wrap gap-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                {dailyData.map((d) => (
                  <span key={d.name}>
                    {d.name}: {d.drives} drive{d.drives === 1 ? '' : 's'}
                  </span>
                ))}
              </div>
            </GlassPanel>

            {/* ── 5. Drive Highlights ─────────────────────────────────── */}
            <GlassPanel className="p-6">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                <Trophy className="h-5 w-5 text-neon-amber" />
                Drive Highlights
              </h2>
              {highlights ? (
                <div className="grid gap-4 sm:grid-cols-3">
                  <HighlightCard
                    icon={<Route className="h-5 w-5 text-neon-purple" />}
                    title="Longest Drive"
                    value={fmtDistance(highlights.longest.distance, 1)}
                    detail={`${fmtInt(highlights.longest.duration_min)} min · ${formatDateWithDay(highlights.longest.start_date)}`}
                  />
                  {highlights.mostEfficient && (
                    <HighlightCard
                      icon={<Leaf className="h-5 w-5 text-neon-green" />}
                      title="Most Efficient"
                      value={fmtDistance(highlights.mostEfficient.distance, 1)}
                      detail={`${fmtPercent(highlights.mostEfficient.start_battery_level! - highlights.mostEfficient.end_battery_level!)} battery used`}
                    />
                  )}
                  <HighlightCard
                    icon={<Gauge className="h-5 w-5 text-neon-red" />}
                    title="Fastest Drive"
                    value={`${fmtInt(convertSpeed(highlights.fastest.speed_max ?? 0))} ${speedUnit}`}
                    detail={formatDateWithDay(highlights.fastest.start_date)}
                  />
                </div>
              ) : (
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  No drive data available for highlights.
                </p>
              )}
            </GlassPanel>

            {/* ── 6. Charging Summary ─────────────────────────────────── */}
            <GlassPanel className="p-6">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                <BatteryCharging className="h-5 w-5 text-neon-green" />
                Charging Summary
              </h2>
              {weekCharging.length > 0 ? (
                <div className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-4">
                    <MiniStat label="Sessions" value={String(weekCharging.length)} />
                    <MiniStat label="Total Energy" value={fmtWithUnit(stats.totalEnergy, 'kWh')} />
                    <MiniStat label="Total Cost" value={`$${fmtNumber(stats.totalCost)}`} />
                    <MiniStat
                      label="Avg per Session"
                      value={fmtWithUnit(stats.totalEnergy / weekCharging.length, 'kWh')}
                    />
                  </div>

                  {/* Charger type split bar */}
                  {chargingSplit.total > 0 && (
                    <div>
                      <p className="text-xs mb-2 font-medium" style={{ color: 'var(--text-secondary)' }}>
                        Charger Type Split
                      </p>
                      <div className="flex h-4 rounded-full overflow-hidden gap-0.5">
                        {chargingSplit.home > 0 && (
                          <div
                            className="bg-neon-green/70 transition-all"
                            style={{ width: `${(chargingSplit.home / chargingSplit.total) * 100}%` }}
                            title={`Home: ${chargingSplit.home}`}
                          />
                        )}
                        {chargingSplit.supercharger > 0 && (
                          <div
                            className="bg-neon-cyan/70 transition-all"
                            style={{ width: `${(chargingSplit.supercharger / chargingSplit.total) * 100}%` }}
                            title={`Supercharger: ${chargingSplit.supercharger}`}
                          />
                        )}
                        {chargingSplit.other > 0 && (
                          <div
                            className="bg-neon-purple/70 transition-all"
                            style={{ width: `${(chargingSplit.other / chargingSplit.total) * 100}%` }}
                            title={`Other: ${chargingSplit.other}`}
                          />
                        )}
                      </div>
                      <div className="flex gap-4 mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                        {chargingSplit.home > 0 && (
                          <span className="flex items-center gap-1">
                            <span className="h-2 w-2 rounded-full bg-neon-green/70" /> Home ({chargingSplit.home})
                          </span>
                        )}
                        {chargingSplit.supercharger > 0 && (
                          <span className="flex items-center gap-1">
                            <span className="h-2 w-2 rounded-full bg-neon-cyan/70" /> Supercharger ({chargingSplit.supercharger})
                          </span>
                        )}
                        {chargingSplit.other > 0 && (
                          <span className="flex items-center gap-1">
                            <span className="h-2 w-2 rounded-full bg-neon-purple/70" /> Other ({chargingSplit.other})
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  No charging sessions this week.
                </p>
              )}
            </GlassPanel>

            {/* ── 7. Battery Health This Week ─────────────────────────── */}
            <GlassPanel className="p-6">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                <Zap className="h-5 w-5 text-neon-amber" />
                Battery This Week
              </h2>
              {batteryBookends && batteryBookends.startLevel != null && batteryBookends.endLevel != null ? (
                <div className="flex items-center gap-6">
                  <BatteryPill
                    label="Start of Week"
                    level={batteryBookends.startLevel}
                    date={batteryBookends.startDate}
                  />
                  <div className="flex-1 flex items-center">
                    <div
                      className="flex-1 h-0.5 rounded"
                      style={{ background: 'var(--glass-border)' }}
                    />
                    <span className="mx-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                      →
                    </span>
                    <div
                      className="flex-1 h-0.5 rounded"
                      style={{ background: 'var(--glass-border)' }}
                    />
                  </div>
                  <BatteryPill
                    label="End of Week"
                    level={batteryBookends.endLevel}
                    date={batteryBookends.endDate}
                  />
                </div>
              ) : (
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  Battery bookend data not available for this week.
                </p>
              )}
            </GlassPanel>

            {/* ── 8. Notable Events ──────────────────────────────────── */}
            <GlassPanel className="p-6">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                <AlertTriangle className="h-5 w-5 text-neon-amber" />
                Notable Events
              </h2>
              {weekAlerts.length > 0 ? (
                <div className="space-y-3">
                  {weekAlerts.map((alert) => (
                    <AlertBanner
                      key={alert.id}
                      variant={alert.severity === 'critical' ? 'danger' : alert.severity === 'warning' ? 'warning' : 'info'}
                      title={alert.title}
                      icon={<AlertTriangle className="h-4 w-4" />}
                    >
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {alert.message}
                      </p>
                      <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                        <Clock className="inline h-3 w-3 mr-1" />
                        {new Date(alert.created_at).toLocaleString('en-US', {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </p>
                    </AlertBanner>
                  ))}
                </div>
              ) : (
                <div className="text-center py-4">
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    ✨ No notable events this week — smooth sailing!
                  </p>
                </div>
              )}
            </GlassPanel>

            {/* ── 9. Fun Facts ────────────────────────────────────────── */}
            {funFacts.length > 0 && (
              <GlassPanel className="p-6" glow="purple">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                  <Lightbulb className="h-5 w-5 text-neon-purple" />
                  Did You Know?
                </h2>
                <div className="space-y-3">
                  {funFacts.map((fact, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <span className="text-neon-purple text-lg mt-0.5">
                        {i === 0 ? '🗺️' : i === 1 ? '☕' : i === 2 ? '🅿️' : i === 3 ? '🌳' : '⚡'}
                      </span>
                      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                        {fact}
                      </p>
                    </div>
                  ))}
                </div>
              </GlassPanel>
            )}

            {/* ── 10. Week-over-Week Comparison ──────────────────────── */}
            <GlassPanel className="p-6">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                <TrendingUp className="h-5 w-5 text-neon-cyan" />
                Week-over-Week Comparison
              </h2>
              <div className="overflow-x-auto">
                <DataTable<ComparisonRow>
                  columns={comparisonColumns}
                  data={comparison}
                  keyExtractor={(row) => row.metric}
                  compact
                />
              </div>
            </GlassPanel>
          </>
        )}
      </div>
    </FadeIn>
  )
}

// ── sub-components ─────────────────────────────────────────────────────────

function HighlightCard({
  icon,
  title,
  value,
  detail,
}: {
  icon: React.ReactNode
  title: string
  value: string
  detail: string
}) {
  return (
    <GlassPanel className="p-4 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
          {title}
        </span>
      </div>
      <span className="text-xl font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>
        {value}
      </span>
      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
        {detail}
      </span>
    </GlassPanel>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <p className="text-xs font-medium uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>
        {label}
      </p>
      <p className="text-lg font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>
        {value}
      </p>
    </div>
  )
}

function BatteryPill({
  label,
  level,
  date,
}: {
  label: string
  level: number
  date: string
}) {
  const color =
    level > 60 ? 'text-neon-green' : level > 20 ? 'text-neon-amber' : 'text-neon-red'
  const bg =
    level > 60 ? 'bg-neon-green/20' : level > 20 ? 'bg-neon-amber/20' : 'bg-neon-red/20'

  return (
    <div className="text-center">
      <p className="text-xs font-medium mb-2" style={{ color: 'var(--text-muted)' }}>
        {label}
      </p>
      <GlassPanel className={clsx('px-4 py-3 inline-block', bg)}>
        <span className={clsx('text-2xl font-bold tabular-nums', color)}>{level}%</span>
      </GlassPanel>
      <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
        {formatDateWithDay(date)}
      </p>
    </div>
  )
}
