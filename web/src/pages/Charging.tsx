import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { getVehicles, getChargingSessions, ChargingSession, Vehicle } from '../api'
import { BatteryCharging, Clock, Zap, DollarSign, TrendingUp, Plug, ChevronRight, Home, Bolt, Calendar, ArrowUpDown, Filter, Download, Lightbulb, PiggyBank } from 'lucide-react'
import { PageHeader, GlassPanel, FadeIn, StaggerContainer, StaggerItem, ProgressRing, Skeleton, EmptyState, Pagination, DateRangeFilter } from '../components/ui'
import { RadialGauge, AnimatedNumber } from '../components/Widgets'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, AreaChart, Area, PieChart, Pie, Cell
} from 'recharts'
import clsx from 'clsx'

type SortKey = 'date' | 'energy' | 'cost' | 'duration' | 'power'
type ChargerFilter = 'all' | 'supercharger' | 'dc' | 'home'

interface TooltipPayload { name: string; value: number; color?: string; fill?: string }
function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipPayload[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="glass-panel p-3 text-xs" style={{ background: 'var(--surface-2)', borderColor: 'var(--glass-border)' }}>
      <p style={{ color: 'var(--text-secondary)' }} className="mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: 'var(--text-primary)' }}>
          <span style={{ color: p.color || p.fill }}>●</span> {p.name}: {typeof p.value === 'number' ? p.value.toFixed(1) : p.value}
        </p>
      ))}
    </div>
  )
}

function formatDuration(min: number): string {
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function getChargerCategory(type: string | null): 'supercharger' | 'dc' | 'home' {
  if (type && type.toLowerCase().includes('tesla')) return 'supercharger'
  if (type && (type.toLowerCase().includes('dc') || type.toLowerCase().includes('ccs') || type.toLowerCase().includes('chademo'))) return 'dc'
  return 'home'
}

const chargerColors = { supercharger: '#ef4444', dc: '#f59e0b', home: '#10b981' }
const chargerLabels = { supercharger: 'Supercharger', dc: 'DC Fast', home: 'Home / AC' }

function SessionCard({ session }: { session: ChargingSession }) {
  const batteryGain = (session.end_battery_level ?? session.start_battery_level) - session.start_battery_level
  const avgRate = session.duration_min > 0 ? (session.charge_energy_added / (session.duration_min / 60)).toFixed(1) : null
  const cat = getChargerCategory(session.fast_charger_type)
  const costPerKwh = session.cost && session.charge_energy_added > 0 ? session.cost / session.charge_energy_added : null

  return (
    <Link to={`/charging/${session.id}`}>
      <GlassPanel hover glow="green" className="p-4 transition-all duration-200 group cursor-pointer">
        <div className="flex items-center gap-4">
          <ProgressRing
            value={session.end_battery_level ?? session.start_battery_level}
            max={100}
            size={48}
            strokeWidth={4}
            color={chargerColors[cat]}
            label={`${session.end_battery_level ?? session.start_battery_level}%`}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-1">
              <p className="text-sm font-semibold text-[var(--text-primary)]">{formatDate(session.start_date)}</p>
              <span className={clsx('text-[10px] font-semibold px-2 py-0.5 rounded-full ring-1',
                cat === 'supercharger' ? 'bg-neon-red/10 text-neon-red ring-neon-red/20' :
                cat === 'dc' ? 'bg-neon-amber/10 text-neon-amber ring-neon-amber/20' :
                'bg-neon-green/10 text-neon-green ring-neon-green/20'
              )}>
                {chargerLabels[cat]}
              </span>
              {batteryGain > 0 && <span className="text-xs text-neon-green font-medium">+{batteryGain}%</span>}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-muted)]">
              <span className="flex items-center gap-1"><Zap className="h-3 w-3" /> {session.charge_energy_added.toFixed(1)} kWh</span>
              <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {formatDuration(session.duration_min)}</span>
              {session.charger_power !== null && <span className="flex items-center gap-1"><TrendingUp className="h-3 w-3" /> {session.charger_power} kW peak</span>}
              {avgRate && <span className="flex items-center gap-1"><Plug className="h-3 w-3" /> ~{avgRate} kW avg</span>}
              {session.cost !== null && <span className="flex items-center gap-1 text-neon-green"><DollarSign className="h-3 w-3" /> ${session.cost.toFixed(2)}</span>}
              {costPerKwh !== null && <span className="text-gray-600">(${costPerKwh.toFixed(3)}/kWh)</span>}
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-gray-700 group-hover:text-neon-green transition-colors" />
        </div>
      </GlassPanel>
    </Link>
  )
}

function ChargingSchedule({ vehicleId }: { vehicleId: number }) {
  const storageKey = `teslasync-charge-schedule-${vehicleId}`
  const [schedule, setSchedule] = useState(() => {
    const stored = localStorage.getItem(storageKey)
    return stored ? JSON.parse(stored) : {
      enabled: false,
      startTime: '22:00',
      endTime: '06:00',
      maxCharge: 80,
      days: { mon: true, tue: true, wed: true, thu: true, fri: true, sat: true, sun: true } as Record<string, boolean>,
    }
  })

  const save = (updates: Record<string, unknown>) => {
    const updated = { ...schedule, ...updates }
    setSchedule(updated)
    localStorage.setItem(storageKey, JSON.stringify(updated))
  }

  const peakRate = 0.25
  const offPeakRate = 0.10
  const avgDailyCharge = 15
  const monthlyPeakCost = avgDailyCharge * peakRate * 30
  const monthlyOffPeakCost = avgDailyCharge * offPeakRate * 30
  const monthlySavings = monthlyPeakCost - monthlyOffPeakCost

  return (
    <GlassPanel className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          <Clock className="h-4 w-4 text-neon-cyan" /> Charging Schedule
        </h3>
        <button onClick={() => save({ enabled: !schedule.enabled })}
          className={clsx('relative w-11 h-6 rounded-full transition-colors', schedule.enabled ? 'bg-neon-cyan' : 'bg-gray-600')}>
          <span className={clsx('absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform', schedule.enabled && 'translate-x-5')} />
        </button>
      </div>

      {schedule.enabled && (
        <div className="space-y-4">
          {/* Time window */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-[var(--text-muted)] block mb-1">Start Time</label>
              <input type="time" value={schedule.startTime} onChange={e => save({ startTime: e.target.value })} className="glass-input w-full text-sm px-3 py-2" />
            </div>
            <div>
              <label className="text-xs text-[var(--text-muted)] block mb-1">End Time</label>
              <input type="time" value={schedule.endTime} onChange={e => save({ endTime: e.target.value })} className="glass-input w-full text-sm px-3 py-2" />
            </div>
          </div>

          {/* Max charge slider */}
          <div>
            <label className="text-xs text-[var(--text-muted)] block mb-1">Charge Limit: {schedule.maxCharge}%</label>
            <input type="range" min={50} max={100} value={schedule.maxCharge} onChange={e => save({ maxCharge: Number(e.target.value) })} className="w-full" />
            <p className="text-xs text-[var(--text-muted)] mt-1">80% recommended for daily use, 100% for trips</p>
          </div>

          {/* Day selector */}
          <div className="flex gap-2">
            {(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const).map(day => (
              <button key={day} onClick={() => save({ days: { ...schedule.days, [day]: !schedule.days[day] } })}
                className={clsx('w-9 h-9 rounded-full text-xs font-medium transition-colors', schedule.days[day] ? 'bg-neon-cyan/20 text-neon-cyan' : 'bg-white/5 text-gray-500')}>
                {day.charAt(0).toUpperCase() + day.slice(1, 3)}
              </button>
            ))}
          </div>

          {/* Savings estimate */}
          <div className="rounded-lg p-3" style={{ background: 'rgba(16,185,129,0.05)', border: '1px solid rgba(16,185,129,0.15)' }}>
            <p className="text-xs text-neon-green font-medium">💰 Off-peak charging saves ~${monthlySavings.toFixed(0)}/month</p>
            <p className="text-[10px] text-[var(--text-muted)] mt-1">Based on ${peakRate}/kWh peak vs ${offPeakRate}/kWh off-peak rates</p>
          </div>
        </div>
      )}
    </GlassPanel>
  )
}

function ChargingCostMap({ sessions }: { sessions: any[] }) {
  const locationCosts = useMemo(() => {
    const map: Record<string, { name: string; lat: number; lng: number; costs: number[]; energy: number[] }> = {}

    sessions?.forEach(s => {
      if (!s.address_name && !s.address_city) return
      const name = s.address_name || s.address_city || 'Unknown'
      const key = name
      if (!map[key]) map[key] = { name, lat: s.latitude || 0, lng: s.longitude || 0, costs: [], energy: [] }
      if (s.cost > 0 && s.charge_energy_added > 0) {
        map[key].costs.push(s.cost)
        map[key].energy.push(s.charge_energy_added)
      }
    })

    return Object.values(map)
      .filter(l => l.costs.length > 0)
      .map(l => ({
        ...l,
        totalCost: l.costs.reduce((a, b) => a + b, 0),
        totalEnergy: l.energy.reduce((a, b) => a + b, 0),
        avgCostPerKwh: l.costs.reduce((a, b) => a + b, 0) / l.energy.reduce((a, b) => a + b, 0),
        sessions: l.costs.length,
      }))
      .sort((a, b) => a.avgCostPerKwh - b.avgCostPerKwh)
  }, [sessions])

  if (locationCosts.length === 0) return null

  const cheapest = locationCosts[0]
  const mostExpensive = locationCosts[locationCosts.length - 1]

  return (
    <GlassPanel className="p-6">
      <h3 className="flex items-center gap-2 text-sm font-semibold mb-4" style={{color:'var(--text-primary)'}}>
        <DollarSign className="h-4 w-4 text-neon-green" /> Charging Costs by Location
      </h3>

      {/* Best/worst comparison */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="rounded-lg p-3 text-center" style={{background:'rgba(16,185,129,0.1)',border:'1px solid rgba(16,185,129,0.2)'}}>
          <p className="text-xs text-neon-green mb-1">💚 Cheapest</p>
          <p className="text-lg font-bold text-neon-green">${cheapest.avgCostPerKwh.toFixed(3)}/kWh</p>
          <p className="text-[10px] text-[var(--text-muted)]">{cheapest.name}</p>
        </div>
        <div className="rounded-lg p-3 text-center" style={{background:'rgba(239,68,68,0.1)',border:'1px solid rgba(239,68,68,0.2)'}}>
          <p className="text-xs text-neon-red mb-1">💸 Most Expensive</p>
          <p className="text-lg font-bold text-neon-red">${mostExpensive.avgCostPerKwh.toFixed(3)}/kWh</p>
          <p className="text-[10px] text-[var(--text-muted)]">{mostExpensive.name}</p>
        </div>
      </div>

      {/* All locations ranked */}
      <div className="space-y-2">
        {locationCosts.map((l, i) => {
          const barWidth = (l.avgCostPerKwh / (mostExpensive.avgCostPerKwh || 1)) * 100
          const color = l.avgCostPerKwh < 0.15 ? '#10b981' : l.avgCostPerKwh < 0.25 ? '#f59e0b' : '#ef4444'
          return (
            <div key={i}>
              <div className="flex justify-between text-xs mb-1">
                <span style={{color:'var(--text-secondary)'}}>{l.name}</span>
                <span className="font-mono" style={{color}}>${l.avgCostPerKwh.toFixed(3)}/kWh · {l.sessions} sessions</span>
              </div>
              <div className="h-2 rounded-full" style={{background:'var(--surface-2)'}}>
                <div className="h-full rounded-full transition-all" style={{width: `${barWidth}%`, background: color}} />
              </div>
            </div>
          )
        })}
      </div>
    </GlassPanel>
  )
}

export default function Charging() {
  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: getVehicles })
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null)
  const [sortBy, setSortBy] = useState<SortKey>('date')
  const [sortDesc, setSortDesc] = useState(true)
  const [chargerFilter, setChargerFilter] = useState<ChargerFilter>('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 365); return d.toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0])

  const vehicleId = selectedVehicle ?? vehicles?.[0]?.id ?? null
  const { data: sessions, isLoading } = useQuery({
    queryKey: ['charging', vehicleId, startDate, endDate, page, pageSize],
    queryFn: () => getChargingSessions(vehicleId!, pageSize, (page - 1) * pageSize, startDate, endDate),
    enabled: vehicleId !== null,
  })

  const stats = useMemo(() => {
    if (!sessions || sessions.length === 0) return null
    const totalEnergy = sessions.reduce((sum, s) => sum + s.charge_energy_added, 0)
    const totalCost = sessions.reduce((sum, s) => sum + (s.cost ?? 0), 0)
    const totalDuration = sessions.reduce((sum, s) => sum + s.duration_min, 0)
    const avgPower = sessions.filter(s => s.charger_power).reduce((sum, s) => sum + (s.charger_power ?? 0), 0) /
      Math.max(sessions.filter(s => s.charger_power).length, 1)
    const avgCostPerKwh = totalEnergy > 0 ? totalCost / totalEnergy : 0
    const homeCount = sessions.filter(s => getChargerCategory(s.fast_charger_type) === 'home').length
    const scCount = sessions.filter(s => getChargerCategory(s.fast_charger_type) === 'supercharger').length
    const dcCount = sessions.filter(s => getChargerCategory(s.fast_charger_type) === 'dc').length
    return { totalEnergy, totalCost, totalDuration, avgPower, avgCostPerKwh, homeCount, scCount, dcCount, count: sessions.length }
  }, [sessions])

  // Charger type breakdown
  const chargerBreakdown = useMemo(() => {
    if (!stats) return []
    return [
      { name: 'Supercharger', value: stats.scCount, fill: chargerColors.supercharger },
      { name: 'DC Fast', value: stats.dcCount, fill: chargerColors.dc },
      { name: 'Home / AC', value: stats.homeCount, fill: chargerColors.home },
    ].filter(d => d.value > 0)
  }, [stats])

  // Energy trend (last 20 sessions)
  const energyTrend = useMemo(() => {
    if (!sessions) return []
    return sessions.slice(0, 20).reverse().map(s => ({
      date: new Date(s.start_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      energy: parseFloat(s.charge_energy_added.toFixed(1)),
      cost: s.cost ?? 0,
    }))
  }, [sessions])

  // Cost by charger type
  const costByType = useMemo(() => {
    if (!sessions) return []
    const groups: Record<string, { energy: number; cost: number; count: number }> = {}
    sessions.forEach(s => {
      const cat = chargerLabels[getChargerCategory(s.fast_charger_type)]
      if (!groups[cat]) groups[cat] = { energy: 0, cost: 0, count: 0 }
      groups[cat].energy += s.charge_energy_added
      groups[cat].cost += s.cost ?? 0
      groups[cat].count++
    })
    return Object.entries(groups).map(([name, v]) => ({
      name, energy: parseFloat(v.energy.toFixed(1)), cost: parseFloat(v.cost.toFixed(2)),
      perKwh: v.energy > 0 ? parseFloat((v.cost / v.energy).toFixed(3)) : 0,
    }))
  }, [sessions])

  // Start battery level distribution
  const startLevelDist = useMemo(() => {
    if (!sessions) return []
    const buckets = Array.from({ length: 10 }, (_, i) => ({ range: `${i * 10}-${i * 10 + 10}%`, count: 0 }))
    sessions.forEach(s => {
      const idx = Math.min(Math.floor(s.start_battery_level / 10), 9)
      buckets[idx].count++
    })
    return buckets
  }, [sessions])

  // ── Charging Optimizer computations ──
  const ratesByType = useMemo(() => {
    if (!sessions) return { home: 0, supercharger: 0, dc: 0 }
    const groups: Record<string, { totalCost: number; totalEnergy: number }> = {
      home: { totalCost: 0, totalEnergy: 0 },
      supercharger: { totalCost: 0, totalEnergy: 0 },
      dc: { totalCost: 0, totalEnergy: 0 },
    }
    sessions.forEach(s => {
      const cat = getChargerCategory(s.fast_charger_type)
      if (s.cost && s.charge_energy_added > 0) {
        groups[cat].totalCost += s.cost
        groups[cat].totalEnergy += s.charge_energy_added
      }
    })
    return {
      home: groups.home.totalEnergy > 0 ? groups.home.totalCost / groups.home.totalEnergy : 0,
      supercharger: groups.supercharger.totalEnergy > 0 ? groups.supercharger.totalCost / groups.supercharger.totalEnergy : 0,
      dc: groups.dc.totalEnergy > 0 ? groups.dc.totalCost / groups.dc.totalEnergy : 0,
    }
  }, [sessions])

  const recommendation = useMemo(() => {
    if (!sessions || sessions.length === 0) return null
    const types = [
      { name: 'Home / AC', rate: ratesByType.home },
      { name: 'Supercharger', rate: ratesByType.supercharger },
      { name: 'DC Fast', rate: ratesByType.dc },
    ].filter(t => t.rate > 0)
    if (types.length === 0) return null
    types.sort((a, b) => a.rate - b.rate)
    const cheapest = types[0]
    const scRate = ratesByType.supercharger
    const homeRate = ratesByType.home
    const savingsVsSc = scRate > 0 && homeRate > 0 ? Math.round((1 - homeRate / scRate) * 100) : null
    return { cheapest, savingsVsSc, types }
  }, [sessions, ratesByType])

  const monthlyChargingCost = useMemo(() => {
    if (!sessions) return []
    const map: Record<string, number> = {}
    sessions.forEach(s => {
      const month = new Date(s.start_date).toLocaleDateString(undefined, { year: 'numeric', month: 'short' })
      map[month] = (map[month] ?? 0) + (s.cost ?? 0)
    })
    return Object.entries(map).map(([month, cost]) => ({ month, cost: parseFloat(cost.toFixed(2)) })).reverse()
  }, [sessions])

  const [homeRate, setHomeRate] = useState(0.12)

  const savingsCalc = useMemo(() => {
    if (!sessions || sessions.length === 0) return null
    const totalCost = sessions.reduce((sum, s) => sum + (s.cost ?? 0), 0)
    const totalEnergy = sessions.reduce((sum, s) => sum + s.charge_energy_added, 0)
    const hypotheticalCost = totalEnergy * homeRate
    const monthSpan = sessions.length > 0
      ? Math.max(1, (new Date(sessions[0].start_date).getTime() - new Date(sessions[sessions.length - 1].start_date).getTime()) / (1000 * 60 * 60 * 24 * 30))
      : 1
    const monthlySavings = (totalCost - hypotheticalCost) / monthSpan
    return { totalCost, hypotheticalCost, monthlySavings, totalEnergy, monthSpan }
  }, [sessions, homeRate])

  // AC/DC energy & cost breakdown (not just count)
  const acDcBreakdown = useMemo(() => {
    if (!sessions) return null
    const ac = { energy: 0, energyUsed: 0, cost: 0, count: 0, totalDuration: 0, freeCount: 0, freeEnergy: 0 }
    const dc = { energy: 0, energyUsed: 0, cost: 0, count: 0, totalDuration: 0, freeCount: 0, freeEnergy: 0 }
    sessions.forEach(s => {
      const isDC = !!(s.fast_charger_type || (s.charger_power && s.charger_power > 22))
      const bucket = isDC ? dc : ac
      bucket.energy += s.charge_energy_added
      bucket.energyUsed += s.charge_energy_used ?? s.charge_energy_added
      bucket.cost += s.cost ?? 0
      bucket.count++
      bucket.totalDuration += s.duration_min
      if (!s.cost || s.cost === 0) { bucket.freeCount++; bucket.freeEnergy += s.charge_energy_added }
    })
    return { ac, dc, total: { energy: ac.energy + dc.energy, cost: ac.cost + dc.cost, freeEnergy: ac.freeEnergy + dc.freeEnergy, freeCount: ac.freeCount + dc.freeCount } }
  }, [sessions])

  // Filtered + sorted sessions
  const filteredSessions = useMemo(() => {
    if (!sessions) return []
    let filtered = sessions
    if (chargerFilter !== 'all') {
      filtered = filtered.filter(s => getChargerCategory(s.fast_charger_type) === chargerFilter)
    }
    const sorted = [...filtered].sort((a, b) => {
      let cmp = 0
      switch (sortBy) {
        case 'date': cmp = new Date(b.start_date).getTime() - new Date(a.start_date).getTime(); break
        case 'energy': cmp = b.charge_energy_added - a.charge_energy_added; break
        case 'cost': cmp = (b.cost ?? 0) - (a.cost ?? 0); break
        case 'duration': cmp = b.duration_min - a.duration_min; break
        case 'power': cmp = (b.charger_power ?? 0) - (a.charger_power ?? 0); break
      }
      return sortDesc ? cmp : -cmp
    })
    return sorted
  }, [sessions, chargerFilter, sortBy, sortDesc])

  return (
    <div className="space-y-8">
      <PageHeader
        title="Charging Sessions"
        subtitle="Cost analysis, charger breakdown, energy patterns, and performance tracking"
        actions={
          vehicles && vehicles.length > 0 ? (
            <select value={vehicleId ?? ''} onChange={e => setSelectedVehicle(Number(e.target.value))} className="glass-input text-sm px-3 py-2">
              {vehicles.map((v: Vehicle) => <option key={v.id} value={v.id}>{v.display_name || v.vin}</option>)}
            </select>
          ) : undefined
        }
      />

      <FadeIn>
        <DateRangeFilter
          startDate={startDate}
          endDate={endDate}
          onStartDateChange={setStartDate}
          onEndDateChange={setEndDate}
          onApply={() => setPage(1)}
        />
      </FadeIn>

      {vehicleId && (
        <FadeIn>
          <ChargingSchedule vehicleId={vehicleId} />
        </FadeIn>
      )}

      {/* Hero gauges */}
      {stats && (
        <FadeIn>
          <GlassPanel className="p-4 sm:p-6">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4 sm:gap-6 items-center">
              <RadialGauge value={stats.count} max={Math.max(stats.count, 50)} label="Sessions" unit="" color="#00f0ff" />
              <RadialGauge value={Math.round(stats.totalEnergy)} max={Math.max(stats.totalEnergy, 500)} label="Energy" unit="kWh" color="#10b981" />
              <RadialGauge value={parseFloat(stats.totalCost.toFixed(0))} max={Math.max(stats.totalCost, 100)} label="Total Cost" unit="$" color="#f59e0b" />
              <RadialGauge value={Math.round(stats.avgPower)} max={250} label="Avg Power" unit="kW" color="#a855f7" />
              <div className="flex flex-col items-center text-center">
                <p className="text-2xl font-bold text-neon-green">$<AnimatedNumber value={parseFloat(stats.avgCostPerKwh.toFixed(2))} decimals={3} /></p>
                <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mt-1">Avg $/kWh</p>
              </div>
            </div>
          </GlassPanel>
        </FadeIn>
      )}

      {/* Quick metrics */}
      {stats && (
        <FadeIn delay={0.05}>
          <GlassPanel className="p-3 sm:p-5">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 sm:gap-4 text-center">
              <div>
                <p className="text-lg font-bold text-neon-green"><AnimatedNumber value={stats.homeCount} /></p>
                <p className="text-[10px] text-[var(--text-muted)] flex items-center justify-center gap-1"><Home className="h-3 w-3" /> Home</p>
              </div>
              <div>
                <p className="text-lg font-bold text-neon-red"><AnimatedNumber value={stats.scCount} /></p>
                <p className="text-[10px] text-[var(--text-muted)] flex items-center justify-center gap-1"><Bolt className="h-3 w-3" /> Supercharger</p>
              </div>
              <div>
                <p className="text-lg font-bold text-neon-amber"><AnimatedNumber value={stats.dcCount} /></p>
                <p className="text-[10px] text-[var(--text-muted)] flex items-center justify-center gap-1"><Zap className="h-3 w-3" /> DC Fast</p>
              </div>
              <div>
                <p className="text-lg font-bold text-[var(--text-primary)]">{formatDuration(stats.totalDuration)}</p>
                <p className="text-[10px] text-[var(--text-muted)]">Total Time</p>
              </div>
              <div>
                <p className="text-lg font-bold text-[var(--text-primary)]">${(stats.totalCost / 12).toFixed(0)}</p>
                <p className="text-[10px] text-[var(--text-muted)]">Monthly Avg</p>
              </div>
              <div>
                <p className="text-lg font-bold text-[var(--text-primary)]">{(stats.totalEnergy / stats.count).toFixed(1)} kWh</p>
                <p className="text-[10px] text-[var(--text-muted)]">Per Session</p>
              </div>
            </div>
          </GlassPanel>
        </FadeIn>
      )}

      {/* Charts row */}
      {sessions && sessions.length > 2 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Energy & Cost trend */}
          <FadeIn delay={0.1}>
            <GlassPanel className="p-6">
              <h3 className="section-title mb-4 flex items-center gap-2">
                <Calendar className="h-4 w-4 text-neon-cyan" /> Energy & Cost Trend
              </h3>
              <div className="h-40 sm:h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={energyTrend}>
                    <defs>
                      <linearGradient id="eGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                    <XAxis dataKey="date" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} />
                    <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Area type="monotone" dataKey="energy" name="Energy (kWh)" stroke="#10b981" fill="url(#eGrad)" strokeWidth={2} />
                    <Area type="monotone" dataKey="cost" name="Cost ($)" stroke="#f59e0b" fill="transparent" strokeWidth={1.5} strokeDasharray="4 2" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </GlassPanel>
          </FadeIn>

          {/* Charger type breakdown */}
          <FadeIn delay={0.15}>
            <GlassPanel className="p-6">
              <h3 className="section-title mb-4 flex items-center gap-2">
                <Plug className="h-4 w-4 text-neon-purple" /> Charger Breakdown
              </h3>
              <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6">
                <div className="h-36 w-36 sm:h-48 sm:w-48 shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={chargerBreakdown} cx="50%" cy="50%" innerRadius={40} outerRadius={70} paddingAngle={3} dataKey="value">
                        {chargerBreakdown.map((d, i) => <Cell key={i} fill={d.fill} stroke="transparent" />)}
                      </Pie>
                      <Tooltip content={<ChartTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex-1 space-y-3">
                  {costByType.map(ct => (
                    <div key={ct.name}>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-300">{ct.name}</span>
                        <span className="text-[var(--text-primary)] font-medium">{ct.energy.toFixed(0)} kWh</span>
                      </div>
                      <div className="flex justify-between text-xs text-[var(--text-muted)]">
                        <span>${ct.cost.toFixed(2)} total</span>
                        <span>${ct.perKwh.toFixed(3)}/kWh</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </GlassPanel>
          </FadeIn>
        </div>
      )}

      {/* AC/DC Detailed Stats */}
      {acDcBreakdown && (acDcBreakdown.ac.count > 0 || acDcBreakdown.dc.count > 0) && (
        <FadeIn delay={0.17}>
          <GlassPanel className="p-5">
            <h3 className="section-title flex items-center gap-2 mb-4">
              <Zap className="h-4 w-4 text-neon-amber" /> Charging Stats by Type
            </h3>
            {/* Energy Split Bar */}
            <div className="mb-4">
              <p className="text-[10px] text-[var(--text-muted)] mb-1.5">Energy Split (AC vs DC)</p>
              <div className="flex h-4 rounded-full overflow-hidden">
                {acDcBreakdown.ac.energy > 0 && (
                  <div
                    className="flex items-center justify-center text-[9px] font-bold text-[var(--text-primary)]"
                    style={{ width: `${(acDcBreakdown.ac.energy / acDcBreakdown.total.energy) * 100}%`, background: '#3b82f6' }}
                  >
                    AC {((acDcBreakdown.ac.energy / acDcBreakdown.total.energy) * 100).toFixed(0)}%
                  </div>
                )}
                {acDcBreakdown.dc.energy > 0 && (
                  <div
                    className="flex items-center justify-center text-[9px] font-bold text-[var(--text-primary)]"
                    style={{ width: `${(acDcBreakdown.dc.energy / acDcBreakdown.total.energy) * 100}%`, background: '#f59e0b' }}
                  >
                    DC {((acDcBreakdown.dc.energy / acDcBreakdown.total.energy) * 100).toFixed(0)}%
                  </div>
                )}
              </div>
              <div className="flex justify-between text-[10px] text-[var(--text-muted)] mt-1">
                <span>AC: {acDcBreakdown.ac.energy >= 1000 ? `${(acDcBreakdown.ac.energy / 1000).toFixed(2)} MWh` : `${acDcBreakdown.ac.energy.toFixed(1)} kWh`}</span>
                <span>Total: {acDcBreakdown.total.energy >= 1000 ? `${(acDcBreakdown.total.energy / 1000).toFixed(2)} MWh` : `${acDcBreakdown.total.energy.toFixed(1)} kWh`}</span>
                <span>DC: {acDcBreakdown.dc.energy >= 1000 ? `${(acDcBreakdown.dc.energy / 1000).toFixed(2)} MWh` : `${acDcBreakdown.dc.energy.toFixed(1)} kWh`}</span>
              </div>
            </div>
            {/* Stats Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[var(--text-muted)] border-b border-white/5">
                    <th className="text-left py-2 px-2 font-medium">Type</th>
                    <th className="text-right py-2 px-2 font-medium">Sessions</th>
                    <th className="text-right py-2 px-2 font-medium">Energy</th>
                    <th className="text-right py-2 px-2 font-medium">Cost</th>
                    <th className="text-right py-2 px-2 font-medium">$/kWh</th>
                    <th className="text-right py-2 px-2 font-medium">Avg Energy</th>
                    <th className="text-right py-2 px-2 font-medium">Avg Time</th>
                    <th className="text-right py-2 px-2 font-medium">Free</th>
                  </tr>
                </thead>
                <tbody>
                  {[{ label: 'AC Charging', color: '#3b82f6', ...acDcBreakdown.ac }, { label: 'DC Charging', color: '#f59e0b', ...acDcBreakdown.dc }]
                    .filter(r => r.count > 0)
                    .map(r => (
                    <tr key={r.label} className="border-b border-white/[0.02] hover:bg-white/[0.02]">
                      <td className="py-2 px-2 font-medium" style={{ color: r.color }}>{r.label}</td>
                      <td className="py-2 px-2 text-right text-[var(--text-primary)]">{r.count}</td>
                      <td className="py-2 px-2 text-right text-[var(--text-primary)]">{r.energy >= 1000 ? `${(r.energy / 1000).toFixed(2)} MWh` : `${r.energy.toFixed(1)} kWh`}</td>
                      <td className="py-2 px-2 text-right text-neon-amber">${r.cost.toFixed(2)}</td>
                      <td className="py-2 px-2 text-right text-gray-300">${r.energy > 0 ? (r.cost / r.energy).toFixed(3) : '—'}</td>
                      <td className="py-2 px-2 text-right text-gray-300">{(r.energy / r.count).toFixed(1)} kWh</td>
                      <td className="py-2 px-2 text-right text-gray-300">{formatDuration(r.totalDuration / r.count)}</td>
                      <td className="py-2 px-2 text-right text-neon-green">{r.freeCount > 0 ? `${r.freeCount} (${r.freeEnergy.toFixed(1)} kWh)` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Free charging total */}
            {acDcBreakdown.total.freeCount > 0 && (
              <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-center gap-4 text-xs text-[var(--text-secondary)]">
                <span>Free charged: <strong className="text-neon-green">{acDcBreakdown.total.freeCount} sessions</strong></span>
                <span>Free energy: <strong className="text-neon-green">{acDcBreakdown.total.freeEnergy.toFixed(1)} kWh</strong></span>
              </div>
            )}
          </GlassPanel>
        </FadeIn>
      )}

      {/* Battery level when starting charge */}
      {startLevelDist.length > 0 && sessions && sessions.length > 5 && (
        <FadeIn delay={0.2}>
          <GlassPanel className="p-6">
            <h3 className="section-title mb-4 flex items-center gap-2">
              <BatteryCharging className="h-4 w-4 text-neon-amber" /> Battery Level at Charge Start
              <span className="text-xs text-[var(--text-muted)] font-normal ml-2">How low do you typically go before charging?</span>
            </h3>
            <div className="h-36 sm:h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={startLevelDist}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                  <XAxis dataKey="range" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} />
                  <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="count" name="Sessions" fill="#f59e0b" fillOpacity={0.6} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </GlassPanel>
        </FadeIn>
      )}

      {/* ── Charging Optimizer ── */}
      {sessions && sessions.length > 2 && (
        <FadeIn delay={0.25}>
          <GlassPanel className="p-5 sm:p-6">
            <h3 className="section-title mb-5 flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-neon-amber" /> Charging Optimizer
            </h3>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Rate Comparison Card */}
              <GlassPanel className="p-4">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">Avg Cost per kWh by Location</h4>
                <div className="space-y-3">
                  {[
                    { label: 'Home Charging', rate: ratesByType.home, color: '#10b981' },
                    { label: 'Supercharger', rate: ratesByType.supercharger, color: '#ef4444' },
                    { label: 'DC Fast', rate: ratesByType.dc, color: '#f59e0b' },
                  ].map(item => (
                    <div key={item.label} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="h-2.5 w-2.5 rounded-full" style={{ background: item.color }} />
                        <span className="text-sm text-[var(--text-secondary)]">{item.label} avg:</span>
                      </div>
                      <span className="text-sm font-bold" style={{ color: item.rate > 0 ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                        {item.rate > 0 ? `$${item.rate.toFixed(3)}/kWh` : 'No data'}
                      </span>
                    </div>
                  ))}
                </div>
              </GlassPanel>

              {/* Recommendation Card */}
              {recommendation && (
                <GlassPanel className="p-4">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">Recommendations</h4>
                  <div className="space-y-3 text-sm">
                    {recommendation.savingsVsSc !== null && recommendation.savingsVsSc > 0 && (
                      <p className="text-[var(--text-secondary)]">
                        <span className="text-neon-green font-semibold">💡</span> Based on your data, home charging saves you{' '}
                        <strong className="text-neon-green">{recommendation.savingsVsSc}%</strong> vs Supercharging
                      </p>
                    )}
                    <p className="text-[var(--text-secondary)]">
                      <span className="text-neon-amber font-semibold">⭐</span> Best charging type:{' '}
                      <strong className="text-[var(--text-primary)]">{recommendation.cheapest.name}</strong> at{' '}
                      <strong className="text-neon-green">${recommendation.cheapest.rate.toFixed(3)}/kWh</strong>
                    </p>
                    <p className="text-[var(--text-secondary)]">
                      <span className="text-neon-cyan font-semibold">🔌</span> Recommended: charge at home between 10pm–6am for lowest rates
                    </p>
                  </div>
                </GlassPanel>
              )}

              {/* Monthly Charging Cost Trend */}
              {monthlyChargingCost.length > 1 && (
                <GlassPanel className="p-4">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3">Monthly Charging Cost</h4>
                  <div className="h-36">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={monthlyChargingCost}>
                        <defs>
                          <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#a855f7" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                        <XAxis dataKey="month" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} />
                        <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                        <Tooltip content={<ChartTooltip />} />
                        <Area type="monotone" dataKey="cost" name="Cost ($)" stroke="#a855f7" fill="url(#costGrad)" strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </GlassPanel>
              )}

              {/* Savings Calculator */}
              <GlassPanel className="p-4">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3 flex items-center gap-2">
                  <PiggyBank className="h-3.5 w-3.5 text-neon-green" /> Savings Calculator
                </h4>
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <label className="text-xs text-[var(--text-secondary)] whitespace-nowrap">Home electricity rate:</label>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-[var(--text-muted)]">$</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={homeRate}
                        onChange={e => setHomeRate(Math.max(0, parseFloat(e.target.value) || 0))}
                        className="glass-card w-20 px-2 py-1 text-sm rounded-lg border-0 focus:ring-1 focus:ring-neon-cyan/50"
                        style={{ background: 'var(--surface-2)', color: 'var(--text-primary)' }}
                      />
                      <span className="text-xs text-[var(--text-muted)]">/kWh</span>
                    </div>
                  </div>
                  {savingsCalc && (
                    <div className="space-y-2 pt-2 border-t border-white/5">
                      <div className="flex justify-between text-sm">
                        <span className="text-[var(--text-secondary)]">Actual total cost:</span>
                        <span className="font-bold text-[var(--text-primary)]">${savingsCalc.totalCost.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-[var(--text-secondary)]">If all charged at home:</span>
                        <span className="font-bold text-neon-green">${savingsCalc.hypotheticalCost.toFixed(2)}</span>
                      </div>
                      {savingsCalc.monthlySavings > 0 && (
                        <p className="text-sm text-neon-green font-semibold pt-1">
                          If you charged exclusively at home, you'd save ${savingsCalc.monthlySavings.toFixed(0)}/month
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </GlassPanel>
            </div>
          </GlassPanel>
        </FadeIn>
      )}

      {/* Charging Costs by Location */}
      {sessions && sessions.length > 0 && (
        <FadeIn delay={0.21}>
          <ChargingCostMap sessions={sessions} />
        </FadeIn>
      )}

      {/* Session list */}
      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-20" />)}</div>
      ) : sessions && sessions.length > 0 ? (
        <>
          {/* Sort & Filter controls */}
          <FadeIn delay={0.22}>
            <div className="flex flex-col sm:flex-row flex-wrap items-start sm:items-center gap-2 sm:gap-3">
              <h3 className="section-title flex items-center gap-2 flex-1">
                <BatteryCharging className="h-4 w-4 text-neon-green" /> All Sessions
                <span className="text-xs text-gray-600 font-normal ml-1">({filteredSessions.length})</span>
              </h3>
              {/* Charger filter */}
              <div className="flex items-center gap-1 rounded-lg bg-white/[0.02] p-1 border border-white/[0.06]">
                <Filter className="h-3 w-3 text-gray-600 ml-1" />
                {(['all', 'home', 'supercharger', 'dc'] as ChargerFilter[]).map(f => (
                  <button
                    key={f}
                    onClick={() => setChargerFilter(f)}
                    className={clsx('px-2.5 py-1 rounded-md text-[11px] font-medium transition-all',
                      chargerFilter === f ? 'bg-white/[0.08] text-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:text-gray-300'
                    )}
                  >
                    {f === 'all' ? 'All' : f === 'home' ? 'Home' : f === 'supercharger' ? 'SC' : 'DC'}
                  </button>
                ))}
              </div>
              {/* Sort controls */}
              <div className="flex items-center gap-1 rounded-lg bg-white/[0.02] p-1 border border-white/[0.06]">
                <ArrowUpDown className="h-3 w-3 text-gray-600 ml-1" />
                {(['date', 'energy', 'cost', 'duration', 'power'] as SortKey[]).map(k => (
                  <button
                    key={k}
                    onClick={() => { if (sortBy === k) setSortDesc(!sortDesc); else { setSortBy(k); setSortDesc(true) } }}
                    className={clsx('px-2.5 py-1 rounded-md text-[11px] font-medium transition-all',
                      sortBy === k ? 'bg-white/[0.08] text-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:text-gray-300'
                    )}
                  >
                    {k === 'date' ? 'Date' : k === 'energy' ? 'kWh' : k === 'cost' ? 'Cost' : k === 'duration' ? 'Time' : 'Power'}
                    {sortBy === k && <span className="ml-0.5">{sortDesc ? '↓' : '↑'}</span>}
                  </button>
                ))}
              </div>
              {/* Export buttons */}
              <div className="flex items-center gap-2">
                <a
                  href={`/api/v1/export/charging?format=csv${startDate ? `&start=${startDate}` : ''}${endDate ? `&end=${endDate}` : ''}${vehicleId ? `&vehicle_id=${vehicleId}` : ''}`}
                  download="teslasync-charging.csv"
                  className="glass-button text-xs flex items-center gap-1.5 px-2.5 py-1"
                >
                  <Download className="h-3.5 w-3.5" /> CSV
                </a>
                <a
                  href={`/api/v1/export/charging?format=json${startDate ? `&start=${startDate}` : ''}${endDate ? `&end=${endDate}` : ''}${vehicleId ? `&vehicle_id=${vehicleId}` : ''}`}
                  download="teslasync-charging.json"
                  className="glass-button text-xs flex items-center gap-1.5 px-2.5 py-1"
                >
                  <Download className="h-3.5 w-3.5" /> JSON
                </a>
              </div>
            </div>
          </FadeIn>
          <StaggerContainer className="space-y-3">
            {filteredSessions.map((s: ChargingSession) => (
              <StaggerItem key={s.id}><SessionCard session={s} /></StaggerItem>
            ))}
          </StaggerContainer>
          <Pagination page={page} pageSize={pageSize} total={filteredSessions.length < pageSize ? (page - 1) * pageSize + filteredSessions.length : page * pageSize + 1} onPageChange={setPage} onPageSizeChange={s => { setPageSize(s); setPage(1) }} />
        </>
      ) : (
        <EmptyState icon={<BatteryCharging className="h-8 w-8" />} title="No charging sessions yet" description="Charging data will appear here once your vehicle records a session." />
      )}
    </div>
  )
}
