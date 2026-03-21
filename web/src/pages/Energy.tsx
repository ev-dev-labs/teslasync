import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getVehicles, getEnergyStats, getChargingSessions, Vehicle, ChargingSession } from '../api'
import { PageHeader, GlassPanel, FadeIn, StaggerContainer, StaggerItem, DateRangeFilter, Skeleton } from '../components/ui'
import { RadialGauge } from '../components/Widgets'
import { Zap, Leaf, BarChart3, Activity, Fuel, Sun, Moon, Clock, ArrowRight, DollarSign, Car, TreePine, Waves, Home, BatteryCharging, TrendingUp } from 'lucide-react'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ComposedChart, Line, PieChart, Pie, Cell, Brush, Legend
} from 'recharts'
import { Link } from 'react-router-dom'
import { generateCarbonCertificate } from '../lib/certificate'
import { ChartTooltip, axisTickSm, chartGrid } from '../components/Charts'

function EnergyFlow({ totalCharged }: { totalCharged: number }) {
  const totalDriving = totalCharged * 0.75
  const totalClimate = totalCharged * 0.15
  const totalLoss = totalCharged * 0.10

  if (totalCharged <= 0) return null

  const maxBar = Math.max(totalDriving, totalClimate, totalLoss, 1)

  return (
    <GlassPanel className="p-6">
      <h3 className="section-title mb-4 flex items-center gap-2">
        <Waves className="h-4 w-4 text-neon-cyan" /> Energy Flow
      </h3>
      <div className="flex items-center gap-4 mt-4">
        {/* Source */}
        <div className="rounded-xl border border-neon-amber/20 bg-neon-amber/[0.04] p-4 text-center w-28 shrink-0">
          <Zap className="h-5 w-5 mx-auto text-neon-amber" />
          <p className="text-lg font-bold text-neon-amber mt-1">{totalCharged.toFixed(0)}</p>
          <p className="text-[9px] text-[var(--text-muted)]">kWh Charged</p>
        </div>

        {/* Arrow */}
        <div className="flex-1 min-w-8">
          <div className="h-1 rounded-full bg-gradient-to-r from-neon-amber to-neon-cyan" />
        </div>

        {/* Distribution */}
        <div className="space-y-3 flex-1">
          {[
            { label: 'Driving', value: totalDriving, color: '#00f0ff', pct: 75 },
            { label: 'Climate', value: totalClimate, color: '#a855f7', pct: 15 },
            { label: 'Loss / Vampire', value: totalLoss, color: '#ef4444', pct: 10 },
          ].map(item => (
            <div key={item.label} className="flex items-center gap-3">
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{item.label}</span>
                  <span className="text-[10px] font-mono" style={{ color: item.color }}>
                    {item.value.toFixed(1)} kWh ({item.pct}%)
                  </span>
                </div>
                <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${(item.value / maxBar) * 100}%`,
                      background: item.color,
                      boxShadow: `0 0 6px ${item.color}40`,
                    }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </GlassPanel>
  )
}

function EnergySourceBreakdown({ sessions }: { sessions: ChargingSession[] }) {
  const breakdown = useMemo(() => {
    if (!sessions || sessions.length === 0) return []
    const sources: Record<string, { energy: number; cost: number }> = {
      'Home / AC': { energy: 0, cost: 0 },
      'Supercharger': { energy: 0, cost: 0 },
      'Other DC': { energy: 0, cost: 0 },
    }
    sessions.forEach(s => {
      const key = s.fast_charger_type?.toLowerCase().includes('tesla') ? 'Supercharger'
        : s.fast_charger_type ? 'Other DC' : 'Home / AC'
      sources[key].energy += s.charge_energy_added
      sources[key].cost += s.cost ?? 0
    })
    const total = Object.values(sources).reduce((sum, s) => sum + s.energy, 0)
    const colors: Record<string, string> = { 'Home / AC': '#10b981', 'Supercharger': '#ef4444', 'Other DC': '#f59e0b' }
    const icons: Record<string, React.ReactNode> = {
      'Home / AC': <Home className="h-3.5 w-3.5" />,
      'Supercharger': <Zap className="h-3.5 w-3.5" />,
      'Other DC': <BatteryCharging className="h-3.5 w-3.5" />,
    }
    return Object.entries(sources)
      .filter(([, d]) => d.energy > 0)
      .map(([name, data]) => ({
        name,
        energy: data.energy,
        cost: data.cost,
        pct: total > 0 ? (data.energy / total) * 100 : 0,
        color: colors[name],
        icon: icons[name],
      }))
  }, [sessions])

  if (breakdown.length === 0) return null

  return (
    <GlassPanel className="p-6">
      <h3 className="section-title mb-4 flex items-center gap-2">
        <BatteryCharging className="h-4 w-4 text-neon-green" /> Energy Source Breakdown
      </h3>

      {/* Stacked horizontal bar */}
      <div className="h-6 rounded-full bg-white/5 overflow-hidden flex mb-4">
        {breakdown.map(b => (
          <div
            key={b.name}
            className="h-full transition-all duration-700"
            style={{
              width: `${b.pct}%`,
              background: b.color,
              boxShadow: `0 0 6px ${b.color}30`,
            }}
            title={`${b.name}: ${b.energy.toFixed(1)} kWh (${b.pct.toFixed(0)}%)`}
          />
        ))}
      </div>

      {/* Details */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {breakdown.map(b => (
          <div key={b.name} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: b.color }} />
              <span style={{ color: b.color }} className="text-sm font-medium flex items-center gap-1.5">
                {b.icon} {b.name}
              </span>
            </div>
            <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
              {b.energy.toFixed(1)} <span className="text-xs text-[var(--text-muted)]">kWh</span>
            </p>
            <div className="flex items-center justify-between mt-1">
              <span className="text-[10px] text-[var(--text-muted)]">{b.pct.toFixed(0)}% of total</span>
              {b.cost > 0 && <span className="text-[10px] text-neon-green">${b.cost.toFixed(2)}</span>}
            </div>
          </div>
        ))}
      </div>
    </GlassPanel>
  )
}

function MonthlyEnergyTrend({ sessions }: { sessions: ChargingSession[] }) {
  const monthlyData = useMemo(() => {
    if (!sessions || sessions.length === 0) return []
    const months: Record<string, { energy: number; cost: number; count: number; sortKey: string }> = {}
    sessions.forEach(s => {
      const d = new Date(s.start_date)
      const key = d.toLocaleDateString(undefined, { year: 'numeric', month: 'short' })
      const sortKey = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}`
      if (!months[key]) months[key] = { energy: 0, cost: 0, count: 0, sortKey }
      months[key].energy += s.charge_energy_added
      months[key].cost += s.cost ?? 0
      months[key].count++
    })
    return Object.entries(months)
      .sort(([, a], [, b]) => a.sortKey.localeCompare(b.sortKey))
      .map(([month, data]) => ({
        month,
        energy: parseFloat(data.energy.toFixed(1)),
        cost: parseFloat(data.cost.toFixed(2)),
        efficiency: data.energy > 0 ? parseFloat((data.cost / data.energy).toFixed(3)) : 0,
        sessions: data.count,
      }))
  }, [sessions])

  if (monthlyData.length < 2) return null

  return (
    <GlassPanel className="p-6">
      <h3 className="section-title mb-4 flex items-center gap-2">
        <TrendingUp className="h-4 w-4 text-neon-purple" /> Monthly Energy Trend
      </h3>
      <div className="h-56 sm:h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={monthlyData}>
            <defs>
              <linearGradient id="monthEnergyGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#00f0ff" stopOpacity={0.8} />
                <stop offset="100%" stopColor="#00f0ff" stopOpacity={0.3} />
              </linearGradient>
            </defs>
            {chartGrid}
            <XAxis dataKey="month" tick={axisTickSm} tickLine={false} axisLine={false} />
            <YAxis yAxisId="left" tick={axisTickSm} tickLine={false} axisLine={false} label={{ value: 'kWh', angle: -90, position: 'insideLeft', style: { fill: 'var(--text-muted)', fontSize: 10 } }} />
            <YAxis yAxisId="right" orientation="right" tick={axisTickSm} tickLine={false} axisLine={false} label={{ value: '$/kWh', angle: 90, position: 'insideRight', style: { fill: 'var(--text-muted)', fontSize: 10 } }} />
            <Tooltip content={<ChartTooltip />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar yAxisId="left" dataKey="energy" name="Energy (kWh)" fill="url(#monthEnergyGrad)" fillOpacity={0.7} radius={[4, 4, 0, 0]} animationDuration={800} />
            <Line yAxisId="left" type="monotone" dataKey="cost" name="Cost ($)" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3, fill: '#f59e0b' }} animationDuration={800} />
            <Line yAxisId="right" type="monotone" dataKey="efficiency" name="$/kWh" stroke="#a855f7" strokeWidth={2} strokeDasharray="4 4" dot={{ r: 3, fill: '#a855f7' }} animationDuration={800} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </GlassPanel>
  )
}

function CostComparisonCard({ label, evCost, gasCost, icon }: { label: string; evCost: number; gasCost: number; icon: React.ReactNode }) {
  const savings = gasCost - evCost
  const savingsPct = gasCost > 0 ? (savings / gasCost * 100) : 0
  return (
    <GlassPanel className="p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-neon-green/10 text-neon-green">{icon}</div>
        <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>{label}</p>
      </div>
      <div className="flex items-center gap-4 mb-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>EV Cost</p>
          <p className="text-lg font-bold text-neon-cyan">${evCost.toFixed(2)}</p>
        </div>
        <ArrowRight className="h-4 w-4" style={{ color: 'var(--text-muted)' }} />
        <div>
          <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Gas Equivalent</p>
          <p className="text-lg font-bold" style={{ color: 'var(--text-secondary)' }}>${gasCost.toFixed(2)}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold text-neon-green">Saving ${savings.toFixed(2)}</span>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-neon-green/10 text-neon-green font-semibold">{savingsPct.toFixed(0)}% less</span>
      </div>
    </GlassPanel>
  )
}

function CostOfOwnershipCalculator() {
  const [gasPrice, setGasPrice] = useState(1.50)
  const [gasConsumption, setGasConsumption] = useState(8)
  const [electricityRate, setElectricityRate] = useState(0.15)
  const [annualKm, setAnnualKm] = useState(15000)
  const [years, setYears] = useState(5)

  const evEfficiency = 0.18
  const annualGasMaintenance = 1200
  const annualEvMaintenance = 400

  const annualGasCost = (annualKm / 100) * gasConsumption * gasPrice
  const totalGasCost = (annualGasCost + annualGasMaintenance) * years

  const annualEvCost = annualKm * evEfficiency * electricityRate
  const totalEvCost = (annualEvCost + annualEvMaintenance) * years

  const savings = totalGasCost - totalEvCost
  const co2Saved = (annualKm / 100) * gasConsumption * 2.31 * years

  const barData = useMemo(() => {
    return Array.from({ length: years }, (_, i) => {
      const yr = i + 1
      return {
        year: `Year ${yr}`,
        'Gas Car': Math.round((annualGasCost + annualGasMaintenance) * yr),
        Tesla: Math.round((annualEvCost + annualEvMaintenance) * yr),
      }
    })
  }, [years, annualGasCost, annualEvCost, annualGasMaintenance, annualEvMaintenance])

  const sliderClass = 'w-full h-1.5 rounded-lg appearance-none cursor-pointer bg-white/[0.08] accent-neon-cyan'

  return (
    <GlassPanel className="p-6">
      <h3 className="section-title mb-6 flex items-center gap-2">
        <DollarSign className="h-4 w-4 text-neon-green" /> Total Cost of Ownership
      </h3>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Sliders */}
        <div className="space-y-5">
          <div>
            <label className="flex items-center justify-between text-sm mb-2">
              <span style={{ color: 'var(--text-secondary)' }}>Gas Price</span>
              <span className="text-neon-cyan font-mono">${gasPrice.toFixed(2)}/L</span>
            </label>
            <input type="range" min={0.5} max={3} step={0.05} value={gasPrice}
              onChange={e => setGasPrice(Number(e.target.value))} className={sliderClass} />
          </div>
          <div>
            <label className="flex items-center justify-between text-sm mb-2">
              <span style={{ color: 'var(--text-secondary)' }}>Gas Consumption</span>
              <span className="text-neon-cyan font-mono">{gasConsumption} L/100km</span>
            </label>
            <input type="range" min={4} max={16} step={0.5} value={gasConsumption}
              onChange={e => setGasConsumption(Number(e.target.value))} className={sliderClass} />
          </div>
          <div>
            <label className="flex items-center justify-between text-sm mb-2">
              <span style={{ color: 'var(--text-secondary)' }}>Electricity Rate</span>
              <span className="text-neon-cyan font-mono">${electricityRate.toFixed(2)}/kWh</span>
            </label>
            <input type="range" min={0.05} max={0.50} step={0.01} value={electricityRate}
              onChange={e => setElectricityRate(Number(e.target.value))} className={sliderClass} />
          </div>
          <div>
            <label className="flex items-center justify-between text-sm mb-2">
              <span style={{ color: 'var(--text-secondary)' }}>Annual Distance</span>
              <span className="text-neon-cyan font-mono">{annualKm.toLocaleString()} km</span>
            </label>
            <input type="range" min={5000} max={50000} step={1000} value={annualKm}
              onChange={e => setAnnualKm(Number(e.target.value))} className={sliderClass} />
          </div>
          <div>
            <label className="flex items-center justify-between text-sm mb-2">
              <span style={{ color: 'var(--text-secondary)' }}>Ownership Period</span>
              <span className="text-neon-cyan font-mono">{years} years</span>
            </label>
            <input type="range" min={1} max={10} step={1} value={years}
              onChange={e => setYears(Number(e.target.value))} className={sliderClass} />
          </div>
        </div>

        {/* Side-by-side comparison */}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl border border-white/[0.06] p-4 bg-white/[0.02]">
              <div className="flex items-center gap-2 mb-3">
                <Car className="h-4 w-4" style={{ color: 'var(--text-muted)' }} />
                <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Gas Car</span>
              </div>
              <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Annual Fuel</p>
              <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>${annualGasCost.toFixed(0)}</p>
              <p className="text-[10px] uppercase tracking-wider mt-2 mb-1" style={{ color: 'var(--text-muted)' }}>Maintenance/yr</p>
              <p className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>${annualGasMaintenance}</p>
              <div className="mt-3 pt-3 border-t border-white/[0.06]">
                <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>{years}-Year Total</p>
                <p className="text-xl font-bold text-neon-red">${totalGasCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
              </div>
            </div>
            <div className="rounded-xl border border-neon-cyan/20 p-4 bg-neon-cyan/[0.02]">
              <div className="flex items-center gap-2 mb-3">
                <Zap className="h-4 w-4 text-neon-cyan" />
                <span className="text-sm font-medium text-neon-cyan">Tesla</span>
              </div>
              <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Annual Energy</p>
              <p className="text-lg font-bold text-neon-cyan">${annualEvCost.toFixed(0)}</p>
              <p className="text-[10px] uppercase tracking-wider mt-2 mb-1" style={{ color: 'var(--text-muted)' }}>Maintenance/yr</p>
              <p className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>${annualEvMaintenance}</p>
              <div className="mt-3 pt-3 border-t border-neon-cyan/10">
                <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>{years}-Year Total</p>
                <p className="text-xl font-bold text-neon-green">${totalEvCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
              </div>
            </div>
          </div>

          {/* Savings highlight */}
          <div className="rounded-xl border border-neon-green/20 bg-neon-green/[0.03] p-4 flex items-center gap-4">
            <div className="flex-1">
              <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                {savings > 0 ? `You save` : 'Additional cost'}
              </p>
              <p className={`text-2xl font-bold ${savings > 0 ? 'text-neon-green' : 'text-neon-red'}`}>
                ${Math.abs(savings).toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </p>
              <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
                over {years} years with Tesla
              </p>
            </div>
            <div className="text-right">
              <div className="flex items-center gap-1.5 text-neon-green">
                <TreePine className="h-4 w-4" />
                <span className="text-sm font-bold">{co2Saved.toLocaleString(undefined, { maximumFractionDigits: 0 })} kg</span>
              </div>
              <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>CO₂ avoided</p>
            </div>
          </div>
        </div>
      </div>

      {/* Bar chart */}
      <div className="mt-8">
        <h4 className="text-sm font-medium mb-4" style={{ color: 'var(--text-secondary)' }}>
          Cumulative Cost Over Time
        </h4>
        <div className="h-48 sm:h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={barData}>
              {chartGrid}
              <XAxis dataKey="year" tick={axisTickSm} tickLine={false} axisLine={false} />
              <YAxis tick={axisTickSm} tickLine={false} axisLine={false}
                tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Gas Car" fill="#ef4444" fillOpacity={0.7} radius={[3, 3, 0, 0]} />
              <Bar dataKey="Tesla" fill="#00f0ff" fillOpacity={0.7} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </GlassPanel>
  )
}

export default function Energy() {
  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: getVehicles })
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null)
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0])

  const vehicleId = selectedVehicle ?? vehicles?.[0]?.id ?? null

  const { data: stats, isLoading } = useQuery({
    queryKey: ['energy-stats', vehicleId, startDate],
    queryFn: () => getEnergyStats(vehicleId!, 30, startDate),
    enabled: vehicleId !== null,
  })

  const { data: sessions } = useQuery({
    queryKey: ['charging', vehicleId],
    queryFn: () => getChargingSessions(vehicleId!, 100),
    enabled: vehicleId !== null,
  })

  const totalEnergy = sessions?.reduce((sum, s) => sum + s.charge_energy_added, 0) ?? 0
  const totalCost = sessions?.reduce((sum, s) => sum + (s.cost ?? 0), 0) ?? 0
  const avgEfficiency = stats?.avg_efficiency_wh_km ?? 0
  const totalDistance = stats?.total_distance_km ?? 0
  const co2Saved = stats?.co2_saved_kg ?? (totalEnergy * 0.42)

  const periodDays = Math.max(1, Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000))
  const costPerKm = totalDistance > 0 ? totalCost / totalDistance : 0
  const costPerKwh = totalEnergy > 0 ? totalCost / totalEnergy : 0
  const gasEquivalent = totalDistance * 0.12 // ~$0.12/km for gas car
  const dailyEnergy = stats?.daily_breakdown ?? []
  // Time-of-day analysis (simulated from charging sessions)
  const timeOfDayData = useMemo(() => {
    if (!sessions || sessions.length === 0) return []
    const buckets: Record<string, { count: number; energy: number }> = {}
    const labels = ['Night (0-6)', 'Morning (6-12)', 'Afternoon (12-18)', 'Evening (18-24)']
    labels.forEach(l => { buckets[l] = { count: 0, energy: 0 } })
    sessions.forEach(s => {
      const hour = new Date(s.start_date).getHours()
      const idx = hour < 6 ? 0 : hour < 12 ? 1 : hour < 18 ? 2 : 3
      buckets[labels[idx]].count++
      buckets[labels[idx]].energy += s.charge_energy_added
    })
    return labels.map(name => ({ name, ...buckets[name] }))
  }, [sessions])

  // Charger type breakdown
  const chargerBreakdown = useMemo(() => {
    if (!sessions || sessions.length === 0) return []
    const types: Record<string, { count: number; energy: number; cost: number }> = {}
    sessions.forEach(s => {
      const label = s.fast_charger_type?.toLowerCase().includes('tesla') ? 'Supercharger'
        : s.fast_charger_type ? 'DC Fast' : 'Home/AC'
      if (!types[label]) types[label] = { count: 0, energy: 0, cost: 0 }
      types[label].count++
      types[label].energy += s.charge_energy_added
      types[label].cost += s.cost ?? 0
    })
    const colors: Record<string, string> = { Supercharger: '#ef4444', 'DC Fast': '#f59e0b', 'Home/AC': '#10b981' }
    return Object.entries(types).map(([name, data]) => ({ name, ...data, fill: colors[name] ?? '#00f0ff' }))
  }, [sessions])

  // Monthly projection
  const monthlyProjectedCost = costPerKm > 0 ? costPerKm * (totalDistance / periodDays) * 30 : 0
  const yearlyProjectedCost = monthlyProjectedCost * 12

  return (
    <div className="space-y-8">
      <PageHeader
        title="Energy Intelligence"
        subtitle="Deep cost analytics, efficiency trends, savings projections, and consumption patterns"
        actions={
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            {vehicles && vehicles.length > 1 && (
              <select
                value={vehicleId ?? ''}
                onChange={e => setSelectedVehicle(Number(e.target.value))}
                className="glass-input text-sm px-3 py-2"
              >
                {vehicles.map((v: Vehicle) => (
                  <option key={v.id} value={v.id}>{v.display_name || v.vin}</option>
                ))}
              </select>
            )}
            <DateRangeFilter
              startDate={startDate}
              endDate={endDate}
              onStartDateChange={setStartDate}
              onEndDateChange={setEndDate}
            />
          </div>
        }
      />

      {/* Hero gauges */}
      <FadeIn>
        <GlassPanel className="p-4 sm:p-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6 items-center">
            <RadialGauge value={totalEnergy} max={Math.max(totalEnergy * 1.3, 100)} label="Energy Used" unit="kWh" color="#00f0ff" />
            <RadialGauge value={avgEfficiency || (totalDistance > 0 ? (totalEnergy * 1000 / totalDistance) : 0)} max={300} label="Efficiency" unit="Wh/km" color="#10b981" />
            <RadialGauge value={co2Saved} max={Math.max(co2Saved * 1.5, 50)} label="CO₂ Saved" unit="kg" color="#a855f7" />
            <RadialGauge value={totalCost} max={Math.max(totalCost * 1.5, 50)} label="Total Cost" unit="$" color="#f59e0b" />
          </div>
        </GlassPanel>
      </FadeIn>

      {/* Quick metrics strip */}
      <StaggerContainer className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        {[
          { label: 'Cost per km', value: `$${costPerKm.toFixed(3)}`, color: 'text-neon-cyan' },
          { label: 'Cost per kWh', value: `$${costPerKwh.toFixed(3)}`, color: 'text-neon-green' },
          { label: 'Total Distance', value: `${totalDistance.toFixed(0)} km`, color: 'text-[var(--text-primary)]' },
          { label: 'Sessions', value: `${sessions?.length ?? 0}`, color: 'text-neon-purple' },
          { label: 'Monthly Est.', value: `$${monthlyProjectedCost.toFixed(2)}`, color: 'text-neon-amber' },
          { label: 'Yearly Est.', value: `$${yearlyProjectedCost.toFixed(2)}`, color: 'text-neon-red' },
        ].map(m => (
          <StaggerItem key={m.label}>
            <GlassPanel className="p-3 text-center">
              <p className="text-[10px] text-gray-600 uppercase tracking-wider">{m.label}</p>
              <p className={`text-lg font-bold ${m.color}`}>{m.value}</p>
            </GlassPanel>
          </StaggerItem>
        ))}
      </StaggerContainer>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2"><Skeleton className="h-80" /><Skeleton className="h-80" /></div>
      ) : (
        <>
          {/* Cost vs Gas Savings */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FadeIn>
              <CostComparisonCard
                label={`${periodDays}-Day Total`}
                evCost={totalCost}
                gasCost={gasEquivalent}
                icon={<Fuel className="h-4 w-4" />}
              />
            </FadeIn>
            <FadeIn delay={0.05}>
              <CostComparisonCard
                label="Projected Annual"
                evCost={yearlyProjectedCost}
                gasCost={gasEquivalent / periodDays * 365}
                icon={<Leaf className="h-4 w-4" />}
              />
            </FadeIn>
          </div>

          {/* Charts Row 1 */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <FadeIn delay={0.1}>
              <GlassPanel className="p-6">
                <h3 className="section-title mb-6 flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-neon-cyan" /> Energy & Cost Daily
                </h3>
                <div className="h-48 sm:h-64">
                  {dailyEnergy.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={dailyEnergy}>
                        <defs>
                          <linearGradient id="energyBarGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#00f0ff" stopOpacity={0.8} />
                            <stop offset="100%" stopColor="#00f0ff" stopOpacity={0.3} />
                          </linearGradient>
                        </defs>
                        {chartGrid}
                        <XAxis dataKey="date" tick={axisTickSm} tickLine={false} axisLine={false} />
                        <YAxis yAxisId="left" tick={axisTickSm} tickLine={false} axisLine={false} />
                        <YAxis yAxisId="right" orientation="right" tick={axisTickSm} tickLine={false} axisLine={false} />
                        <Tooltip content={<ChartTooltip />} />
                        <Bar yAxisId="left" dataKey="energy_kwh" name="Energy (kWh)" fill="url(#energyBarGrad)" fillOpacity={0.6} radius={[3, 3, 0, 0]} animationDuration={800} />
                        <Line yAxisId="right" type="monotone" dataKey="efficiency" name="Wh/km" stroke="#10b981" strokeWidth={2} dot={false} animationDuration={800} />
                        {dailyEnergy.length > 14 && <Brush dataKey="date" height={20} stroke="#6b7280" fill="rgba(255,255,255,0.02)" travellerWidth={8} />}
                      </ComposedChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex items-center justify-center h-full text-[var(--text-muted)] text-sm">Connect vehicle to see energy data</div>
                  )}
                </div>
              </GlassPanel>
            </FadeIn>

            <FadeIn delay={0.15}>
              <GlassPanel className="p-6">
                <h3 className="section-title mb-6 flex items-center gap-2">
                  <Activity className="h-4 w-4 text-neon-green" /> Efficiency Trend
                </h3>
                <div className="h-48 sm:h-64">
                  {dailyEnergy.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={dailyEnergy}>
                        <defs>
                          <linearGradient id="effGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="distGrad2" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#00f0ff" stopOpacity={0.15} />
                            <stop offset="95%" stopColor="#00f0ff" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        {chartGrid}
                        <XAxis dataKey="date" tick={axisTickSm} tickLine={false} axisLine={false} />
                        <YAxis tick={axisTickSm} tickLine={false} axisLine={false} />
                        <Tooltip content={<ChartTooltip />} />
                        <Area type="monotone" dataKey="efficiency" name="Wh/km" stroke="#10b981" fill="url(#effGrad)" strokeWidth={2} animationDuration={800} />
                        <Area type="monotone" dataKey="distance_km" name="Distance (km)" stroke="#00f0ff" fill="url(#distGrad2)" strokeWidth={1} strokeDasharray="4 4" animationDuration={800} />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex items-center justify-center h-full text-[var(--text-muted)] text-sm">No efficiency data yet</div>
                  )}
                </div>
              </GlassPanel>
            </FadeIn>
          </div>

          {/* Charts Row 2: Time of Day + Charger Breakdown */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {timeOfDayData.length > 0 && (
              <FadeIn delay={0.2}>
                <GlassPanel className="p-6">
                  <h3 className="section-title mb-6 flex items-center gap-2">
                    <Clock className="h-4 w-4 text-neon-amber" /> Charging by Time of Day
                  </h3>
                  <div className="h-44 sm:h-60">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={timeOfDayData}>
                        {chartGrid}
                        <XAxis dataKey="name" tick={axisTickSm} tickLine={false} axisLine={false} />
                        <YAxis tick={axisTickSm} tickLine={false} axisLine={false} />
                        <Tooltip content={<ChartTooltip />} />
                        <Bar dataKey="energy" name="Energy (kWh)" fill="#f59e0b" fillOpacity={0.7} radius={[3, 3, 0, 0]} animationDuration={800} />
                        <Bar dataKey="count" name="Sessions" fill="#a855f7" fillOpacity={0.5} radius={[3, 3, 0, 0]} animationDuration={800} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-3 flex items-center gap-4 text-[10px] text-[var(--text-muted)]">
                    <span className="flex items-center gap-1"><Moon className="h-3 w-3" /> Off-peak charging saves money</span>
                    <span className="flex items-center gap-1"><Sun className="h-3 w-3" /> Solar-optimal: 10am–3pm</span>
                  </div>
                </GlassPanel>
              </FadeIn>
            )}

            {chargerBreakdown.length > 0 && (
              <FadeIn delay={0.25}>
                <GlassPanel className="p-6">
                  <h3 className="section-title mb-6 flex items-center gap-2">
                    <Zap className="h-4 w-4 text-neon-cyan" /> Charger Type Breakdown
                  </h3>
                  <div className="flex items-center gap-6">
                    <div className="h-48 w-48">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={chargerBreakdown} cx="50%" cy="50%" innerRadius={40} outerRadius={70} paddingAngle={3} dataKey="energy">
                            {chargerBreakdown.map((entry, i) => (
                              <Cell key={i} fill={entry.fill} stroke="transparent" />
                            ))}
                          </Pie>
                          <Tooltip content={<ChartTooltip />} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex-1 space-y-3">
                      {chargerBreakdown.map(b => (
                        <div key={b.name}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="flex items-center gap-2 text-sm">
                              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: b.fill }} />
                              <span className="text-gray-300">{b.name}</span>
                            </span>
                            <span className="text-xs text-[var(--text-muted)]">{b.count} sessions</span>
                          </div>
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-neon-cyan">{b.energy.toFixed(1)} kWh</span>
                            <span className="text-neon-green">${b.cost.toFixed(2)}</span>
                            <span className="text-gray-600">${b.energy > 0 ? (b.cost / b.energy).toFixed(3) : '0'}/kWh</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </GlassPanel>
              </FadeIn>
            )}
          </div>

          {/* Energy Flow Visualization */}
          <FadeIn delay={0.27}>
            <EnergyFlow totalCharged={totalEnergy} />
          </FadeIn>

          {/* Energy Source Breakdown */}
          {sessions && sessions.length > 0 && (
            <FadeIn delay={0.28}>
              <EnergySourceBreakdown sessions={sessions} />
            </FadeIn>
          )}

          {/* Monthly Energy Trend */}
          {sessions && sessions.length > 0 && (
            <FadeIn delay={0.29}>
              <MonthlyEnergyTrend sessions={sessions} />
            </FadeIn>
          )}

          {/* Recent Charging Sessions (enhanced) */}
          {sessions && sessions.length > 0 && (
            <FadeIn delay={0.3}>
              <GlassPanel className="p-6">
                <h3 className="section-title mb-4 flex items-center gap-2">
                  <Zap className="h-4 w-4 text-neon-amber" /> Recent Charging Sessions
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-white/[0.06] text-[var(--text-muted)] text-xs uppercase tracking-wider">
                      <tr>
                        <th className="pb-3 pr-4">Date</th>
                        <th className="pb-3 pr-4">Energy</th>
                        <th className="pb-3 pr-4">Battery</th>
                        <th className="pb-3 pr-4">Power</th>
                        <th className="pb-3 pr-4">Type</th>
                        <th className="pb-3 pr-4">Cost</th>
                        <th className="pb-3">$/kWh</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.03]">
                      {sessions.slice(0, 15).map(s => (
                        <tr key={s.id} className="text-gray-300 hover:bg-white/[0.02] transition-colors cursor-pointer">
                          <td className="py-3 pr-4">
                            <Link to={`/charging/${s.id}`} className="hover:text-neon-cyan transition-colors">
                              {new Date(s.start_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                            </Link>
                          </td>
                          <td className="py-3 pr-4 text-neon-cyan font-medium">{s.charge_energy_added.toFixed(1)} kWh</td>
                          <td className="py-3 pr-4">
                            <span className="text-[var(--text-muted)]">{s.start_battery_level}%</span>
                            <span className="text-gray-700 mx-1">→</span>
                            <span className="text-neon-green">{s.end_battery_level ?? '—'}%</span>
                          </td>
                          <td className="py-3 pr-4">{s.charger_power !== null ? `${s.charger_power} kW` : '—'}</td>
                          <td className="py-3 pr-4">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ring-1 ${
                              s.fast_charger_type?.toLowerCase().includes('tesla') ? 'bg-neon-red/10 text-neon-red ring-neon-red/20' :
                              s.fast_charger_type ? 'bg-neon-amber/10 text-neon-amber ring-neon-amber/20' :
                              'bg-neon-green/10 text-neon-green ring-neon-green/20'
                            }`}>
                              {s.fast_charger_type?.toLowerCase().includes('tesla') ? 'Supercharger' : s.fast_charger_type || 'AC'}
                            </span>
                          </td>
                          <td className="py-3 pr-4">{s.cost !== null ? `$${s.cost.toFixed(2)}` : '—'}</td>
                          <td className="py-3 text-[var(--text-muted)]">{s.cost !== null && s.charge_energy_added > 0 ? `$${(s.cost / s.charge_energy_added).toFixed(3)}` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </GlassPanel>
            </FadeIn>
          )}
        </>
      )}

      {/* Carbon Offset Certificate */}
      <FadeIn delay={0.3}>
        <GlassPanel className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="section-title mb-1 flex items-center gap-2">
                <TreePine className="h-4 w-4 text-neon-green" /> Environmental Impact
              </h3>
              <p className="text-xs text-[var(--text-muted)]">Generate a printable certificate of your carbon savings</p>
            </div>
            <button
              onClick={() => generateCarbonCertificate({
                vehicleName: vehicles?.find((v: Vehicle) => v.id === vehicleId)?.display_name || 'Tesla',
                totalKm: totalDistance,
                totalKwh: totalEnergy,
              })}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-neon-green/10 border border-neon-green/20 text-neon-green text-sm font-medium hover:bg-neon-green/20 transition-colors"
            >
              🌍 Generate Certificate
            </button>
          </div>
        </GlassPanel>
      </FadeIn>

      {/* Total Cost of Ownership Calculator */}
      <FadeIn delay={0.35}>
        <CostOfOwnershipCalculator />
      </FadeIn>
    </div>
  )
}
