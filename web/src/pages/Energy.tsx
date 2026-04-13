import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getVehicles, getEnergyStats, getChargingSessions, Vehicle } from '../api'
import { PageHeader, GlassPanel, FadeIn, StaggerContainer, StaggerItem, DateRangeFilter, Skeleton, QueryError, ChartContainer, Select, DataTable, type Column } from '../components/ui'
import { RadialGauge } from '../components/Widgets'
import { Zap, Leaf, Fuel, Sun, Moon, ArrowRight } from 'lucide-react'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ComposedChart, Line, PieChart, Pie, Cell, Brush
} from 'recharts'
import { Link } from 'react-router-dom'
import { ChartTooltip, axisTickSm, chartGrid } from '../components/Charts'
import { useSettings } from '../hooks/useSettings'
import { formatDateShort } from '../lib/dateFormat'
import { fmtNumber, fmtInt, fmtPercent } from '../lib/numberFormat'
import { COLOR } from '../lib/colors'
import { usePageTitle } from '../hooks/usePageTitle'

function CostComparisonCard({ label, evCost, gasCost, icon }: { label: string; evCost: number; gasCost: number; icon: React.ReactNode }) {
  const savings = (gasCost ?? 0) - (evCost ?? 0)
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
          <p className="text-lg font-bold text-neon-cyan">${fmtNumber(evCost ?? 0)}</p>
        </div>
        <ArrowRight className="h-4 w-4" style={{ color: 'var(--text-muted)' }} />
        <div>
          <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Gas Equivalent</p>
          <p className="text-lg font-bold" style={{ color: 'var(--text-secondary)' }}>${fmtNumber(gasCost ?? 0)}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold text-neon-green">Saving ${fmtNumber(savings ?? 0)}</span>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-neon-green/10 text-neon-green font-semibold">{fmtPercent(savingsPct ?? 0)} less</span>
      </div>
    </GlassPanel>
  )
}

export default function Energy() {
  usePageTitle('Energy')
  const { convertDistance, convertEfficiency, distanceUnit, efficiencyUnit } = useSettings()
  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: getVehicles })
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null)
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0])

  const vehicleId = selectedVehicle ?? vehicles?.[0]?.id ?? null

  const { data: stats, isLoading, error: statsError, refetch } = useQuery({
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
    const colors: Record<string, string> = { Supercharger: COLOR.BAD, 'DC Fast': COLOR.WARN, 'Home/AC': COLOR.GOOD }
    return Object.entries(types).map(([name, data]) => ({ name, ...data, fill: colors[name] ?? COLOR.CYAN }))
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
              <Select
                value={String(vehicleId ?? '')}
                onChange={e => setSelectedVehicle(Number(e.target.value))}
                options={vehicles.map((v: Vehicle) => ({ value: String(v.id), label: v.display_name || v.vin }))}
                className="text-sm"
              />
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

      {statsError && <QueryError error={statsError} onRetry={refetch} />}

      {/* Hero gauges */}
      <FadeIn>
        <GlassPanel className="p-4 sm:p-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6 items-center">
            <RadialGauge value={totalEnergy} max={Math.max(totalEnergy * 1.3, 100)} label="Energy Used" unit="kWh" color="#00f0ff" />
            <RadialGauge value={convertEfficiency(avgEfficiency || (totalDistance > 0 ? (totalEnergy * 1000 / totalDistance) : 0))} max={convertEfficiency(300)} label="Efficiency" unit={efficiencyUnit} color="#10b981" />
            <RadialGauge value={co2Saved} max={Math.max(co2Saved * 1.5, 50)} label="CO₂ Saved" unit="kg" color="#a855f7" />
            <RadialGauge value={totalCost} max={Math.max(totalCost * 1.5, 50)} label="Total Cost" unit="$" color="#f59e0b" />
          </div>
        </GlassPanel>
      </FadeIn>

      {/* Quick metrics strip */}
      <StaggerContainer className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        {[
          { label: `Cost per ${distanceUnit}`, value: `$${fmtNumber(totalDistance > 0 ? totalCost / convertDistance(totalDistance) : 0)}`, color: 'text-neon-cyan' },
          { label: 'Cost per kWh', value: `$${fmtNumber(costPerKwh ?? 0)}`, color: 'text-neon-green' },
          { label: 'Total Distance', value: `${fmtInt(convertDistance(totalDistance ?? 0))} ${distanceUnit}`, color: 'text-[var(--text-primary)]' },
          { label: 'Sessions', value: `${sessions?.length ?? 0}`, color: 'text-neon-purple' },
          { label: 'Monthly Est.', value: `$${fmtNumber(monthlyProjectedCost ?? 0)}`, color: 'text-neon-amber' },
          { label: 'Yearly Est.', value: `$${fmtNumber(yearlyProjectedCost ?? 0)}`, color: 'text-neon-red' },
        ].map(m => (
          <StaggerItem key={m.label}>
            <GlassPanel className="p-3 text-center">
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">{m.label}</p>
              <p className={`text-lg font-bold ${m.color}`}>{m.value}</p>
            </GlassPanel>
          </StaggerItem>
        ))}
      </StaggerContainer>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2"><Skeleton className="h-56 sm:h-80" /><Skeleton className="h-56 sm:h-80" /></div>
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
              <ChartContainer title="Energy & Cost Daily" height="auto">
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
                        <Line yAxisId="right" type="monotone" dataKey="efficiency" name={efficiencyUnit} stroke="#10b981" strokeWidth={2} dot={false} animationDuration={800} />
                        {dailyEnergy.length > 14 && <Brush dataKey="date" height={20} stroke="#6b7280" fill="rgba(255,255,255,0.02)" travellerWidth={8} />}
                      </ComposedChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex items-center justify-center h-full text-[var(--text-muted)] text-sm">Connect vehicle to see energy data</div>
                  )}
                </div>
              </ChartContainer>
            </FadeIn>

            <FadeIn delay={0.15}>
              <ChartContainer title="Efficiency Trend" height="auto">
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
                        <Area type="monotone" dataKey="efficiency" name={efficiencyUnit} stroke="#10b981" fill="url(#effGrad)" strokeWidth={2} animationDuration={800} />
                        <Area type="monotone" dataKey="distance_km" name={`Distance (${distanceUnit})`} stroke="#00f0ff" fill="url(#distGrad2)" strokeWidth={1} strokeDasharray="4 4" animationDuration={800} />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex items-center justify-center h-full text-[var(--text-muted)] text-sm">No efficiency data yet</div>
                  )}
                </div>
              </ChartContainer>
            </FadeIn>
          </div>

          {/* Charts Row 2: Time of Day + Charger Breakdown */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {timeOfDayData.length > 0 && (
              <FadeIn delay={0.2}>
                <ChartContainer title="Charging by Time of Day" height="auto">
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
                </ChartContainer>
              </FadeIn>
            )}

            {chargerBreakdown.length > 0 && (
              <FadeIn delay={0.25}>
                <ChartContainer title="Charger Type Breakdown" height="auto">
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
                              <span className="text-[var(--text-secondary)]">{b.name}</span>
                            </span>
                            <span className="text-xs text-[var(--text-muted)]">{b.count} sessions</span>
                          </div>
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-neon-cyan">{fmtNumber(b.energy ?? 0)} kWh</span>
                            <span className="text-neon-green">${fmtNumber(b.cost ?? 0)}</span>
                            <span className="text-[var(--text-muted)]">${b.energy > 0 ? fmtNumber(b.cost / b.energy) : '0'}/kWh</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </ChartContainer>
              </FadeIn>
            )}
          </div>

          {/* Recent Charging Sessions (enhanced) */}
          {sessions && sessions.length === 0 && (
            <FadeIn delay={0.3}>
              <GlassPanel className="p-6">
                <h3 className="section-title mb-4 flex items-center gap-2">
                  <Zap className="h-4 w-4 text-neon-amber" /> Recent Charging Sessions
                </h3>
                <div className="text-center py-12 text-[var(--text-muted)]">
                  <p className="text-lg">No charging sessions recorded</p>
                  <p className="text-sm mt-1">Charging data will appear here once your vehicle completes a session.</p>
                </div>
              </GlassPanel>
            </FadeIn>
          )}
          {sessions && sessions.length > 0 && (
            <FadeIn delay={0.3}>
              <GlassPanel className="p-6">
                <h3 className="section-title mb-4 flex items-center gap-2">
                  <Zap className="h-4 w-4 text-neon-amber" /> Recent Charging Sessions
                </h3>
                <DataTable
                  columns={[
                    { key: 'date', header: 'Date', render: (s) => <Link to={`/charging/${s.id}`} className="hover:text-neon-cyan transition-colors">{formatDateShort(s.start_date)}</Link> },
                    { key: 'energy', header: 'Energy', render: (s) => <span className="text-neon-cyan font-medium">{fmtNumber(s.charge_energy_added ?? 0)} kWh</span> },
                    { key: 'battery', header: 'Battery', render: (s) => <><span className="text-[var(--text-muted)]">{s.start_battery_level}%</span><span className="text-gray-700 mx-1">→</span><span className="text-neon-green">{s.end_battery_level ?? '—'}%</span></> },
                    { key: 'power', header: 'Power', render: (s) => <>{s.charger_power != null ? `${fmtNumber(s.charger_power)} kW` : '—'}</> },
                    { key: 'type', header: 'Type', render: (s) => <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ring-1 ${s.fast_charger_type?.toLowerCase().includes('tesla') ? 'bg-neon-red/10 text-neon-red ring-neon-red/20' : s.fast_charger_type ? 'bg-neon-amber/10 text-neon-amber ring-neon-amber/20' : 'bg-neon-green/10 text-neon-green ring-neon-green/20'}`}>{s.fast_charger_type?.toLowerCase().includes('tesla') ? 'Supercharger' : s.fast_charger_type || 'AC'}</span> },
                    { key: 'cost', header: 'Cost', render: (s) => <>{typeof s.cost === 'number' ? `$${fmtNumber(s.cost)}` : '—'}</> },
                    { key: 'perKwh', header: '$/kWh', render: (s) => <span className="text-[var(--text-muted)]">{typeof s.cost === 'number' && s.charge_energy_added > 0 ? `$${fmtNumber(s.cost / s.charge_energy_added)}` : '—'}</span> },
                  ] satisfies Column<(typeof sessions)[number]>[]}
                  data={sessions.slice(0, 15)}
                  keyExtractor={(s) => s.id}
                />
              </GlassPanel>
            </FadeIn>
          )}
        </>
      )}
    </div>
  )
}
