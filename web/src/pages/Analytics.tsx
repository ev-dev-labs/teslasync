import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getFleetAnalytics } from '../api'
import { PageHeader, GlassPanel, FadeIn, TabNav, DateRangeFilter, Skeleton, EmptyState, MetricCard, ChartContainer } from '../components/ui'
import { RadialGauge, AnimatedNumber } from '../components/Widgets'
import {
  BarChart3, Award, Activity, DollarSign,
  Gauge, Battery,
  PlugZap, Wind
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, RadarChart, PolarGrid, PolarAngleAxis, Radar,
  ComposedChart, Line, AreaChart, Area, ScatterChart, Scatter, ZAxis,
  LineChart
} from 'recharts'
import clsx from 'clsx'
import { useSettings } from '../hooks/useSettings'
import { ChartTooltip, axisTick, axisTickSm, chartGrid, safe, fmt } from '../components/Charts'
import { CHART_COLORS } from '../lib/colors'
import { usePageTitle } from '../hooks/usePageTitle'

function MiniBar({ label, value, maxValue, color }: { label: string; value: number; maxValue: number; color: string }) {
  const pct = safe(maxValue) > 0 ? Math.min((safe(value) / safe(maxValue)) * 100, 100) : 0
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-16 text-right" style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, backgroundColor: color, boxShadow: `0 0 6px ${color}40` }} />
      </div>
      <span className="w-10 text-right font-mono" style={{ color: 'var(--text-primary)' }}>{value}</span>
    </div>
  )
}

function LeaderboardRow({ rank, name, value, unit, maxValue, color }: {
  rank: number; name: string; value: number; unit: string; maxValue: number; color: string
}) {
  const pct = safe(maxValue) > 0 ? (safe(value) / safe(maxValue)) * 100 : 0
  return (
    <div className="flex items-center gap-3 py-2">
      <span className={clsx(
        'flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold',
        rank === 1 ? 'bg-neon-amber/20 text-neon-amber' : rank === 2 ? 'bg-gray-500/20 text-[var(--text-secondary)]' : 'bg-white/5 text-[var(--text-muted)]'
      )}>
        {rank}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{name}</span>
          <span className="text-xs font-mono" style={{ color }}>{fmt(value)} {unit}</span>
        </div>
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
          <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, backgroundColor: color, boxShadow: `0 0 8px ${color}40` }} />
        </div>
      </div>
    </div>
  )
}

// Grid axis tick style — using shared theme-aware constants
const tick = axisTick
const tickSm = axisTickSm
const grid = chartGrid

export default function Analytics() {
  usePageTitle('Analytics')
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0])
  const [tab, setTab] = useState<'overview' | 'driving' | 'charging' | 'battery'>('overview')
  const { convertDistance, convertSpeed, convertTemp, convertEfficiency, distanceUnit, speedUnit, tempUnit, efficiencyUnit } = useSettings()

  const { data: analytics, isLoading } = useQuery({
    queryKey: ['fleet-analytics', startDate],
    queryFn: () => getFleetAnalytics(30, startDate),
  })

  const comparison = analytics?.vehicle_comparison ?? []
  const da = analytics?.drive_analytics
  const ca = analytics?.charging_analytics
  const bt = analytics?.battery_trend ?? []

  const totalDistance = safe(analytics?.total_distance_km)
  const totalEnergy = safe(analytics?.total_energy_kwh)
  const avgEfficiency = safe(analytics?.avg_efficiency_wh_km)
  const totalDrives = safe(analytics?.total_drives)
  const totalCost = safe(analytics?.total_cost)
  const co2Saved = totalDistance > 0 ? totalDistance * 0.12 : 0
  const gasSavings = totalDistance > 0 ? totalDistance * 0.085 * 1.5 - totalCost : 0

  const pieData = comparison.map((v, i) => ({
    name: v.name, value: convertDistance(safe(v.distance)), fill: CHART_COLORS[i % CHART_COLORS.length],
  }))
  const sortedByEfficiency = [...comparison].sort((a, b) => convertEfficiency(safe(a.efficiency)) - convertEfficiency(safe(b.efficiency)))

  const radarData = useMemo(() => {
    if (comparison.length < 2) return []
    const maxDist = Math.max(...comparison.map(v => safe(v.distance)), 1)
    const maxEnergy = Math.max(...comparison.map(v => safe(v.energy)), 1)
    const maxDrives = Math.max(...comparison.map(v => safe(v.drives)), 1)
    const maxEff = Math.max(...comparison.map(v => safe(v.efficiency)), 1)
    return ['Distance', 'Energy', 'Drives', 'Efficiency'].map(metric => {
      const row: Record<string, string | number> = { metric }
      comparison.forEach(v => {
        switch (metric) {
          case 'Distance': row[v.name] = (safe(v.distance) / maxDist) * 100; break
          case 'Energy': row[v.name] = (safe(v.energy) / maxEnergy) * 100; break
          case 'Drives': row[v.name] = (safe(v.drives) / maxDrives) * 100; break
          case 'Efficiency': row[v.name] = ((maxEff - safe(v.efficiency)) / maxEff) * 100; break
        }
      })
      return row
    })
  }, [comparison])

  const TABS = [
    { key: 'overview' as const, label: 'Overview' },
    { key: 'driving' as const, label: 'Driving' },
    { key: 'charging' as const, label: 'Charging' },
    { key: 'battery' as const, label: 'Battery' },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fleet Analytics"
        subtitle="Deep-dive into driving patterns, charging behavior, battery health, and fleet performance"
        actions={
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <TabNav tabs={TABS} active={tab} onChange={(key) => setTab(key as typeof tab)} />
            <DateRangeFilter
              startDate={startDate}
              endDate={endDate}
              onStartDateChange={setStartDate}
              onEndDateChange={setEndDate}
            />
          </div>
        }
      />

      {/* ===== HERO GAUGES (always visible) ===== */}
      <FadeIn>
        <GlassPanel className="p-4 sm:p-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 items-center">
            <RadialGauge value={Math.round(convertDistance(totalDistance))} max={Math.max(convertDistance(totalDistance), 1000)} label="Distance" unit={distanceUnit} color="#00f0ff" />
            <RadialGauge value={totalDrives} max={Math.max(totalDrives, 50)} label="Drives" unit="" color="#a855f7" />
            <RadialGauge value={Math.round(totalEnergy)} max={Math.max(totalEnergy, 500)} label="Energy" unit="kWh" color="#10b981" />
            <RadialGauge value={Math.round(convertEfficiency(avgEfficiency))} max={300} label="Efficiency" unit={efficiencyUnit} color={avgEfficiency < 180 ? '#10b981' : '#f59e0b'} />
            <div className="flex flex-col items-center text-center">
              <p className="text-xl font-bold text-neon-green">$<AnimatedNumber value={Math.round(gasSavings)} /></p>
              <p className="text-[10px] uppercase tracking-wider mt-1" style={{ color: 'var(--text-secondary)' }}>Gas Savings</p>
              <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>vs ICE vehicle</p>
            </div>
            <div className="flex flex-col items-center text-center">
              <p className="text-xl font-bold text-neon-green"><AnimatedNumber value={Math.round(co2Saved)} /> kg</p>
              <p className="text-[10px] uppercase tracking-wider mt-1" style={{ color: 'var(--text-secondary)' }}>CO2 Saved</p>
              <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>~ {Math.round(co2Saved / 22)} trees/year</p>
            </div>
          </div>
        </GlassPanel>
      </FadeIn>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2">
          {[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} className="h-56 sm:h-80" />)}
        </div>
      ) : comparison.length === 0 ? (
        <EmptyState icon={<BarChart3 className="h-8 w-8" />} title="No analytics data yet" description="Drive and charge your vehicles to see fleet analytics." />
      ) : (
        <>
          {/* ==================== OVERVIEW TAB ==================== */}
          {tab === 'overview' && (
            <>
              {/* Row 1: Distance bar + Usage pie */}
              <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2">
                <FadeIn delay={0.05}>
                  <ChartContainer title="Distance by Vehicle" height={256}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={comparison}>
                        {grid}<XAxis dataKey="name" tick={tick} /><YAxis tick={tick} />
                        <Tooltip content={<ChartTooltip />} />
                        <Bar dataKey="distance" name={`Distance (${distanceUnit})`} fill="#00f0ff" fillOpacity={0.7} radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </ChartContainer>
                </FadeIn>

                <FadeIn delay={0.1}>
                  <GlassPanel className="p-4 sm:p-6">
                    <h3 className="section-title mb-4 sm:mb-6 flex items-center gap-2">
                      <Activity className="h-4 w-4 text-neon-purple" /> Fleet Usage
                    </h3>
                    <div className="h-48 sm:h-56 lg:h-64 flex items-center justify-center">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={2} dataKey="value">
                            {pieData.map((e, i) => <Cell key={i} fill={e.fill} stroke="transparent" />)}
                          </Pie>
                          <Tooltip content={<ChartTooltip />} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex flex-wrap gap-3 mt-2 justify-center">
                      {pieData.map((d, i) => (
                        <div key={i} className="flex items-center gap-1.5 text-xs">
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: d.fill }} />
                          <span style={{ color: 'var(--text-secondary)' }}>{d.name}</span>
                        </div>
                      ))}
                    </div>
                  </GlassPanel>
                </FadeIn>
              </div>

              {/* Row 2: Radar + Leaderboard */}
              <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2">
                {radarData.length > 0 && (
                  <FadeIn delay={0.15}>
                    <ChartContainer title="Vehicle Comparison" height={288}>
                      <ResponsiveContainer width="100%" height="100%">
                        <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="70%">
                          <PolarGrid stroke="rgba(255,255,255,0.06)" />
                          <PolarAngleAxis dataKey="metric" tick={{ fill: '#9ca3af', fontSize: 11 }} />
                          {comparison.map((v, i) => (
                            <Radar key={v.id} name={v.name} dataKey={v.name} stroke={CHART_COLORS[i % CHART_COLORS.length]}
                              fill={CHART_COLORS[i % CHART_COLORS.length]} fillOpacity={0.15} strokeWidth={2} />
                          ))}
                          <Tooltip content={<ChartTooltip />} />
                        </RadarChart>
                      </ResponsiveContainer>
                    </ChartContainer>
                  </FadeIn>
                )}
                <FadeIn delay={0.2}>
                  <GlassPanel className="p-4 sm:p-6">
                    <h3 className="section-title mb-4 sm:mb-6 flex items-center gap-2">
                      <Award className="h-4 w-4 text-neon-amber" /> Efficiency Leaderboard
                      <span className="text-xs font-normal ml-2" style={{ color: 'var(--text-tertiary)' }}>(Lower = better)</span>
                    </h3>
                    <div className="max-w-2xl space-y-1">
                      {sortedByEfficiency.map((v, i) => (
                        <LeaderboardRow key={v.id} rank={i + 1} name={v.name} value={convertEfficiency(safe(v.efficiency))} unit={efficiencyUnit}
                          maxValue={Math.max(...sortedByEfficiency.map(x => convertEfficiency(safe(x.efficiency))), 1)} color={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </div>
                  </GlassPanel>
                </FadeIn>
              </div>

              {/* Row 3: Energy comparison + Day of Week */}
              <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2">
                <FadeIn delay={0.25}>
                  <ChartContainer title="Energy & Activity" height={256}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={comparison}>
                        {grid}<XAxis dataKey="name" tick={tick} /><YAxis tick={tick} />
                        <Tooltip content={<ChartTooltip />} />
                        <Bar dataKey="energy" name="Energy (kWh)" fill="#10b981" fillOpacity={0.7} radius={[4, 4, 0, 0]} />
                        <Bar dataKey="drives" name="Drives" fill="#a855f7" fillOpacity={0.7} radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </ChartContainer>
                </FadeIn>

                {da && da.day_of_week?.length > 0 && (
                  <FadeIn delay={0.3}>
                    <ChartContainer title="Day of Week Pattern" height={256}>
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={da.day_of_week}>
                          {grid}<XAxis dataKey="day" tick={tick} />
                          <YAxis yAxisId="left" tick={tickSm} />
                          <YAxis yAxisId="right" orientation="right" tick={tickSm} />
                          <Tooltip content={<ChartTooltip />} />
                          <Bar yAxisId="left" dataKey="drives" name="Drives" fill="#00f0ff" fillOpacity={0.5} radius={[4, 4, 0, 0]} />
                          <Line yAxisId="right" type="monotone" dataKey="avg_distance" name={`Avg ${distanceUnit}`} stroke="#10b981" strokeWidth={2} dot={{ fill: '#10b981', r: 3 }} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </ChartContainer>
                  </FadeIn>
                )}
              </div>

              {/* Row 4: Monthly cost EV vs Gas */}
              {ca && ca.monthly_trend?.length > 0 && (
                <FadeIn delay={0.35}>
                  <ChartContainer title="Monthly Cost: EV vs Gas" height={256}>
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={ca.monthly_trend}>
                        {grid}<XAxis dataKey="month" tick={tickSm} /><YAxis tick={tickSm} />
                        <Tooltip content={<ChartTooltip />} />
                        <Bar dataKey="cost" name="EV Cost ($)" fill="#10b981" fillOpacity={0.6} radius={[4, 4, 0, 0]} />
                        <Bar dataKey="gas_cost" name="Gas Equiv ($)" fill="#ef4444" fillOpacity={0.3} radius={[4, 4, 0, 0]} />
                        <Line type="monotone" dataKey="savings" name="Savings ($)" stroke="#f59e0b" strokeWidth={2} dot={{ fill: '#f59e0b', r: 3 }} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </ChartContainer>
                </FadeIn>
              )}
            </>
          )}

          {/* ==================== DRIVING TAB ==================== */}
          {tab === 'driving' && da && (
            <>
              {/* Stats overview cards */}
              <FadeIn delay={0.05}>
                <GlassPanel className="p-4 sm:p-6">
                  <h3 className="section-title mb-4 flex items-center gap-2">
                    <Gauge className="h-4 w-4 text-neon-cyan" /> Performance Summary
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                    <MetricCard label="Top Speed" value={`${fmt(convertSpeed(safe(da.speed_stats?.max)), 0)} ${speedUnit}`} color="red" />
                    <MetricCard label="Avg Speed" value={`${fmt(convertSpeed(safe(da.speed_stats?.avg)), 0)} ${speedUnit}`} color="cyan" />
                    <MetricCard label="Peak Power" value={`${fmt(da.power_stats?.max, 0)} kW`} color="purple" subtitle={`Regen: ${fmt(da.regen_stats?.min, 0)} kW`} />
                    <MetricCard label="Avg Drive" value={`${fmt(convertDistance(safe(da.distance_stats?.avg)))} ${distanceUnit}`} color="green" subtitle={`${fmt(da.duration_stats?.avg, 0)} min avg`} />
                    <MetricCard label="Longest" value={`${fmt(convertDistance(safe(da.distance_stats?.max)))} ${distanceUnit}`} color="amber" subtitle={`${fmt(da.duration_stats?.max, 0)} min max`} />
                    <MetricCard label="Efficiency" value={`${fmt(da.efficiency_stats?.avg)}%`} color="green" subtitle={`P95: ${fmt(da.efficiency_stats?.p95)}%`} />
                  </div>
                </GlassPanel>
              </FadeIn>

              {/* Row: Speed dist + Distance dist */}
              <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2">
                {da.speed_distribution?.length > 0 && (
                  <FadeIn delay={0.1}>
                    <ChartContainer title={`Speed Distribution (${speedUnit})`} height={224}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={da.speed_distribution}>
                          {grid}<XAxis dataKey="range" tick={tick} /><YAxis tick={tick} />
                          <Tooltip content={<ChartTooltip />} />
                          <Bar dataKey="count" name="Drives" fill="#ef4444" fillOpacity={0.7} radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </ChartContainer>
                  </FadeIn>
                )}

                {da.distance_distribution?.length > 0 && (
                  <FadeIn delay={0.15}>
                    <ChartContainer title={`Trip Distance Distribution (${distanceUnit})`} height={224}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={da.distance_distribution}>
                          {grid}<XAxis dataKey="range" tick={tick} /><YAxis tick={tick} />
                          <Tooltip content={<ChartTooltip />} />
                          <Bar dataKey="count" name="Trips" fill="#00f0ff" fillOpacity={0.7} radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </ChartContainer>
                  </FadeIn>
                )}
              </div>

              {/* Row: Hourly driving heatmap + Temp vs Efficiency scatter */}
              <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2">
                {da.hourly_pattern?.length > 0 && (
                  <FadeIn delay={0.2}>
                    <ChartContainer title="Driving by Hour of Day" height={224}>
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={da.hourly_pattern}>
                          {grid}
                          <XAxis dataKey="hour" tick={tickSm} tickFormatter={(h: number) => `${h}:00`} />
                          <YAxis yAxisId="left" tick={tickSm} />
                          <YAxis yAxisId="right" orientation="right" tick={tickSm} />
                          <Tooltip content={<ChartTooltip />} />
                          <Bar yAxisId="left" dataKey="drives" name="Drives" fill="#a855f7" fillOpacity={0.5} radius={[3, 3, 0, 0]} />
                          <Line yAxisId="right" type="monotone" dataKey="distance" name={`Distance (${distanceUnit})`} stroke="#00f0ff" strokeWidth={2} dot={false} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </ChartContainer>
                  </FadeIn>
                )}

                {da.temp_vs_efficiency?.length > 0 && (
                  <FadeIn delay={0.25}>
                    <ChartContainer title="Temperature vs Efficiency" height={224}>
                      <ResponsiveContainer width="100%" height="100%">
                        <ScatterChart>
                          {grid}
                          <XAxis type="number" dataKey="temp" name="Temp" unit={tempUnit} tick={tickSm} />
                          <YAxis type="number" dataKey="efficiency" name="Efficiency" unit="%" tick={tickSm} />
                          <ZAxis type="number" dataKey="distance" range={[20, 200]} />
                          <Tooltip
                            content={({ active, payload }) => {
                              if (!active || !payload?.length) return null
                              const d = payload[0].payload as { temp: number; efficiency: number; distance: number }
                              return (
                                <div className="glass-panel p-3 text-xs" style={{ background: 'var(--surface-2)', borderColor: 'var(--glass-border)' }}>
                                  <p style={{ color: 'var(--text-primary)' }}>{fmt(convertTemp(d.temp))}{tempUnit} | {d.efficiency}% eff | {fmt(convertDistance(d.distance))} {distanceUnit}</p>
                                </div>
                              )
                            }}
                          />
                          <Scatter data={da.temp_vs_efficiency} fill="#f59e0b" fillOpacity={0.6} />
                        </ScatterChart>
                      </ResponsiveContainer>
                    </ChartContainer>
                  </FadeIn>
                )}
              </div>

              {/* Row: Daily driving trend + Drive duration distribution */}
              <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2">
                {da.daily_trend?.length > 0 && (
                  <FadeIn delay={0.3}>
                    <ChartContainer title="Daily Driving Trend" height={224}>
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={da.daily_trend}>
                          {grid}
                          <XAxis dataKey="date" tick={tickSm} tickFormatter={(d: string) => d.slice(5)} />
                          <YAxis yAxisId="left" tick={tickSm} />
                          <YAxis yAxisId="right" orientation="right" tick={tickSm} />
                          <Tooltip content={<ChartTooltip />} />
                          <Area yAxisId="left" type="monotone" dataKey="distance" name={`Distance (${distanceUnit})`} stroke="#10b981" fill="#10b981" fillOpacity={0.15} strokeWidth={2} />
                          <Line yAxisId="right" type="monotone" dataKey="drives" name="Drives" stroke="#a855f7" strokeWidth={2} dot={false} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </ChartContainer>
                  </FadeIn>
                )}

                {/* Drive Duration Distribution */}
                {da.duration_distribution && da.duration_distribution.length > 0 && (
                  <FadeIn delay={0.32}>
                    <ChartContainer title="Drive Duration Distribution" height={224}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={da.duration_distribution}>
                          {grid}<XAxis dataKey="range" tick={tick} /><YAxis tick={tick} />
                          <Tooltip content={<ChartTooltip />} />
                          <Bar dataKey="count" name="Drives" fill="#f59e0b" fillOpacity={0.7} radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </ChartContainer>
                  </FadeIn>
                )}
              </div>

              {/* Efficiency trend over time */}
              {da.daily_trend?.length > 0 && (
                <FadeIn delay={0.35}>
                  <ChartContainer title={`Efficiency Trend (${efficiencyUnit})`} height={224}>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={da.daily_trend.filter((d: Record<string, unknown>) => d.efficiency != null && (d.efficiency as number) > 0)}>
                        {grid}
                        <XAxis dataKey="date" tick={tickSm} tickFormatter={(d: string) => d.slice(5)} />
                        <YAxis tick={tickSm} />
                        <Tooltip content={<ChartTooltip />} />
                        <Area type="monotone" dataKey="efficiency" name={`Efficiency (${efficiencyUnit})`} stroke="#10b981" fill="#10b981" fillOpacity={0.1} strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </ChartContainer>
                </FadeIn>
              )}

              {/* Temperature stats */}
              {(da.temperature?.inside?.count > 0 || da.temperature?.outside?.count > 0) && (
                <FadeIn delay={0.35}>
                  <GlassPanel className="p-4 sm:p-6">
                    <h3 className="section-title mb-4 flex items-center gap-2">
                      <Wind className="h-4 w-4 text-neon-cyan" /> Temperature Conditions
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                      {da.temperature?.outside?.count > 0 && (
                        <div>
                          <p className="text-xs uppercase tracking-wider mb-3" style={{ color: 'var(--text-secondary)' }}>Outside Temperature</p>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                            <MetricCard label="Min" value={`${fmt(convertTemp(da.temperature.outside.min))}${tempUnit}`} color="cyan" />
                            <MetricCard label="Avg" value={`${fmt(convertTemp(da.temperature.outside.avg))}${tempUnit}`} color="green" />
                            <MetricCard label="Max" value={`${fmt(convertTemp(da.temperature.outside.max))}${tempUnit}`} color="red" />
                          </div>
                        </div>
                      )}
                      {da.temperature?.inside?.count > 0 && (
                        <div>
                          <p className="text-xs uppercase tracking-wider mb-3" style={{ color: 'var(--text-secondary)' }}>Inside Temperature</p>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                            <MetricCard label="Min" value={`${fmt(convertTemp(da.temperature.inside.min))}${tempUnit}`} color="cyan" />
                            <MetricCard label="Avg" value={`${fmt(convertTemp(da.temperature.inside.avg))}${tempUnit}`} color="green" />
                            <MetricCard label="Max" value={`${fmt(convertTemp(da.temperature.inside.max))}${tempUnit}`} color="red" />
                          </div>
                        </div>
                      )}
                    </div>
                  </GlassPanel>
                </FadeIn>
              )}
            </>
          )}

          {/* ==================== CHARGING TAB ==================== */}
          {tab === 'charging' && ca && (
            <>
              {/* Charging stats cards */}
              <FadeIn delay={0.05}>
                <GlassPanel className="p-4 sm:p-6">
                  <h3 className="section-title mb-4 flex items-center gap-2">
                    <PlugZap className="h-4 w-4 text-neon-green" /> Charging Summary
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                    <MetricCard label="Sessions" value={safe(analytics?.total_charging_sessions)} color="purple" />
                    <MetricCard label="Total Energy" value={`${fmt(analytics?.total_energy_kwh)} kWh`} color="green" />
                    <MetricCard label="Total Cost" value={`$${fmt(analytics?.total_cost, 2)}`} color="amber" />
                    <MetricCard label="Avg Power" value={`${fmt(ca.power_stats?.avg)} kW`} color="cyan" subtitle={`Peak: ${fmt(ca.power_stats?.max)} kW`} />
                    <MetricCard label="Avg Duration" value={`${fmt(ca.duration_stats?.avg, 0)} min`} color="red" subtitle={`Longest: ${fmt(ca.duration_stats?.max, 0)} min`} />
                    <MetricCard label="Charge Eff" value={`${fmt(ca.efficiency_stats?.avg)}%`} color="green" subtitle={`${fmt(ca.energy_stats?.avg)} kWh avg`} />
                  </div>
                </GlassPanel>
              </FadeIn>

              {/* Row: Charger type donut + Start battery distribution */}
              <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2">
                {ca.charger_types?.length > 0 && (
                  <FadeIn delay={0.1}>
                    <GlassPanel className="p-4 sm:p-6">
                      <h3 className="section-title mb-4 sm:mb-6 flex items-center gap-2">
                        <PlugZap className="h-4 w-4 text-neon-cyan" /> Charger Types
                      </h3>
                      <div className="h-40 sm:h-48 lg:h-56 flex items-center justify-center">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={ca.charger_types.map((t, i) => ({ ...t, name: t.type, value: t.count, fill: CHART_COLORS[i % CHART_COLORS.length] }))}
                              cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={2} dataKey="value">
                              {ca.charger_types.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} stroke="transparent" />)}
                            </Pie>
                            <Tooltip content={<ChartTooltip />} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="flex flex-wrap gap-3 mt-2 justify-center">
                        {ca.charger_types.map((t, i) => (
                          <div key={i} className="flex items-center gap-1.5 text-xs">
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                            <span style={{ color: 'var(--text-secondary)' }}>{t.type}: {t.count}</span>
                          </div>
                        ))}
                      </div>
                    </GlassPanel>
                  </FadeIn>
                )}

                {ca.start_battery_dist?.length > 0 && (
                  <FadeIn delay={0.15}>
                    <ChartContainer title="Charge Start Battery Level" height={224}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={ca.start_battery_dist}>
                          {grid}<XAxis dataKey="range" tick={tickSm} /><YAxis tick={tickSm} />
                          <Tooltip content={<ChartTooltip />} />
                          <Bar dataKey="count" name="Sessions" fill="#f59e0b" fillOpacity={0.7} radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </ChartContainer>
                  </FadeIn>
                )}
              </div>

              {/* Row: Hourly charging + Charger brands */}
              <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2">
                {ca.hourly_pattern?.length > 0 && (
                  <FadeIn delay={0.2}>
                    <ChartContainer title="Charging by Hour of Day" height={224}>
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={ca.hourly_pattern}>
                          {grid}
                          <XAxis dataKey="hour" tick={tickSm} tickFormatter={(h: number) => `${h}:00`} />
                          <YAxis yAxisId="left" tick={tickSm} />
                          <YAxis yAxisId="right" orientation="right" tick={tickSm} />
                          <Tooltip content={<ChartTooltip />} />
                          <Bar yAxisId="left" dataKey="charges" name="Sessions" fill="#a855f7" fillOpacity={0.5} radius={[3, 3, 0, 0]} />
                          <Line yAxisId="right" type="monotone" dataKey="energy" name="Energy (kWh)" stroke="#10b981" strokeWidth={2} dot={false} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </ChartContainer>
                  </FadeIn>
                )}

                {ca.charger_brands?.length > 0 && (
                  <FadeIn delay={0.25}>
                    <GlassPanel className="p-4 sm:p-6">
                      <h3 className="section-title mb-4 sm:mb-6 flex items-center gap-2">
                        <PlugZap className="h-4 w-4 text-neon-green" /> Charger Brands
                      </h3>
                      <div className="space-y-2 mt-4">
                        {ca.charger_brands.map((b, i) => (
                          <MiniBar key={i} label={b.brand} value={b.count}
                            maxValue={Math.max(...ca.charger_brands.map(x => x.count))}
                            color={CHART_COLORS[i % CHART_COLORS.length]} />
                        ))}
                      </div>
                    </GlassPanel>
                  </FadeIn>
                )}
              </div>

              {/* Row: Monthly charging trend */}
              {ca.monthly_trend?.length > 0 && (
                <FadeIn delay={0.3}>
                  <ChartContainer title="Monthly Charging Trend" height={256}>
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={ca.monthly_trend}>
                        {grid}<XAxis dataKey="month" tick={tickSm} /><YAxis tick={tickSm} />
                        <Tooltip content={<ChartTooltip />} />
                        <Area type="monotone" dataKey="energy" name="Energy (kWh)" stroke="#10b981" fill="#10b981" fillOpacity={0.1} strokeWidth={2} />
                        <Line type="monotone" dataKey="avg_power" name="Avg Power (kW)" stroke="#00f0ff" strokeWidth={2} dot={{ fill: '#00f0ff', r: 3 }} />
                        <Bar dataKey="sessions" name="Sessions" fill="#a855f7" fillOpacity={0.3} radius={[3, 3, 0, 0]} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </ChartContainer>
                </FadeIn>
              )}

              {/* Cost analysis row */}
              {ca.cost_stats?.count > 0 && (
                <FadeIn delay={0.35}>
                  <GlassPanel className="p-4 sm:p-6">
                    <h3 className="section-title mb-4 flex items-center gap-2">
                      <DollarSign className="h-4 w-4 text-neon-amber" /> Cost Analysis
                    </h3>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <MetricCard label="Avg / Session" value={`$${fmt(ca.cost_stats.avg, 2)}`} color="amber" />
                      <MetricCard label="Median" value={`$${fmt(ca.cost_stats.median, 2)}`} color="green" />
                      <MetricCard label="Max" value={`$${fmt(ca.cost_stats.max, 2)}`} color="red" />
                      <MetricCard label="$/kWh avg" value={`$${ca.energy_stats?.avg > 0 ? fmt(ca.cost_stats.avg / ca.energy_stats.avg, 3) : '0.0'}`} color="cyan" />
                    </div>
                  </GlassPanel>
                </FadeIn>
              )}

              {/* Charging cost breakdown by type */}
              {ca.charger_types?.length > 0 && ca.cost_stats?.count > 0 && (
                <FadeIn delay={0.4}>
                  <GlassPanel className="p-4 sm:p-6">
                    <h3 className="section-title mb-4 flex items-center gap-2">
                      <DollarSign className="h-4 w-4 text-neon-green" /> Cost by Charger Type
                    </h3>
                    <div className="space-y-3">
                      {ca.charger_types.map((t, i) => {
                        const totalSessions = ca.charger_types.reduce((s, x) => s + x.count, 0)
                        const pct = totalSessions > 0 ? Math.round((t.count / totalSessions) * 100) : 0
                        return (
                          <div key={i} className="flex items-center gap-3">
                            <span className="w-28 text-xs text-right font-medium" style={{ color: 'var(--text-secondary)' }}>{t.type}</span>
                            <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
                              <div className="h-full rounded-full transition-all duration-700" style={{
                                width: `${pct}%`,
                                backgroundColor: CHART_COLORS[i % CHART_COLORS.length],
                                boxShadow: `0 0 8px ${CHART_COLORS[i % CHART_COLORS.length]}40`,
                              }} />
                            </div>
                            <span className="w-20 text-xs font-mono text-right" style={{ color: 'var(--text-primary)' }}>{t.count} ({pct}%)</span>
                          </div>
                        )
                      })}
                    </div>
                  </GlassPanel>
                </FadeIn>
              )}

              {/* SOC at charge start distribution */}
              {ca.start_battery_dist?.length > 0 && (
                <FadeIn delay={0.42}>
                  <GlassPanel className="p-4 sm:p-6">
                    <h3 className="section-title mb-4 sm:mb-6 flex items-center gap-2">
                      <Battery className="h-4 w-4 text-neon-cyan" /> SOC Distribution at Charge Start
                    </h3>
                    <div className="h-40 sm:h-48 lg:h-56">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={ca.start_battery_dist}>
                          {grid}<XAxis dataKey="range" tick={tickSm} label={{ value: 'Battery %', fill: 'var(--text-muted)', fontSize: 10, position: 'insideBottom', offset: -5 }} /><YAxis tick={tickSm} />
                          <Tooltip content={<ChartTooltip />} />
                          <Bar dataKey="count" name="Sessions" fill="#06b6d4" fillOpacity={0.7} radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <p className="text-center text-[10px] mt-2" style={{ color: 'var(--text-tertiary)' }}>
                      What battery level do you typically start charging at?
                    </p>
                  </GlassPanel>
                </FadeIn>
              )}
            </>
          )}

          {/* ==================== BATTERY TAB ==================== */}
          {tab === 'battery' && (
            <>
              {bt.length > 0 ? (
                <>
                  {/* Battery health overview cards  */}
                  <FadeIn delay={0.05}>
                    <GlassPanel className="p-4 sm:p-6">
                      <h3 className="section-title mb-4 flex items-center gap-2">
                        <Battery className="h-4 w-4 text-neon-green" /> Battery Health Overview
                      </h3>
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                        <MetricCard label="Health Score" value={`${fmt(bt[bt.length - 1]?.health_score, 0)}%`} color={bt[bt.length - 1]?.health_score > 90 ? 'green' : 'amber'} />
                        <MetricCard label="Capacity" value={`${fmt(bt[bt.length - 1]?.capacity_kwh)} kWh`} color="cyan" />
                        <MetricCard label="Degradation" value={`${fmt(bt[bt.length - 1]?.degradation_pct)}%`} color={bt[bt.length - 1]?.degradation_pct < 5 ? 'green' : 'red'} />
                        <MetricCard label="Est Range" value={`${fmt(convertDistance(safe(bt[bt.length - 1]?.range_km)), 0)} ${distanceUnit}`} color="purple" />
                        <MetricCard label="Cycles" value={bt[bt.length - 1]?.cycle_count ?? 0} color="amber" />
                      </div>
                    </GlassPanel>
                  </FadeIn>

                  {/* Health score timeline */}
                  <FadeIn delay={0.1}>
                    <ChartContainer title="Health Score Over Time" height={256}>
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={bt}>
                          {grid}
                          <XAxis dataKey="date" tick={tickSm} tickFormatter={(d: string) => d.slice(5)} />
                          <YAxis domain={[80, 100]} tick={tickSm} />
                          <Tooltip content={<ChartTooltip />} />
                          <Area type="monotone" dataKey="health_score" name="Health %" stroke="#10b981" fill="#10b981" fillOpacity={0.15} strokeWidth={2} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </ChartContainer>
                  </FadeIn>

                  {/* Capacity + Range trend */}
                  <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2">
                    <FadeIn delay={0.15}>
                      <ChartContainer title="Capacity Trend" height={224}>
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={bt}>
                            {grid}
                            <XAxis dataKey="date" tick={tickSm} tickFormatter={(d: string) => d.slice(5)} />
                            <YAxis tick={tickSm} />
                            <Tooltip content={<ChartTooltip />} />
                            <Line type="monotone" dataKey="capacity_kwh" name="Capacity (kWh)" stroke="#00f0ff" strokeWidth={2} dot={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      </ChartContainer>
                    </FadeIn>

                    <FadeIn delay={0.2}>
                      <ChartContainer title="Estimated Range Trend" height={224}>
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={bt}>
                            {grid}
                            <XAxis dataKey="date" tick={tickSm} tickFormatter={(d: string) => d.slice(5)} />
                            <YAxis tick={tickSm} />
                            <Tooltip content={<ChartTooltip />} />
                            <Line type="monotone" dataKey="range_km" name={`Range (${distanceUnit})`} stroke="#a855f7" strokeWidth={2} dot={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      </ChartContainer>
                    </FadeIn>
                  </div>

                  {/* Degradation + Cycles */}
                  <FadeIn delay={0.25}>
                    <ChartContainer title="Degradation & Cycles" height={224}>
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={bt}>
                          {grid}
                          <XAxis dataKey="date" tick={tickSm} tickFormatter={(d: string) => d.slice(5)} />
                          <YAxis yAxisId="left" tick={tickSm} />
                          <YAxis yAxisId="right" orientation="right" tick={tickSm} />
                          <Tooltip content={<ChartTooltip />} />
                          <Area yAxisId="left" type="monotone" dataKey="degradation_pct" name="Degradation %" stroke="#ef4444" fill="#ef4444" fillOpacity={0.1} strokeWidth={2} />
                          <Line yAxisId="right" type="monotone" dataKey="cycle_count" name="Cycles" stroke="#f59e0b" strokeWidth={2} dot={false} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </ChartContainer>
                  </FadeIn>
                </>
              ) : (
                <EmptyState icon={<Battery className="h-8 w-8" />} title="No battery data yet" description="Battery health snapshots will appear here as your vehicle reports data over time." />
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
