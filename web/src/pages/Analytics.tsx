import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getFleetAnalytics } from '../api'
import { PageHeader, GlassPanel, FadeIn, TabNav, DateRangeFilter, Skeleton, EmptyState } from '../components/ui'
import { RadialGauge, AnimatedNumber } from '../components/Widgets'
import {
  BarChart3, Car, Zap, Award, Activity, DollarSign, Calendar,
  Gauge, Thermometer, Battery, Clock, TrendingUp, TrendingDown,
  PlugZap, MapPin, Timer, Wind
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, RadarChart, PolarGrid, PolarAngleAxis, Radar,
  ComposedChart, Line, AreaChart, Area, ScatterChart, Scatter, ZAxis,
  LineChart
} from 'recharts'
import clsx from 'clsx'
import { ChartTooltip, NEON_COLORS, axisTick, axisTickSm, chartGrid, safe, fmt } from '../components/Charts'

function StatCard({ label, value, unit, sub, color = 'var(--text-primary)' }: {
  label: string; value: string | number; unit?: string; sub?: string; color?: string
}) {
  return (
    <div className="text-center p-3 rounded-lg" style={{ background: 'var(--surface-2)' }}>
      <p className="text-lg font-bold font-mono" style={{ color }}>{value}{unit && <span className="text-xs ml-0.5 opacity-60">{unit}</span>}</p>
      <p className="text-[10px] uppercase tracking-wider mt-0.5" style={{ color: 'var(--text-secondary)' }}>{label}</p>
      {sub && <p className="text-[9px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{sub}</p>}
    </div>
  )
}

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
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0])
  const [tab, setTab] = useState<'overview' | 'driving' | 'charging' | 'battery'>('overview')

  const { data: analytics, isLoading } = useQuery({
    queryKey: ['fleet-analytics', startDate],
    queryFn: () => getFleetAnalytics(30, startDate),
  })

  const comparison = useMemo(() => analytics?.vehicle_comparison ?? [], [analytics])
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
    name: v.name, value: safe(v.distance), fill: NEON_COLORS[i % NEON_COLORS.length],
  }))
  const sortedByEfficiency = [...comparison].sort((a, b) => safe(a.efficiency) - safe(b.efficiency))

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
            <RadialGauge value={Math.round(totalDistance)} max={Math.max(totalDistance, 1000)} label="Distance" unit="km" color="#00f0ff" />
            <RadialGauge value={totalDrives} max={Math.max(totalDrives, 50)} label="Drives" unit="" color="#a855f7" />
            <RadialGauge value={Math.round(totalEnergy)} max={Math.max(totalEnergy, 500)} label="Energy" unit="kWh" color="#10b981" />
            <RadialGauge value={Math.round(avgEfficiency)} max={300} label="Efficiency" unit="Wh/km" color={avgEfficiency < 180 ? '#10b981' : '#f59e0b'} />
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
          {[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} className="h-80" />)}
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
                  <GlassPanel className="p-4 sm:p-6">
                    <h3 className="section-title mb-4 sm:mb-6 flex items-center gap-2">
                      <BarChart3 className="h-4 w-4 text-neon-cyan" /> Distance by Vehicle
                    </h3>
                    <div className="h-48 sm:h-56 lg:h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={comparison}>
                          {grid}<XAxis dataKey="name" tick={tick} /><YAxis tick={tick} />
                          <Tooltip content={<ChartTooltip />} />
                          <Bar dataKey="distance" name="Distance (km)" fill="#00f0ff" fillOpacity={0.7} radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </GlassPanel>
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
                    <GlassPanel className="p-4 sm:p-6">
                      <h3 className="section-title mb-4 sm:mb-6 flex items-center gap-2">
                        <Car className="h-4 w-4 text-neon-amber" /> Vehicle Comparison
                      </h3>
                      <div className="h-48 sm:h-64 lg:h-72 flex justify-center">
                        <ResponsiveContainer width="100%" height="100%">
                          <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="70%">
                            <PolarGrid stroke="rgba(255,255,255,0.06)" />
                            <PolarAngleAxis dataKey="metric" tick={{ fill: '#9ca3af', fontSize: 11 }} />
                            {comparison.map((v, i) => (
                              <Radar key={v.id} name={v.name} dataKey={v.name} stroke={NEON_COLORS[i % NEON_COLORS.length]}
                                fill={NEON_COLORS[i % NEON_COLORS.length]} fillOpacity={0.15} strokeWidth={2} />
                            ))}
                            <Tooltip content={<ChartTooltip />} />
                          </RadarChart>
                        </ResponsiveContainer>
                      </div>
                    </GlassPanel>
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
                        <LeaderboardRow key={v.id} rank={i + 1} name={v.name} value={safe(v.efficiency)} unit="Wh/km"
                          maxValue={Math.max(...sortedByEfficiency.map(x => safe(x.efficiency)), 1)} color={NEON_COLORS[i % NEON_COLORS.length]} />
                      ))}
                    </div>
                  </GlassPanel>
                </FadeIn>
              </div>

              {/* Row 3: Energy comparison + Day of Week */}
              <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2">
                <FadeIn delay={0.25}>
                  <GlassPanel className="p-4 sm:p-6">
                    <h3 className="section-title mb-4 sm:mb-6 flex items-center gap-2">
                      <Zap className="h-4 w-4 text-neon-green" /> Energy & Activity
                    </h3>
                    <div className="h-48 sm:h-56 lg:h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={comparison}>
                          {grid}<XAxis dataKey="name" tick={tick} /><YAxis tick={tick} />
                          <Tooltip content={<ChartTooltip />} />
                          <Bar dataKey="energy" name="Energy (kWh)" fill="#10b981" fillOpacity={0.7} radius={[4, 4, 0, 0]} />
                          <Bar dataKey="drives" name="Drives" fill="#a855f7" fillOpacity={0.7} radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </GlassPanel>
                </FadeIn>

                {da && da.day_of_week?.length > 0 && (
                  <FadeIn delay={0.3}>
                    <GlassPanel className="p-4 sm:p-6">
                      <h3 className="section-title mb-4 sm:mb-6 flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-neon-cyan" /> Day of Week Pattern
                      </h3>
                      <div className="h-48 sm:h-56 lg:h-64">
                        <ResponsiveContainer width="100%" height="100%">
                          <ComposedChart data={da.day_of_week}>
                            {grid}<XAxis dataKey="day" tick={tick} />
                            <YAxis yAxisId="left" tick={tickSm} />
                            <YAxis yAxisId="right" orientation="right" tick={tickSm} />
                            <Tooltip content={<ChartTooltip />} />
                            <Bar yAxisId="left" dataKey="drives" name="Drives" fill="#00f0ff" fillOpacity={0.5} radius={[4, 4, 0, 0]} />
                            <Line yAxisId="right" type="monotone" dataKey="avg_distance" name="Avg km" stroke="#10b981" strokeWidth={2} dot={{ fill: '#10b981', r: 3 }} />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </div>
                    </GlassPanel>
                  </FadeIn>
                )}
              </div>

              {/* Row 4: Monthly cost EV vs Gas */}
              {ca && ca.monthly_trend?.length > 0 && (
                <FadeIn delay={0.35}>
                  <GlassPanel className="p-4 sm:p-6">
                    <h3 className="section-title mb-4 sm:mb-6 flex items-center gap-2">
                      <DollarSign className="h-4 w-4 text-neon-green" /> Monthly Cost: EV vs Gas
                    </h3>
                    <div className="h-48 sm:h-56 lg:h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={ca.monthly_trend}>
                          {grid}<XAxis dataKey="month" tick={tickSm} /><YAxis tick={tickSm} />
                          <Tooltip content={<ChartTooltip />} />
                          <Bar dataKey="cost" name="EV Cost ($)" fill="#10b981" fillOpacity={0.6} radius={[4, 4, 0, 0]} />
                          <Bar dataKey="gas_cost" name="Gas Equiv ($)" fill="#ef4444" fillOpacity={0.3} radius={[4, 4, 0, 0]} />
                          <Line type="monotone" dataKey="savings" name="Savings ($)" stroke="#f59e0b" strokeWidth={2} dot={{ fill: '#f59e0b', r: 3 }} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </GlassPanel>
                </FadeIn>
              )}

              {/* Fleet Cost Report */}
              <FadeIn delay={0.35}>
                <GlassPanel className="p-4 sm:p-6">
                  <h3 className="section-title mb-4 flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-neon-amber" /> Fleet Cost Report
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                    <div className="p-3 rounded-lg bg-white/[0.02] border border-white/5 text-center">
                      <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1">Total Fleet Cost</p>
                      <p className="text-xl font-bold text-neon-green">${totalCost.toFixed(2)}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-white/[0.02] border border-white/5 text-center">
                      <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1">Cost per Vehicle</p>
                      <p className="text-xl font-bold text-[var(--text-primary)]">${comparison.length > 0 ? (totalCost / comparison.length).toFixed(2) : '0.00'}</p>
                    </div>
                    <div className="p-3 rounded-lg bg-white/[0.02] border border-white/5 text-center">
                      <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1">Cost per km</p>
                      <p className="text-xl font-bold text-[var(--text-primary)]">${totalDistance > 0 ? (totalCost / totalDistance).toFixed(4) : '0.00'}</p>
                    </div>
                  </div>
                  {comparison.length > 0 && (
                    <div className="space-y-2">
                      {comparison.map((v, i) => {
                        const vCost = safe(v.distance) > 0 && totalDistance > 0 ? (totalCost * safe(v.distance) / totalDistance) : 0
                        return (
                          <div key={v.id} className="flex items-center gap-3">
                            <span className="text-xs text-[var(--text-secondary)] w-24 truncate">{v.name}</span>
                            <div className="flex-1 h-3 rounded-full bg-white/[0.04] overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${totalCost > 0 ? (vCost / totalCost * 100) : 0}%`, background: NEON_COLORS[i % NEON_COLORS.length] }} />
                            </div>
                            <span className="text-xs font-medium text-[var(--text-primary)] w-16 text-right">${vCost.toFixed(2)}</span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </GlassPanel>
              </FadeIn>

              {/* Usage Anomaly Detection */}
              {da && (
                <FadeIn delay={0.4}>
                  <GlassPanel className="p-4 sm:p-6">
                    <h3 className="section-title mb-4 flex items-center gap-2">
                      <Activity className="h-4 w-4 text-neon-red" /> Usage Anomalies
                    </h3>
                    {(() => {
                      const dailyTrend = da.daily_trend ?? []
                      const avgDist = dailyTrend.length > 0 ? dailyTrend.reduce((s, d) => s + safe(d.distance), 0) / dailyTrend.length : 0
                      const avgEff = safe(analytics?.avg_efficiency_wh_km)
                      const anomalies: { date: string; type: string; detail: string; color: string }[] = []
                      dailyTrend.forEach(d => {
                        if (safe(d.distance) > avgDist * 2 && avgDist > 0) {
                          anomalies.push({ date: d.date, type: 'High Distance', detail: `${safe(d.distance).toFixed(0)} km (avg: ${avgDist.toFixed(0)} km)`, color: '#f59e0b' })
                        }
                      })
                      const hourly = da.hourly_pattern ?? []
                      const nightDrives = hourly.filter(h => h.hour >= 0 && h.hour < 5).reduce((s, h) => s + safe(h.drives), 0)
                      if (nightDrives > 0) {
                        anomalies.push({ date: 'Period', type: 'Night Driving', detail: `${nightDrives} drives between 12am-5am`, color: '#a855f7' })
                      }
                      if (avgEff > 0) {
                        const poorEff = comparison.filter(v => safe(v.efficiency) > avgEff * 1.5)
                        poorEff.forEach(v => {
                          anomalies.push({ date: 'Ongoing', type: 'Poor Efficiency', detail: `${v.name}: ${safe(v.efficiency).toFixed(0)} Wh/km (avg: ${avgEff.toFixed(0)})`, color: '#ef4444' })
                        })
                      }
                      if (anomalies.length === 0) return <p className="text-xs text-[var(--text-muted)] text-center py-4">No anomalies detected — your fleet is running normally ✅</p>
                      return (
                        <div className="space-y-2">
                          {anomalies.slice(0, 10).map((a, i) => (
                            <div key={i} className="flex items-center gap-3 p-2 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{ backgroundColor: `${a.color}15`, color: a.color }}>{a.type}</span>
                              <span className="text-xs text-[var(--text-secondary)] flex-1">{a.detail}</span>
                              <span className="text-[10px] text-[var(--text-muted)]">{a.date}</span>
                            </div>
                          ))}
                        </div>
                      )
                    })()}
                  </GlassPanel>
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
                    <StatCard label="Top Speed" value={fmt(da.speed_stats?.max, 0)} unit=" km/h" color="#ef4444" />
                    <StatCard label="Avg Speed" value={fmt(da.speed_stats?.avg, 0)} unit=" km/h" color="#00f0ff" />
                    <StatCard label="Peak Power" value={fmt(da.power_stats?.max, 0)} unit=" kW" color="#a855f7" sub={`Regen: ${fmt(da.regen_stats?.min, 0)} kW`} />
                    <StatCard label="Avg Drive" value={fmt(da.distance_stats?.avg)} unit=" km" color="#10b981" sub={`${fmt(da.duration_stats?.avg, 0)} min avg`} />
                    <StatCard label="Longest" value={fmt(da.distance_stats?.max)} unit=" km" color="#f59e0b" sub={`${fmt(da.duration_stats?.max, 0)} min max`} />
                    <StatCard label="Efficiency" value={fmt(da.efficiency_stats?.avg)} unit="%" color="#10b981" sub={`P95: ${fmt(da.efficiency_stats?.p95)}%`} />
                  </div>
                </GlassPanel>
              </FadeIn>

              {/* Row: Speed dist + Distance dist */}
              <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2">
                {da.speed_distribution?.length > 0 && (
                  <FadeIn delay={0.1}>
                    <GlassPanel className="p-4 sm:p-6">
                      <h3 className="section-title mb-4 sm:mb-6 flex items-center gap-2">
                        <Gauge className="h-4 w-4 text-neon-red" /> Speed Distribution (km/h)
                      </h3>
                      <div className="h-40 sm:h-48 lg:h-56">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={da.speed_distribution}>
                            {grid}<XAxis dataKey="range" tick={tick} /><YAxis tick={tick} />
                            <Tooltip content={<ChartTooltip />} />
                            <Bar dataKey="count" name="Drives" fill="#ef4444" fillOpacity={0.7} radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </GlassPanel>
                  </FadeIn>
                )}

                {da.distance_distribution?.length > 0 && (
                  <FadeIn delay={0.15}>
                    <GlassPanel className="p-4 sm:p-6">
                      <h3 className="section-title mb-4 sm:mb-6 flex items-center gap-2">
                        <MapPin className="h-4 w-4 text-neon-cyan" /> Trip Distance Distribution (km)
                      </h3>
                      <div className="h-40 sm:h-48 lg:h-56">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={da.distance_distribution}>
                            {grid}<XAxis dataKey="range" tick={tick} /><YAxis tick={tick} />
                            <Tooltip content={<ChartTooltip />} />
                            <Bar dataKey="count" name="Trips" fill="#00f0ff" fillOpacity={0.7} radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </GlassPanel>
                  </FadeIn>
                )}
              </div>

              {/* Row: Hourly driving heatmap + Temp vs Efficiency scatter */}
              <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2">
                {da.hourly_pattern?.length > 0 && (
                  <FadeIn delay={0.2}>
                    <GlassPanel className="p-4 sm:p-6">
                      <h3 className="section-title mb-4 sm:mb-6 flex items-center gap-2">
                        <Clock className="h-4 w-4 text-neon-purple" /> Driving by Hour of Day
                      </h3>
                      <div className="h-40 sm:h-48 lg:h-56">
                        <ResponsiveContainer width="100%" height="100%">
                          <ComposedChart data={da.hourly_pattern}>
                            {grid}
                            <XAxis dataKey="hour" tick={tickSm} tickFormatter={(h: number) => `${h}:00`} />
                            <YAxis yAxisId="left" tick={tickSm} />
                            <YAxis yAxisId="right" orientation="right" tick={tickSm} />
                            <Tooltip content={<ChartTooltip />} />
                            <Bar yAxisId="left" dataKey="drives" name="Drives" fill="#a855f7" fillOpacity={0.5} radius={[3, 3, 0, 0]} />
                            <Line yAxisId="right" type="monotone" dataKey="distance" name="Distance (km)" stroke="#00f0ff" strokeWidth={2} dot={false} />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </div>
                    </GlassPanel>
                  </FadeIn>
                )}

                {da.temp_vs_efficiency?.length > 0 && (
                  <FadeIn delay={0.25}>
                    <GlassPanel className="p-4 sm:p-6">
                      <h3 className="section-title mb-4 sm:mb-6 flex items-center gap-2">
                        <Thermometer className="h-4 w-4 text-neon-amber" /> Temperature vs Efficiency
                      </h3>
                      <div className="h-40 sm:h-48 lg:h-56">
                        <ResponsiveContainer width="100%" height="100%">
                          <ScatterChart>
                            {grid}
                            <XAxis type="number" dataKey="temp" name="Temp" unit="C" tick={tickSm} />
                            <YAxis type="number" dataKey="efficiency" name="Efficiency" unit="%" tick={tickSm} />
                            <ZAxis type="number" dataKey="distance" range={[20, 200]} />
                            <Tooltip
                              content={({ active, payload }) => {
                                if (!active || !payload?.length) return null
                                const d = payload[0].payload as { temp: number; efficiency: number; distance: number }
                                return (
                                  <div className="glass-panel p-3 text-xs" style={{ background: 'var(--surface-2)', borderColor: 'var(--glass-border)' }}>
                                    <p style={{ color: 'var(--text-primary)' }}>{d.temp}C | {d.efficiency}% eff | {d.distance} km</p>
                                  </div>
                                )
                              }}
                            />
                            <Scatter data={da.temp_vs_efficiency} fill="#f59e0b" fillOpacity={0.6} />
                          </ScatterChart>
                        </ResponsiveContainer>
                      </div>
                    </GlassPanel>
                  </FadeIn>
                )}
              </div>

              {/* Row: Daily driving trend */}
              {da.daily_trend?.length > 0 && (
                <FadeIn delay={0.3}>
                  <GlassPanel className="p-4 sm:p-6">
                    <h3 className="section-title mb-4 sm:mb-6 flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-neon-green" /> Daily Driving Trend
                    </h3>
                      <div className="h-40 sm:h-48 lg:h-56">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={da.daily_trend}>
                          {grid}
                          <XAxis dataKey="date" tick={tickSm} tickFormatter={(d: string) => d.slice(5)} />
                          <YAxis yAxisId="left" tick={tickSm} />
                          <YAxis yAxisId="right" orientation="right" tick={tickSm} />
                          <Tooltip content={<ChartTooltip />} />
                          <Area yAxisId="left" type="monotone" dataKey="distance" name="Distance (km)" stroke="#10b981" fill="#10b981" fillOpacity={0.15} strokeWidth={2} />
                          <Line yAxisId="right" type="monotone" dataKey="drives" name="Drives" stroke="#a855f7" strokeWidth={2} dot={false} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </GlassPanel>
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
                          <div className="grid grid-cols-3 gap-2">
                            <StatCard label="Min" value={fmt(da.temperature.outside.min)} unit="C" color="#00f0ff" />
                            <StatCard label="Avg" value={fmt(da.temperature.outside.avg)} unit="C" color="#10b981" />
                            <StatCard label="Max" value={fmt(da.temperature.outside.max)} unit="C" color="#ef4444" />
                          </div>
                        </div>
                      )}
                      {da.temperature?.inside?.count > 0 && (
                        <div>
                          <p className="text-xs uppercase tracking-wider mb-3" style={{ color: 'var(--text-secondary)' }}>Inside Temperature</p>
                          <div className="grid grid-cols-3 gap-2">
                            <StatCard label="Min" value={fmt(da.temperature.inside.min)} unit="C" color="#00f0ff" />
                            <StatCard label="Avg" value={fmt(da.temperature.inside.avg)} unit="C" color="#10b981" />
                            <StatCard label="Max" value={fmt(da.temperature.inside.max)} unit="C" color="#ef4444" />
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
                    <StatCard label="Sessions" value={safe(analytics?.total_charging_sessions)} color="#a855f7" />
                    <StatCard label="Total Energy" value={fmt(analytics?.total_energy_kwh)} unit=" kWh" color="#10b981" />
                    <StatCard label="Total Cost" value={`$${fmt(analytics?.total_cost, 2)}`} color="#f59e0b" />
                    <StatCard label="Avg Power" value={fmt(ca.power_stats?.avg)} unit=" kW" color="#00f0ff" sub={`Peak: ${fmt(ca.power_stats?.max)} kW`} />
                    <StatCard label="Avg Duration" value={fmt(ca.duration_stats?.avg, 0)} unit=" min" color="#ec4899" sub={`Longest: ${fmt(ca.duration_stats?.max, 0)} min`} />
                    <StatCard label="Charge Eff" value={fmt(ca.efficiency_stats?.avg)} unit="%" color="#10b981" sub={`${fmt(ca.energy_stats?.avg)} kWh avg`} />
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
                            <Pie data={ca.charger_types.map((t, i) => ({ ...t, name: t.type, value: t.count, fill: NEON_COLORS[i % NEON_COLORS.length] }))}
                              cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={2} dataKey="value">
                              {ca.charger_types.map((_, i) => <Cell key={i} fill={NEON_COLORS[i % NEON_COLORS.length]} stroke="transparent" />)}
                            </Pie>
                            <Tooltip content={<ChartTooltip />} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="flex flex-wrap gap-3 mt-2 justify-center">
                        {ca.charger_types.map((t, i) => (
                          <div key={i} className="flex items-center gap-1.5 text-xs">
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: NEON_COLORS[i % NEON_COLORS.length] }} />
                            <span style={{ color: 'var(--text-secondary)' }}>{t.type}: {t.count}</span>
                          </div>
                        ))}
                      </div>
                    </GlassPanel>
                  </FadeIn>
                )}

                {ca.start_battery_dist?.length > 0 && (
                  <FadeIn delay={0.15}>
                    <GlassPanel className="p-4 sm:p-6">
                      <h3 className="section-title mb-4 sm:mb-6 flex items-center gap-2">
                        <Battery className="h-4 w-4 text-neon-amber" /> Charge Start Battery Level
                      </h3>
                      <div className="h-40 sm:h-48 lg:h-56">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={ca.start_battery_dist}>
                            {grid}<XAxis dataKey="range" tick={tickSm} /><YAxis tick={tickSm} />
                            <Tooltip content={<ChartTooltip />} />
                            <Bar dataKey="count" name="Sessions" fill="#f59e0b" fillOpacity={0.7} radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </GlassPanel>
                  </FadeIn>
                )}
              </div>

              {/* Row: Hourly charging + Charger brands */}
              <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2">
                {ca.hourly_pattern?.length > 0 && (
                  <FadeIn delay={0.2}>
                    <GlassPanel className="p-4 sm:p-6">
                      <h3 className="section-title mb-4 sm:mb-6 flex items-center gap-2">
                        <Clock className="h-4 w-4 text-neon-purple" /> Charging by Hour of Day
                      </h3>
                      <div className="h-40 sm:h-48 lg:h-56">
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
                      </div>
                    </GlassPanel>
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
                            color={NEON_COLORS[i % NEON_COLORS.length]} />
                        ))}
                      </div>
                    </GlassPanel>
                  </FadeIn>
                )}
              </div>

              {/* Row: Monthly charging trend */}
              {ca.monthly_trend?.length > 0 && (
                <FadeIn delay={0.3}>
                  <GlassPanel className="p-4 sm:p-6">
                    <h3 className="section-title mb-4 sm:mb-6 flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-neon-green" /> Monthly Charging Trend
                    </h3>
                    <div className="h-48 sm:h-56 lg:h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={ca.monthly_trend}>
                          {grid}<XAxis dataKey="month" tick={tickSm} /><YAxis tick={tickSm} />
                          <Tooltip content={<ChartTooltip />} />
                          <Area type="monotone" dataKey="energy" name="Energy (kWh)" stroke="#10b981" fill="#10b981" fillOpacity={0.1} strokeWidth={2} />
                          <Line type="monotone" dataKey="avg_power" name="Avg Power (kW)" stroke="#00f0ff" strokeWidth={2} dot={{ fill: '#00f0ff', r: 3 }} />
                          <Bar dataKey="sessions" name="Sessions" fill="#a855f7" fillOpacity={0.3} radius={[3, 3, 0, 0]} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </GlassPanel>
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
                      <StatCard label="Avg / Session" value={`$${fmt(ca.cost_stats.avg, 2)}`} color="#f59e0b" />
                      <StatCard label="Median" value={`$${fmt(ca.cost_stats.median, 2)}`} color="#10b981" />
                      <StatCard label="Max" value={`$${fmt(ca.cost_stats.max, 2)}`} color="#ef4444" />
                      <StatCard label="$/kWh avg" value={`$${ca.energy_stats?.avg > 0 ? fmt(ca.cost_stats.avg / ca.energy_stats.avg, 3) : '0.0'}`} color="#00f0ff" />
                    </div>
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
                        <StatCard label="Health Score" value={fmt(bt[bt.length - 1]?.health_score, 0)} unit="%" color={bt[bt.length - 1]?.health_score > 90 ? '#10b981' : '#f59e0b'} />
                        <StatCard label="Capacity" value={fmt(bt[bt.length - 1]?.capacity_kwh)} unit=" kWh" color="#00f0ff" />
                        <StatCard label="Degradation" value={fmt(bt[bt.length - 1]?.degradation_pct)} unit="%" color={bt[bt.length - 1]?.degradation_pct < 5 ? '#10b981' : '#ef4444'} />
                        <StatCard label="Est Range" value={fmt(bt[bt.length - 1]?.range_km, 0)} unit=" km" color="#a855f7" />
                        <StatCard label="Cycles" value={bt[bt.length - 1]?.cycle_count ?? 0} color="#f59e0b" />
                      </div>
                    </GlassPanel>
                  </FadeIn>

                  {/* Health score timeline */}
                  <FadeIn delay={0.1}>
                    <GlassPanel className="p-4 sm:p-6">
                      <h3 className="section-title mb-4 sm:mb-6 flex items-center gap-2">
                        <TrendingDown className="h-4 w-4 text-neon-amber" /> Health Score Over Time
                      </h3>
                      <div className="h-48 sm:h-56 lg:h-64">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={bt}>
                            {grid}
                            <XAxis dataKey="date" tick={tickSm} tickFormatter={(d: string) => d.slice(5)} />
                            <YAxis domain={[80, 100]} tick={tickSm} />
                            <Tooltip content={<ChartTooltip />} />
                            <Area type="monotone" dataKey="health_score" name="Health %" stroke="#10b981" fill="#10b981" fillOpacity={0.15} strokeWidth={2} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </GlassPanel>
                  </FadeIn>

                  {/* Capacity + Range trend */}
                  <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2">
                    <FadeIn delay={0.15}>
                      <GlassPanel className="p-4 sm:p-6">
                        <h3 className="section-title mb-4 sm:mb-6 flex items-center gap-2">
                          <Zap className="h-4 w-4 text-neon-cyan" /> Capacity Trend
                        </h3>
                        <div className="h-40 sm:h-48 lg:h-56">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={bt}>
                              {grid}
                              <XAxis dataKey="date" tick={tickSm} tickFormatter={(d: string) => d.slice(5)} />
                              <YAxis tick={tickSm} />
                              <Tooltip content={<ChartTooltip />} />
                              <Line type="monotone" dataKey="capacity_kwh" name="Capacity (kWh)" stroke="#00f0ff" strokeWidth={2} dot={false} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </GlassPanel>
                    </FadeIn>

                    <FadeIn delay={0.2}>
                      <GlassPanel className="p-4 sm:p-6">
                        <h3 className="section-title mb-4 sm:mb-6 flex items-center gap-2">
                          <Car className="h-4 w-4 text-neon-purple" /> Estimated Range Trend
                        </h3>
                        <div className="h-40 sm:h-48 lg:h-56">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={bt}>
                              {grid}
                              <XAxis dataKey="date" tick={tickSm} tickFormatter={(d: string) => d.slice(5)} />
                              <YAxis tick={tickSm} />
                              <Tooltip content={<ChartTooltip />} />
                              <Line type="monotone" dataKey="range_km" name="Range (km)" stroke="#a855f7" strokeWidth={2} dot={false} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </GlassPanel>
                    </FadeIn>
                  </div>

                  {/* Degradation + Cycles */}
                  <FadeIn delay={0.25}>
                    <GlassPanel className="p-4 sm:p-6">
                      <h3 className="section-title mb-4 sm:mb-6 flex items-center gap-2">
                        <Timer className="h-4 w-4 text-neon-amber" /> Degradation & Cycles
                      </h3>
                      <div className="h-40 sm:h-48 lg:h-56">
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
                      </div>
                    </GlassPanel>
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
