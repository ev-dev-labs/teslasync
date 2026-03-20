import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getVehicles, getEnergyStats, getChargingSessions, Vehicle } from '../api'
import { PageHeader, GlassPanel, FadeIn, StaggerContainer, StaggerItem, DateRangeFilter, Skeleton } from '../components/ui'
import { RadialGauge } from '../components/Widgets'
import { Zap, Leaf, BarChart3, Activity, Fuel, Sun, Moon, Clock, ArrowRight } from 'lucide-react'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ComposedChart, Line, PieChart, Pie, Cell, Brush
} from 'recharts'
import { Link } from 'react-router-dom'
import { ChartTooltip, axisTickSm, chartGrid } from '../components/Charts'

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
          {/* Environmental Impact Card */}
          <FadeIn delay={0.25}>
            <GlassPanel className="p-5 mt-6">
              <h3 className="text-sm font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                <Leaf className="h-4 w-4 text-neon-green" /> Environmental Impact
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {(() => {
                  const co2PerLiter = 2.31
                  const avgGasConsumption = 8 // L/100km
                  const litersAvoided = totalDistance * avgGasConsumption / 100
                  const co2Avoided = litersAvoided * co2PerLiter
                  const treesEquiv = co2Avoided / 22 // ~22kg CO2 per tree per year
                  const gallonsSaved = litersAvoided / 3.78541

                  return [
                    { label: 'CO₂ Avoided', value: `${co2Avoided.toFixed(0)} kg`, sub: 'vs gasoline car', color: '#10b981' },
                    { label: 'Equiv. Trees Planted', value: treesEquiv.toFixed(1), sub: 'for one year', color: '#22c55e' },
                    { label: 'Gas Gallons Saved', value: gallonsSaved.toFixed(0), sub: `${litersAvoided.toFixed(0)} liters`, color: '#f59e0b' },
                    { label: 'Gas Cost Avoided', value: `$${(litersAvoided * 1.5).toFixed(0)}`, sub: 'at $1.50/L avg', color: '#8b5cf6' },
                  ].map(card => (
                    <div key={card.label} className="text-center">
                      <p className="text-2xl font-bold" style={{ color: card.color }}>{card.value}</p>
                      <p className="text-xs font-medium mt-1" style={{ color: 'var(--text-secondary)' }}>{card.label}</p>
                      <p className="text-[10px] text-[var(--text-muted)]">{card.sub}</p>
                    </div>
                  ))
                })()}
              </div>
            </GlassPanel>
          </FadeIn>
        </>
      )}
      {/* Cost per km/mi Trend */}
      {stats && stats.daily_breakdown && stats.daily_breakdown.length > 0 && (
        <FadeIn delay={0.35}>
          <GlassPanel className="p-5">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <Fuel className="h-4 w-4 text-neon-green" /> Cost per km Trend
            </h3>
            <div className="h-48 sm:h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={(() => {
                  const months: Record<string, { energy: number; distance: number; cost: number }> = {}
                  stats.daily_breakdown.forEach(d => {
                    const month = d.date.slice(0, 7)
                    if (!months[month]) months[month] = { energy: 0, distance: 0, cost: 0 }
                    months[month].energy += d.energy_kwh
                    months[month].distance += d.distance_km
                    months[month].cost += d.energy_kwh * (totalDistance > 0 ? totalCost / totalEnergy : 0.12)
                  })
                  return Object.entries(months).map(([month, data]) => ({
                    month,
                    costPerKm: data.distance > 0 ? (data.cost / data.distance) : 0,
                  }))
                })()}>
                  {chartGrid}
                  <XAxis dataKey="month" tick={axisTickSm} />
                  <YAxis tick={axisTickSm} tickFormatter={(v: number) => `$${v.toFixed(3)}`} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area type="monotone" dataKey="costPerKm" name="Cost/km ($)" stroke="#10b981" fill="#10b981" fillOpacity={0.15} strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </GlassPanel>
        </FadeIn>
      )}
    </div>
  )
}
