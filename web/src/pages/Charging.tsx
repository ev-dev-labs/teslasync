import React, { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { getVehicles, getChargingSessions, ChargingSession, Vehicle } from '../api'
import { BatteryCharging, Clock, Zap, DollarSign, TrendingUp, Plug, ChevronRight, Home, Bolt, Calendar, ArrowUpDown, Filter, Download } from 'lucide-react'
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

  // Charging heatmap: 7 days × 24 hours
  const chargingHeatmap = useMemo(() => {
    if (!sessions || sessions.length === 0) return null
    const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0))
    sessions.forEach(s => {
      const d = new Date(s.start_date)
      const day = d.getDay() // 0=Sun
      const hour = d.getHours()
      // Shift so Mon=0
      const adjDay = (day + 6) % 7
      grid[adjDay][hour]++
    })
    const maxVal = Math.max(...grid.flat(), 1)
    return { grid, maxVal }
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

      {/* Charging Heatmap */}
      {chargingHeatmap && (
        <FadeIn delay={0.22}>
          <GlassPanel className="p-4 sm:p-6">
            <h3 className="section-title mb-4 flex items-center gap-2">
              <Calendar className="h-4 w-4 text-neon-cyan" /> Charging Frequency Heatmap
              <span className="text-xs text-[var(--text-muted)] font-normal ml-2">Sessions by hour &amp; day</span>
            </h3>
            <div className="overflow-x-auto">
              <div className="inline-grid gap-[2px]" style={{ gridTemplateColumns: `auto repeat(24, 1fr)` }}>
                {/* Hour headers */}
                <div />
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h} className="text-[9px] text-[var(--text-muted)] text-center w-5 sm:w-6">{h}</div>
                ))}
                {/* Grid rows */}
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, d) => (
                  <React.Fragment key={day}>
                    <div className="text-[10px] text-[var(--text-muted)] pr-2 flex items-center">{day}</div>
                    {Array.from({ length: 24 }, (_, h) => {
                      const count = chargingHeatmap.grid[d][h]
                      const intensity = count / chargingHeatmap.maxVal
                      return (
                        <div
                          key={`${day}-${h}`}
                          className="w-5 h-5 sm:w-6 sm:h-6 rounded-sm"
                          style={{
                            background: count === 0
                              ? 'rgba(255,255,255,0.03)'
                              : `rgba(0, 240, 255, ${0.15 + intensity * 0.85})`,
                          }}
                          title={`${day} ${h}:00 — ${count} session${count !== 1 ? 's' : ''}`}
                        />
                      )
                    })}
                  </React.Fragment>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2 mt-3 text-[10px] text-[var(--text-muted)]">
              <span>Less</span>
              {[0, 0.25, 0.5, 0.75, 1].map((v, i) => (
                <div key={i} className="w-4 h-4 rounded-sm" style={{ background: v === 0 ? 'rgba(255,255,255,0.03)' : `rgba(0, 240, 255, ${0.15 + v * 0.85})` }} />
              ))}
              <span>More</span>
            </div>
          </GlassPanel>
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
            {/* Find Charging Stations link */}
            <FadeIn>
              <a
                href="https://openchargemap.org/site/poi/search"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all mb-3"
                style={{ background: 'var(--surface-2)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.2)' }}
              >
                <Plug className="h-4 w-4" />
                Find Charging Stations Nearby (OpenChargeMap)
                <ChevronRight className="h-3.5 w-3.5 ml-auto" />
              </a>
            </FadeIn>
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
