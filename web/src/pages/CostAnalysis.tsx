import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  getVehicles,
  getChargingSessions,
  getEnergyStats,
  getDrives,
  getFleetAnalytics,
} from '../api'
import {
  PageHeader,
  GlassPanel,
  FadeIn,
  Skeleton,
  DateRangeFilter,
  EmptyState,
  MetricCard,
  ChartContainer,
  Select,
} from '../components/ui'
import {
  DollarSign,
  TrendingDown,
  TrendingUp,
  Zap,
  Fuel,
  Leaf,
  BarChart3,
  Calculator,
  TreePine,
  PiggyBank,
  ChevronUp,
  ChevronDown,
} from 'lucide-react'
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import clsx from 'clsx'
import { useSettings } from '../hooks/useSettings'
import { CHARGER_COLORS } from '../lib/colors'
import { fmtNumber, fmtWithUnit, fmtPercent, fmtInt } from '../lib/numberFormat'

/* ── constants ───────────────────────────────────────────────── */

const DEFAULT_GAS_PRICE = 3.5        // $/gal
const DEFAULT_MPG = 30               // miles per gallon
const KM_PER_MILE = 1.60934
const CO2_PER_GAL_KG = 8.887         // kg CO₂ per gallon of gasoline
const KG_CO2_PER_TREE_YEAR = 22      // kg CO₂ absorbed per tree per year


/* ── tooltip─────────────────────────────────────────────────── */

interface CostTooltipPayload {
  name: string
  value: number
  color?: string
  fill?: string
  stroke?: string
}

function CostTooltip({
  active,
  payload,
  label,
  prefix = '',
  suffix = '',
}: {
  active?: boolean
  payload?: CostTooltipPayload[]
  label?: string
  prefix?: string
  suffix?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div
      className="glass-panel p-3 text-xs"
      style={{ background: 'var(--surface-2)', borderColor: 'var(--glass-border)' }}
    >
      <p style={{ color: 'var(--text-secondary)' }} className="mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: 'var(--text-primary)' }}>
          <span style={{ color: p.color || p.fill || p.stroke }}>●</span>{' '}
          {p.name}: {prefix}{typeof p.value === 'number' ? fmtNumber(p.value, 2) : p.value}{suffix}
        </p>
      ))}
    </div>
  )
}

/* ── helpers ──────────────────────────────────────────────────── */

function categorizeCharger(type: string | null, cable: string | null): string {
  if (!type && !cable) return 'Home'
  const t = (type ?? '').toLowerCase()
  const c = (cable ?? '').toLowerCase()
  if (t.includes('tesla') || t.includes('supercharger')) return 'Supercharger'
  if (t.includes('dc') || t.includes('ccs') || t.includes('chademo')) return 'Public DC'
  if (c.includes('sae') || c.includes('j1772') || t.includes('l2') || t.includes('work'))
    return 'Work / L2'
  if (type) return 'Other'
  return 'Home'
}

function gasEquivalentCost(
  distanceKm: number,
  gasPriceDollar: number,
  mpg: number,
): number {
  const distanceMiles = distanceKm / KM_PER_MILE
  const gallonsNeeded = distanceMiles / mpg
  return gallonsNeeded * gasPriceDollar
}

function monthKey(dateStr: string): string {
  const d = new Date(dateStr)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(key: string): string {
  const [y, m] = key.split('-')
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${names[Number(m) - 1]} ${y.slice(2)}`
}

function daysForRange(range: string): number | null {
  switch (range) {
    case '7d': return 7
    case '30d': return 30
    case '90d': return 90
    case '1y': return 365
    default: return null
  }
}

/* ── component ───────────────────────────────────────────────── */

export default function CostAnalysis() {
  const { convertDistance, distanceUnit, settings } = useSettings()

  /* ── state ────────────────────────────────────── */
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null)
  const [range, setRange] = useState('30d')

  // savings calculator interactive inputs
  const [gasPrice, setGasPrice] = useState(DEFAULT_GAS_PRICE)
  const [mpg, setMpg] = useState(DEFAULT_MPG)
  const [elecRate, setElecRate] = useState<number | null>(null) // null → use settings

  // table sort
  const [sortCol, setSortCol] = useState<'month' | 'energy' | 'distance' | 'cost' | 'perUnit' | 'gasCost' | 'saved'>('month')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const effectiveElecRate = elecRate ?? settings.base_cost_per_kwh

  const days = daysForRange(range)

  /* ── date range ────────────────────────────────── */
  const [startDate, setStartDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 30)
    return d.toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0])

  const startParam = range === 'all' ? undefined : startDate

  /* ── queries ────────────────────────────────────── */
  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: getVehicles })
  const vehicleId = selectedVehicle ?? vehicles?.[0]?.id ?? null

  const { data: sessions, isLoading: loadingSessions } = useQuery({
    queryKey: ['charging-sessions-cost', vehicleId, range, startDate, endDate],
    queryFn: () => getChargingSessions(vehicleId!, 5000, 0, range === 'all' ? undefined : startDate, range === 'all' ? undefined : endDate),
    enabled: !!vehicleId,
  })

  const { data: energy, isLoading: loadingEnergy } = useQuery({
    queryKey: ['energy-stats-cost', vehicleId, days, startParam],
    queryFn: () => getEnergyStats(vehicleId!, days ?? 3650, range === 'all' ? undefined : startParam),
    enabled: !!vehicleId,
  })

  const { data: drives } = useQuery({
    queryKey: ['drives-cost', vehicleId, range, startDate, endDate],
    queryFn: () => getDrives(vehicleId!, 5000, 0, range === 'all' ? undefined : startDate, range === 'all' ? undefined : endDate),
    enabled: !!vehicleId,
  })

  const { data: fleet } = useQuery({
    queryKey: ['fleet-cost', days, startParam],
    queryFn: () => getFleetAnalytics(days ?? 3650, range === 'all' ? undefined : startParam),
    enabled: true,
  })

  const isLoading = loadingSessions || loadingEnergy

  /* ── derived data ──────────────────────────────── */

  // total distance from drives (km)
  const totalDistanceKm = useMemo(() => {
    if (energy?.total_distance_km) return energy.total_distance_km
    return (drives ?? []).reduce((s, d) => s + (d.distance ?? 0), 0)
  }, [energy, drives])

  // total energy
  const totalEnergy = useMemo(() => {
    if (energy?.total_energy_used_kwh) return energy.total_energy_used_kwh
    return (sessions ?? []).reduce((s, c) => s + (c.charge_energy_added ?? 0), 0)
  }, [energy, sessions])

  // total cost
  const totalCost = useMemo(() => {
    if (energy?.total_cost && energy.total_cost > 0) return energy.total_cost
    return (sessions ?? []).reduce((s, c) => s + (c.cost ?? c.charge_energy_added * effectiveElecRate), 0)
  }, [energy, sessions, effectiveElecRate])

  // cost per distance unit
  const costPerUnit = useMemo(() => {
    const dist = convertDistance(totalDistanceKm)
    return dist > 0 ? totalCost / dist : 0
  }, [totalCost, totalDistanceKm, convertDistance])

  // cost per kWh
  const costPerKwh = totalEnergy > 0 ? totalCost / totalEnergy : effectiveElecRate

  // gas equivalent
  const gasEquiv = useMemo(
    () => gasEquivalentCost(totalDistanceKm, gasPrice, mpg),
    [totalDistanceKm, gasPrice, mpg],
  )

  const totalSavings = gasEquiv - totalCost
  const savingsPct = gasEquiv > 0 ? (totalSavings / gasEquiv) * 100 : 0

  /* ── monthly breakdown ─────────────────────────── */
  const monthlyData = useMemo(() => {
    // prefer fleet analytics monthly_trend if available
    const trend = fleet?.charging_analytics?.monthly_trend
    if (trend && trend.length > 0) {
      return trend.map(m => ({
        month: m.month,
        label: monthLabel(m.month),
        cost: m.cost,
        energy: m.energy,
        sessions: m.sessions,
        gasCost: m.gas_cost ?? 0,
        savings: m.savings ?? 0,
        distance: 0, // filled from sessions below
      }))
    }

    // fallback: aggregate from sessions
    const byMonth: Record<string, { cost: number; energy: number; sessions: number; distance: number }> = {}
    for (const c of sessions ?? []) {
      const mk = monthKey(c.start_date)
      if (!byMonth[mk]) byMonth[mk] = { cost: 0, energy: 0, sessions: 0, distance: 0 }
      byMonth[mk].cost += c.cost ?? c.charge_energy_added * effectiveElecRate
      byMonth[mk].energy += c.charge_energy_added
      byMonth[mk].sessions += 1
    }
    // add distance from drives
    for (const d of drives ?? []) {
      const mk = monthKey(d.start_date)
      if (!byMonth[mk]) byMonth[mk] = { cost: 0, energy: 0, sessions: 0, distance: 0 }
      byMonth[mk].distance += d.distance ?? 0
    }
    return Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => ({
        month,
        label: monthLabel(month),
        cost: v.cost,
        energy: v.energy,
        sessions: v.sessions,
        gasCost: gasEquivalentCost(v.distance, gasPrice, mpg),
        savings: gasEquivalentCost(v.distance, gasPrice, mpg) - v.cost,
        distance: v.distance,
      }))
  }, [fleet, sessions, drives, effectiveElecRate, gasPrice, mpg])

  /* ── cost per unit trend (monthly) ─────────────── */
  const costPerUnitTrend = useMemo(() => {
    return monthlyData.map(m => {
      const dist = convertDistance(m.distance)
      return {
        label: m.label,
        electric: dist > 0 ? m.cost / dist : 0,
        gas: dist > 0 ? m.gasCost / dist : 0,
      }
    })
  }, [monthlyData, convertDistance])

  /* ── charger type breakdown ────────────────────── */
  const chargerBreakdown = useMemo(() => {
    const byType: Record<string, { cost: number; energy: number; sessions: number }> = {}
    for (const c of sessions ?? []) {
      const cat = categorizeCharger(c.fast_charger_type, c.conn_charge_cable)
      if (!byType[cat]) byType[cat] = { cost: 0, energy: 0, sessions: 0 }
      byType[cat].cost += c.cost ?? c.charge_energy_added * effectiveElecRate
      byType[cat].energy += c.charge_energy_added
      byType[cat].sessions += 1
    }
    return Object.entries(byType).map(([type, v]) => ({
      type,
      cost: v.cost,
      energy: v.energy,
      sessions: v.sessions,
      avgCostKwh: v.energy > 0 ? v.cost / v.energy : 0,
      fill: CHARGER_COLORS[type] ?? '#6366f1',
    }))
  }, [sessions, effectiveElecRate])

  /* ── hourly rate distribution ──────────────────── */
  const hourlyRates = useMemo(() => {
    const byHour: Record<number, { totalCost: number; totalEnergy: number; count: number }> = {}
    for (const c of sessions ?? []) {
      const h = new Date(c.start_date).getHours()
      if (!byHour[h]) byHour[h] = { totalCost: 0, totalEnergy: 0, count: 0 }
      byHour[h].totalCost += c.cost ?? c.charge_energy_added * effectiveElecRate
      byHour[h].totalEnergy += c.charge_energy_added
      byHour[h].count += 1
    }
    return Array.from({ length: 24 }, (_, h) => {
      const d = byHour[h]
      return {
        hour: `${String(h).padStart(2, '0')}:00`,
        avgRate: d && d.totalEnergy > 0 ? d.totalCost / d.totalEnergy : 0,
        sessions: d?.count ?? 0,
      }
    })
  }, [sessions, effectiveElecRate])

  const cheapestHour = useMemo(() => {
    const withSessions = hourlyRates.filter(h => h.sessions > 0)
    if (!withSessions.length) return null
    return withSessions.reduce((a, b) => (a.avgRate < b.avgRate ? a : b))
  }, [hourlyRates])

  const mostExpensiveHour = useMemo(() => {
    const withSessions = hourlyRates.filter(h => h.sessions > 0)
    if (!withSessions.length) return null
    return withSessions.reduce((a, b) => (a.avgRate > b.avgRate ? a : b))
  }, [hourlyRates])

  /* ── cheapest charger location ─────────────────── */
  const cheapestChargerType = useMemo(() => {
    if (!chargerBreakdown.length) return null
    return chargerBreakdown.reduce((a, b) => (a.avgCostKwh < b.avgCostKwh ? a : b))
  }, [chargerBreakdown])

  /* ── monthly table with sort ───────────────────── */
  const tableData = useMemo(() => {
    const rows = monthlyData.map(m => ({
      month: m.month,
      label: m.label,
      energy: m.energy,
      distance: convertDistance(m.distance),
      cost: m.cost,
      perUnit: m.distance > 0 ? m.cost / convertDistance(m.distance) : 0,
      gasCost: m.gasCost,
      saved: m.savings,
    }))

    rows.sort((a, b) => {
      const mul = sortDir === 'asc' ? 1 : -1
      if (sortCol === 'month') return mul * a.month.localeCompare(b.month)
      return mul * ((a[sortCol] as number) - (b[sortCol] as number))
    })
    return rows
  }, [monthlyData, sortCol, sortDir, convertDistance])

  const bestMonth = useMemo(() => {
    if (!tableData.length) return null
    return tableData.reduce((a, b) => (a.perUnit > 0 && (a.perUnit < b.perUnit || b.perUnit === 0) ? a : b))
  }, [tableData])

  const worstMonth = useMemo(() => {
    if (!tableData.length) return null
    return tableData.reduce((a, b) => (a.perUnit > b.perUnit ? a : b))
  }, [tableData])

  /* ── savings calculator values ─────────────────── */
  const monthlySavings = monthlyData.length > 0
    ? totalSavings / monthlyData.length
    : 0
  const annualSavings = monthlySavings * 12
  const lifetimeSavings = totalSavings // current period extrapolated

  /* ── lifetime / CO₂ ────────────────────────────── */
  const co2SavedKg = useMemo(() => {
    if (energy?.co2_saved_kg) return energy.co2_saved_kg
    const distMiles = totalDistanceKm / KM_PER_MILE
    const gallonsSaved = distMiles / mpg
    return gallonsSaved * CO2_PER_GAL_KG
  }, [energy, totalDistanceKm, mpg])

  const treesEquivalent = co2SavedKg / KG_CO2_PER_TREE_YEAR

  /* ── range change handler ──────────────────────── */
  function handleRangeChange(r: string) {
    setRange(r)
    if (r === 'all') return
    const d = new Date()
    const numDays = daysForRange(r) ?? 30
    d.setDate(d.getDate() - numDays)
    setStartDate(d.toISOString().split('T')[0])
    setEndDate(new Date().toISOString().split('T')[0])
  }

  function toggleSort(col: typeof sortCol) {
    if (sortCol === col) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortCol(col); setSortDir('desc') }
  }

  const SortIcon = ({ col }: { col: typeof sortCol }) =>
    sortCol === col
      ? sortDir === 'asc' ? <ChevronUp className="inline h-3 w-3" /> : <ChevronDown className="inline h-3 w-3" />
      : null

  /* ── render ─────────────────────────────────────── */

  if (!vehicleId && !isLoading) {
    return (
      <div className="p-6">
        <PageHeader
          title="Cost Analysis"
          subtitle="Charging costs, savings vs gasoline, and total cost of ownership"
          icon={<DollarSign className="h-6 w-6" />}
        />
        <EmptyState
          icon={<DollarSign className="h-12 w-12" />}
          title="No vehicles found"
          description="Add a vehicle to start analyzing your EV costs."
        />
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 max-w-[1600px] mx-auto space-y-6 sm:space-y-8">
      {/* ── 1. Header ──────────────────────────────── */}
      <FadeIn>
        <PageHeader
          title="Cost Analysis"
          subtitle="Charging costs, savings vs gasoline, and total cost of ownership"
          icon={<DollarSign className="h-6 w-6" />}
        />
      </FadeIn>

      {/* ── 2. Vehicle selector + date range ───────── */}
      <FadeIn delay={0.05}>
        <div className="flex flex-wrap items-center gap-3">
          {vehicles && vehicles.length > 1 && (
            <Select
              value={String(vehicleId ?? '')}
              onChange={e => setSelectedVehicle(Number(e.target.value))}
              options={vehicles.map(v => ({ value: String(v.id), label: v.display_name || v.vin }))}
            />
          )}

          <div className="flex gap-1">
            {['7d', '30d', '90d', '1y', 'all'].map(r => (
              <button
                key={r}
                onClick={() => handleRangeChange(r)}
                className={clsx(
                  'px-3 py-1.5 text-xs font-medium rounded-lg transition-all',
                  range === r
                    ? 'bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/40'
                    : 'glass-card hover:bg-white/5',
                )}
                style={range !== r ? { color: 'var(--text-secondary)' } : undefined}
              >
                {r === 'all' ? 'All' : r.toUpperCase()}
              </button>
            ))}
          </div>

          {range !== 'all' && (
            <DateRangeFilter
              startDate={startDate}
              endDate={endDate}
              onStartDateChange={s => { setStartDate(s); setRange('custom') }}
              onEndDateChange={s => { setEndDate(s); setRange('custom') }}
            />
          )}
        </div>
      </FadeIn>

      {/* ── loading skeleton ───────────────────────── */}
      {isLoading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      )}

      {!isLoading && (
        <>
          {/* ── 3. Cost summary cards ────────────────── */}
          <FadeIn delay={0.1}>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
              {([
                {
                  label: 'Total Charging Cost',
                  value: `$${fmtNumber(totalCost, 2)}`,
                  icon: DollarSign,
                  color: 'cyan' as const,
                  subtitle: `${(sessions ?? []).length} sessions`,
                },
                {
                  label: `Cost per ${distanceUnit}`,
                  value: `$${fmtNumber(costPerUnit, 3)}`,
                  icon: TrendingDown,
                  color: 'green' as const,
                  subtitle: `${fmtInt(convertDistance(totalDistanceKm))} ${distanceUnit} driven`,
                },
                {
                  label: 'Avg Cost per kWh',
                  value: `$${fmtNumber(costPerKwh, 3)}`,
                  icon: Zap,
                  color: 'amber' as const,
                  subtitle: `${fmtWithUnit(totalEnergy, 'kWh')} total`,
                },
                {
                  label: 'Gas Equivalent',
                  value: `$${fmtNumber(gasEquiv, 2)}`,
                  icon: Fuel,
                  color: 'red' as const,
                  subtitle: `at $${fmtNumber(gasPrice, 2)}/gal, ${mpg} mpg`,
                },
                {
                  label: 'Total Savings',
                  value: `$${fmtNumber(totalSavings, 2)}`,
                  icon: PiggyBank,
                  color: totalSavings >= 0 ? 'green' as const : 'red' as const,
                  subtitle: `vs gasoline`,
                },
                {
                  label: 'Savings %',
                  value: `${fmtPercent(savingsPct, 1)}`,
                  icon: TrendingUp,
                  color: savingsPct >= 0 ? 'green' as const : 'red' as const,
                  subtitle: `cheaper than gas`,
                },
              ]).map(card => (
                <MetricCard
                  key={card.label}
                  label={card.label}
                  value={card.value}
                  icon={<card.icon className="h-4 w-4" />}
                  color={card.color}
                  subtitle={card.subtitle}
                />
              ))}
            </div>
          </FadeIn>

          {/* ── 4. Monthly cost trend chart ─────────── */}
          <FadeIn delay={0.15}>
            <ChartContainer title="Monthly Cost Trend" height={300}>
              {monthlyData.length === 0 ? (
                <p className="text-center py-12 text-sm" style={{ color: 'var(--text-muted)' }}>
                  No monthly data available for this period.
                </p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={monthlyData}>
                    <defs>
                      <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                    <YAxis
                      tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                      tickFormatter={v => `$${v}`}
                    />
                    <Tooltip content={<CostTooltip prefix="$" />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Area
                      type="monotone"
                      dataKey="cost"
                      stroke="#10b981"
                      fill="url(#costGrad)"
                      strokeWidth={2}
                      name="Electric Cost"
                    />
                    <Line
                      type="monotone"
                      dataKey="gasCost"
                      stroke="#f59e0b"
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      dot={false}
                      name="Gas Equivalent"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </ChartContainer>
          </FadeIn>

          {/* ── 5. Cost per mile/km trend ───────────── */}
          <FadeIn delay={0.2}>
            <ChartContainer title={`Cost per ${distanceUnit} Over Time`} height={280}>
              {costPerUnitTrend.length === 0 ? (
                <p className="text-center py-12 text-sm" style={{ color: 'var(--text-muted)' }}>
                  Not enough data to show cost per {distanceUnit} trend.
                </p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={costPerUnitTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                    <YAxis
                      tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                      tickFormatter={v => `$${v.toFixed(2)}`}
                    />
                    <Tooltip content={<CostTooltip prefix="$" suffix={`/${distanceUnit}`} />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line
                      type="monotone"
                      dataKey="electric"
                      stroke="#00f0ff"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      name={`Electric $/${distanceUnit}`}
                    />
                    <Line
                      type="monotone"
                      dataKey="gas"
                      stroke="#f59e0b"
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      dot={false}
                      name={`Gas $/${distanceUnit}`}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </ChartContainer>
          </FadeIn>

          {/* ── 6. Cost by charger type ─────────────── */}
          <FadeIn delay={0.25}>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
              {/* donut chart */}
              <ChartContainer title="Cost by Charger Type" height={280}>
                {chargerBreakdown.length === 0 ? (
                  <p className="text-center py-12 text-sm" style={{ color: 'var(--text-muted)' }}>
                    No charging session data available.
                  </p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={chargerBreakdown}
                        dataKey="cost"
                        nameKey="type"
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={100}
                        paddingAngle={3}
                        label={({ type, percent }) => `${type} ${(percent * 100).toFixed(0)}%`}
                        labelLine={false}
                      >
                        {chargerBreakdown.map(d => (
                          <Cell key={d.type} fill={d.fill} />
                        ))}
                      </Pie>
                      <Tooltip content={<CostTooltip prefix="$" />} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </ChartContainer>

              {/* detail bars */}
              <GlassPanel className="p-4 sm:p-6">
                <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
                  <BarChart3 className="inline h-4 w-4 mr-2" style={{ color: '#f59e0b' }} />
                  Charger Type Details
                </h3>
                {chargerBreakdown.length === 0 ? (
                  <p className="text-center py-12 text-sm" style={{ color: 'var(--text-muted)' }}>
                    No data.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {chargerBreakdown
                      .sort((a, b) => b.cost - a.cost)
                      .map(b => {
                        const maxCost = Math.max(...chargerBreakdown.map(x => x.cost))
                        const pct = maxCost > 0 ? (b.cost / maxCost) * 100 : 0
                        return (
                          <div key={b.type}>
                            <div className="flex justify-between text-xs mb-1">
                              <span style={{ color: 'var(--text-primary)' }}>
                                <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ background: b.fill }} />
                                {b.type}
                              </span>
                              <span style={{ color: 'var(--text-secondary)' }}>
                                ${fmtNumber(b.cost, 2)} · {b.sessions} sessions · ${fmtNumber(b.avgCostKwh, 3)}/kWh
                              </span>
                            </div>
                            <div className="w-full h-2 rounded-full" style={{ background: 'var(--surface-1)' }}>
                              <div
                                className="h-2 rounded-full transition-all"
                                style={{ width: `${pct}%`, background: b.fill }}
                              />
                            </div>
                          </div>
                        )
                      })}
                  </div>
                )}
              </GlassPanel>
            </div>
          </FadeIn>

          {/* ── 7. Gas vs Electric savings calculator ── */}
          <FadeIn delay={0.3}>
            <GlassPanel className="p-4 sm:p-6">
              <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
                <Calculator className="inline h-4 w-4 mr-2" style={{ color: '#00f0ff' }} />
                Gas vs Electric Savings Calculator
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* inputs */}
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                      Gas Price ($/gallon)
                    </label>
                    <input
                      type="number"
                      step="0.10"
                      min="0"
                      value={gasPrice}
                      onChange={e => setGasPrice(Number(e.target.value) || DEFAULT_GAS_PRICE)}
                      className="glass-card w-full px-3 py-2 text-sm rounded-lg border-0 focus:ring-1 focus:ring-neon-cyan/50"
                      style={{ background: 'var(--surface-2)', color: 'var(--text-primary)' }}
                    />
                  </div>
                  <div>
                    <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                      Vehicle MPG Equivalent
                    </label>
                    <input
                      type="number"
                      step="1"
                      min="1"
                      value={mpg}
                      onChange={e => setMpg(Number(e.target.value) || DEFAULT_MPG)}
                      className="glass-card w-full px-3 py-2 text-sm rounded-lg border-0 focus:ring-1 focus:ring-neon-cyan/50"
                      style={{ background: 'var(--surface-2)', color: 'var(--text-primary)' }}
                    />
                  </div>
                  <div>
                    <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                      Electricity Rate ($/kWh)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={effectiveElecRate}
                      onChange={e => setElecRate(Number(e.target.value) || null)}
                      className="glass-card w-full px-3 py-2 text-sm rounded-lg border-0 focus:ring-1 focus:ring-neon-cyan/50"
                      style={{ background: 'var(--surface-2)', color: 'var(--text-primary)' }}
                    />
                    <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                      Default from settings: ${fmtNumber(settings.base_cost_per_kwh, 2)}/kWh
                    </span>
                  </div>
                </div>

                {/* results */}
                <div className="flex flex-col items-center justify-center text-center space-y-4">
                  <GlassPanel
                    className="rounded-2xl p-6 w-full"
                    style={{
                      background: 'linear-gradient(135deg, rgba(16,185,129,0.1), rgba(0,240,255,0.05))',
                      borderColor: 'var(--glass-border)',
                    }}
                  >
                    <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                      You&apos;ve saved
                    </p>
                    <p
                      className="text-4xl sm:text-5xl font-black tracking-tight"
                      style={{
                        color: totalSavings >= 0 ? '#10b981' : '#ef4444',
                        textShadow: totalSavings >= 0
                          ? '0 0 20px rgba(16,185,129,0.4)'
                          : '0 0 20px rgba(239,68,68,0.4)',
                      }}
                    >
                      ${fmtNumber(Math.abs(totalSavings), 2)}
                    </p>
                    <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                      {totalSavings >= 0 ? 'compared to gasoline' : 'more than gasoline (check your rates!)'}
                    </p>
                  </GlassPanel>
                  <div className="grid grid-cols-3 gap-3 w-full">
                    <GlassPanel className="rounded-lg p-3">
                      <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Monthly</p>
                      <p className="text-sm font-bold" style={{ color: '#00f0ff' }}>
                        ${fmtNumber(monthlySavings, 2)}
                      </p>
                    </GlassPanel>
                    <GlassPanel className="rounded-lg p-3">
                      <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Annual (est.)</p>
                      <p className="text-sm font-bold" style={{ color: '#10b981' }}>
                        ${fmtNumber(annualSavings, 2)}
                      </p>
                    </GlassPanel>
                    <GlassPanel className="rounded-lg p-3">
                      <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Lifetime</p>
                      <p className="text-sm font-bold" style={{ color: '#a855f7' }}>
                        ${fmtNumber(lifetimeSavings, 2)}
                      </p>
                    </GlassPanel>
                  </div>
                </div>
              </div>
            </GlassPanel>
          </FadeIn>

          {/* ── 8. Cost breakdown table ─────────────── */}
          <FadeIn delay={0.35}>
            <GlassPanel className="p-4 sm:p-6 overflow-x-auto">
              <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
                <BarChart3 className="inline h-4 w-4 mr-2" style={{ color: '#00f0ff' }} />
                Monthly Cost Breakdown
              </h3>
              {tableData.length === 0 ? (
                <p className="text-center py-8 text-sm" style={{ color: 'var(--text-muted)' }}>
                  No monthly data to display.
                </p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--glass-border)' }}>
                      {([
                        ['month', 'Month'],
                        ['energy', 'Energy (kWh)'],
                        ['distance', `Distance (${distanceUnit})`],
                        ['cost', 'Cost ($)'],
                        ['perUnit', `$/${distanceUnit}`],
                        ['gasCost', 'Gas Would Be'],
                        ['saved', 'Saved'],
                      ] as [typeof sortCol, string][]).map(([col, label]) => (
                        <th
                          key={col}
                          className="py-2 px-2 text-left cursor-pointer hover:text-neon-cyan select-none"
                          onClick={() => toggleSort(col)}
                        >
                          {label} <SortIcon col={col} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tableData.map(row => {
                      const isBest = bestMonth?.month === row.month && row.perUnit > 0
                      const isWorst = worstMonth?.month === row.month && row.perUnit > 0
                      return (
                        <tr
                          key={row.month}
                          className={clsx(
                            'transition-colors',
                            isBest && 'bg-neon-green/5',
                            isWorst && 'bg-neon-red/5',
                          )}
                          style={{ borderBottom: '1px solid var(--glass-border)' }}
                        >
                          <td className="py-2 px-2 font-medium" style={{ color: 'var(--text-primary)' }}>
                            {row.label}
                            {isBest && <span className="ml-1 text-neon-green text-[9px]">★ Best</span>}
                            {isWorst && <span className="ml-1 text-neon-red text-[9px]">▼ Worst</span>}
                          </td>
                          <td className="py-2 px-2" style={{ color: 'var(--text-primary)' }}>
                            {fmtNumber(row.energy)}
                          </td>
                          <td className="py-2 px-2" style={{ color: 'var(--text-primary)' }}>
                            {fmtNumber(row.distance)}
                          </td>
                          <td className="py-2 px-2 font-medium" style={{ color: '#00f0ff' }}>
                            ${fmtNumber(row.cost, 2)}
                          </td>
                          <td className="py-2 px-2" style={{ color: 'var(--text-primary)' }}>
                            ${fmtNumber(row.perUnit, 3)}
                          </td>
                          <td className="py-2 px-2" style={{ color: '#f59e0b' }}>
                            ${fmtNumber(row.gasCost, 2)}
                          </td>
                          <td
                            className="py-2 px-2 font-medium"
                            style={{ color: row.saved >= 0 ? '#10b981' : '#ef4444' }}
                          >
                            {row.saved >= 0 ? '+' : ''}${fmtNumber(row.saved, 2)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </GlassPanel>
          </FadeIn>

          {/* ── 9. Electricity rate analysis ────────── */}
          <FadeIn delay={0.4}>
            <ChartContainer title="Electricity Rate Analysis" height="auto">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
                {/* hourly rate chart */}
                <div className="lg:col-span-2">
                  <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>
                    Average Cost per kWh by Time of Day
                  </p>
                  {hourlyRates.every(h => h.sessions === 0) ? (
                    <p className="text-center py-8 text-sm" style={{ color: 'var(--text-muted)' }}>
                      No hourly charging data available.
                    </p>
                  ) : (
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={hourlyRates}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
                        <XAxis dataKey="hour" tick={{ fontSize: 9, fill: 'var(--text-muted)' }} interval={2} />
                        <YAxis
                          tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                          tickFormatter={v => `$${v.toFixed(2)}`}
                        />
                        <Tooltip content={<CostTooltip prefix="$" suffix="/kWh" />} />
                        <Bar dataKey="avgRate" name="Avg $/kWh" radius={[3, 3, 0, 0]}>
                          {hourlyRates.map((entry, i) => (
                            <Cell
                              key={i}
                              fill={
                                entry.avgRate === 0
                                  ? 'var(--surface-1)'
                                  : cheapestHour && entry.hour === cheapestHour.hour
                                    ? '#10b981'
                                    : mostExpensiveHour && entry.hour === mostExpensiveHour.hour
                                      ? '#ef4444'
                                      : '#00f0ff'
                              }
                              fillOpacity={entry.avgRate === 0 ? 0.2 : 0.8}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>

                {/* insights */}
                <div className="space-y-3">
                  {cheapestHour && cheapestHour.avgRate > 0 && (
                    <GlassPanel
                      className="rounded-lg p-3"
                      style={{ borderLeft: '3px solid #10b981' }}
                    >
                      <p className="text-[10px] mb-0.5" style={{ color: 'var(--text-muted)' }}>
                        Cheapest Time
                      </p>
                      <p className="text-sm font-bold" style={{ color: '#10b981' }}>
                        {cheapestHour.hour} — ${fmtNumber(cheapestHour.avgRate, 3)}/kWh
                      </p>
                      <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                        {cheapestHour.sessions} sessions
                      </p>
                    </GlassPanel>
                  )}
                  {mostExpensiveHour && mostExpensiveHour.avgRate > 0 && (
                    <GlassPanel
                      className="rounded-lg p-3"
                      style={{ borderLeft: '3px solid #ef4444' }}
                    >
                      <p className="text-[10px] mb-0.5" style={{ color: 'var(--text-muted)' }}>
                        Most Expensive Time
                      </p>
                      <p className="text-sm font-bold" style={{ color: '#ef4444' }}>
                        {mostExpensiveHour.hour} — ${fmtNumber(mostExpensiveHour.avgRate, 3)}/kWh
                      </p>
                      <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                        {mostExpensiveHour.sessions} sessions
                      </p>
                    </GlassPanel>
                  )}
                  {cheapestChargerType && (
                    <GlassPanel
                      className="rounded-lg p-3"
                      style={{ borderLeft: `3px solid ${cheapestChargerType.fill}` }}
                    >
                      <p className="text-[10px] mb-0.5" style={{ color: 'var(--text-muted)' }}>
                        Best Rate by Type
                      </p>
                      <p className="text-sm font-bold" style={{ color: cheapestChargerType.fill }}>
                        {cheapestChargerType.type} — ${fmtNumber(cheapestChargerType.avgCostKwh, 3)}/kWh
                      </p>
                    </GlassPanel>
                  )}
                  <GlassPanel
                    className="rounded-lg p-3"
                    style={{ borderLeft: '3px solid #00f0ff' }}
                  >
                    <p className="text-[10px] mb-0.5" style={{ color: 'var(--text-muted)' }}>
                      💡 Recommendation
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-primary)' }}>
                      {cheapestHour && cheapestChargerType
                        ? `You save the most charging via ${cheapestChargerType.type} around ${cheapestHour.hour}.`
                        : 'Charge during off-peak hours at home for maximum savings.'}
                    </p>
                  </GlassPanel>
                </div>
              </div>
            </ChartContainer>
          </FadeIn>

          {/* ── 10. Lifetime summary ───────────────── */}
          <FadeIn delay={0.45}>
            <GlassPanel className="p-4 sm:p-6">
              <h3 className="text-sm font-semibold mb-6" style={{ color: 'var(--text-primary)' }}>
                <Leaf className="inline h-4 w-4 mr-2" style={{ color: '#10b981' }} />
                Lifetime Summary
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
                {[
                  {
                    label: 'Total Distance',
                    value: `${fmtInt(convertDistance(totalDistanceKm))} ${distanceUnit}`,
                    color: '#00f0ff',
                    icon: TrendingUp,
                  },
                  {
                    label: 'Energy Consumed',
                    value: `${fmtWithUnit(totalEnergy, 'kWh')}`,
                    color: '#f59e0b',
                    icon: Zap,
                  },
                  {
                    label: 'Charging Cost',
                    value: `$${fmtNumber(totalCost, 2)}`,
                    color: '#00f0ff',
                    icon: DollarSign,
                  },
                  {
                    label: 'Gas Equivalent',
                    value: `$${fmtNumber(gasEquiv, 2)}`,
                    color: '#ef4444',
                    icon: Fuel,
                  },
                  {
                    label: 'Total Savings',
                    value: `$${fmtNumber(totalSavings, 2)}`,
                    color: totalSavings >= 0 ? '#10b981' : '#ef4444',
                    icon: PiggyBank,
                  },
                  {
                    label: 'CO₂ Saved',
                    value: co2SavedKg >= 1000
                      ? `${fmtWithUnit((co2SavedKg / 1000), 'tons', 2)}`
                      : `${fmtWithUnit(co2SavedKg, 'kg')}`,
                    color: '#10b981',
                    icon: Leaf,
                  },
                  {
                    label: 'Trees Equivalent',
                    value: `${fmtWithUnit(treesEquivalent, 'trees')}`,
                    color: '#10b981',
                    icon: TreePine,
                  },
                ].map(item => (
                  <GlassPanel key={item.label} className="p-4 text-center">
                    <item.icon className="h-5 w-5 mx-auto mb-2" style={{ color: item.color }} />
                    <p className="text-[10px] mb-1" style={{ color: 'var(--text-muted)' }}>
                      {item.label}
                    </p>
                    <p className="text-lg font-bold" style={{ color: item.color }}>
                      {item.value}
                    </p>
                  </GlassPanel>
                ))}
              </div>

              {/* environmental impact emphasis */}
              <GlassPanel
                className="mt-6 p-4 text-center"
                style={{
                  background: 'linear-gradient(135deg, rgba(16,185,129,0.08), rgba(0,240,255,0.04))',
                  borderColor: 'var(--glass-border)',
                }}
              >
                <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                  🌍 Environmental Impact
                </p>
                <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
                  By driving electric, you&apos;ve prevented{' '}
                  <span className="font-bold text-neon-green">
                    {co2SavedKg >= 1000
                      ? `${fmtNumber((co2SavedKg / 1000), 2)} metric tons`
                      : `${fmtWithUnit(co2SavedKg, 'kg')}`}
                  </span>{' '}
                  of CO₂ emissions — equivalent to planting{' '}
                  <span className="font-bold text-neon-green">
                    {fmtInt(treesEquivalent)} trees
                  </span>{' '}
                  for a year.
                </p>
              </GlassPanel>
            </GlassPanel>
          </FadeIn>
        </>
      )}
    </div>
  )
}
