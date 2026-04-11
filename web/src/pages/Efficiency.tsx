import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getVehicles, getEnergyStats, getDrives, getFleetAnalytics } from '../api'
import { PageHeader, GlassPanel, FadeIn, DateRangeFilter, Skeleton, QueryError, MetricCard, ChartContainer, Select, DataTable } from '../components/ui'
import { useSettings } from '../hooks/useSettings'
import { formatDateShort } from '../lib/dateFormat'
import { fmtNumber, fmtInt } from '../lib/numberFormat'
import { Zap, TrendingUp, Thermometer, Gauge, Fuel, BarChart3 } from 'lucide-react'
import {
  AreaChart, Area, BarChart, Bar, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell
} from 'recharts'
import { ChartTooltip } from '../components/Charts'
import { usePageTitle } from '../hooks/usePageTitle'

export default function Efficiency() {
  usePageTitle('Efficiency')
  const { convertDistance, convertSpeed, convertTemp, convertEfficiency, distanceUnit, speedUnit, tempUnit, efficiencyUnit, isFahrenheit } = useSettings()
  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: getVehicles })
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null)
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0])
  const vehicleId = selectedVehicle ?? vehicles?.[0]?.id ?? null

  const { data: energy, isLoading, error, refetch } = useQuery({
    queryKey: ['energy-stats', vehicleId, startDate],
    queryFn: () => getEnergyStats(vehicleId!, 30, startDate),
    enabled: vehicleId !== null,
  })

  const { data: drives } = useQuery({
    queryKey: ['drives', vehicleId],
    queryFn: () => getDrives(vehicleId!, 200),
    enabled: vehicleId !== null,
  })

  const { data: analytics } = useQuery({
    queryKey: ['fleet-analytics', startDate],
    queryFn: () => getFleetAnalytics(30, startDate),
  })

  // Daily efficiency chart
  const dailyEfficiency = (energy?.daily_breakdown ?? []).map(d => ({
    date: formatDateShort(d.date),
    efficiency: convertEfficiency(d.efficiency),
    energy: d.energy_kwh,
    distance: convertDistance(d.distance_km),
  }))

  // Speed vs efficiency from drives
  const speedEffData = (drives ?? [])
    .filter(d => d.distance > 0 && d.speed_max && d.start_battery_level && d.end_battery_level && d.start_battery_level > d.end_battery_level)
    .map(d => {
      const battUsed = (d.start_battery_level! - d.end_battery_level!)
      const efficiency = battUsed > 0 ? (battUsed * 0.75 * 1000) / d.distance : 0 // Wh/km estimate (0.75 kWh per %)
      return { speed: d.speed_max!, efficiency: Math.round(efficiency), distance: d.distance }
    })
    .filter(d => d.efficiency > 0 && d.efficiency < 500)
    .map(d => ({ ...d, speed: Math.round(convertSpeed(d.speed)), efficiency: Math.round(convertEfficiency(d.efficiency)) }))

  // Temperature vs efficiency from analytics
  const tempEffData = (analytics?.drive_analytics?.temp_vs_efficiency ?? []).map((d: { temp: number; efficiency: number }) => ({ ...d, temp: Math.round(convertTemp(d.temp)), efficiency: Math.round(convertEfficiency(d.efficiency)) }))

  // Speed distribution
  const speedDist = analytics?.drive_analytics?.speed_distribution ?? []

  // Temperature-bucketed efficiency analysis
  const tempBuckets = useMemo(() => {
    if (!drives || drives.length === 0) return []
    const buckets: Record<string, { count: number; totalEff: number; totalDist: number; totalSpeed: number }> = {}
    const ranges = [
      { min: -Infinity, max: -10, label: `< ${Math.round(convertTemp(-10))}${tempUnit}` },
      { min: -10, max: 0, label: `${Math.round(convertTemp(-10))} to ${Math.round(convertTemp(0))}${tempUnit}` },
      { min: 0, max: 10, label: `${Math.round(convertTemp(0))} to ${Math.round(convertTemp(10))}${tempUnit}` },
      { min: 10, max: 20, label: `${Math.round(convertTemp(10))} to ${Math.round(convertTemp(20))}${tempUnit}` },
      { min: 20, max: 30, label: `${Math.round(convertTemp(20))} to ${Math.round(convertTemp(30))}${tempUnit}` },
      { min: 30, max: 40, label: `${Math.round(convertTemp(30))} to ${Math.round(convertTemp(40))}${tempUnit}` },
      { min: 40, max: Infinity, label: `> ${Math.round(convertTemp(40))}${tempUnit}` },
    ]
    ranges.forEach(r => { buckets[r.label] = { count: 0, totalEff: 0, totalDist: 0, totalSpeed: 0 } })
    drives.forEach(d => {
      if (!d.outside_temp_avg || d.distance <= 0) return
      const battUsed = (d.start_battery_level ?? 0) - (d.end_battery_level ?? 0)
      if (battUsed <= 0) return
      const eff = (battUsed * 0.75 * 1000) / d.distance // Wh/km estimate
      if (eff <= 0 || eff > 500) return
      const range = ranges.find(r => d.outside_temp_avg! >= r.min && d.outside_temp_avg! < r.max)
      if (range) {
        const b = buckets[range.label]
        b.count++
        b.totalEff += eff
        b.totalDist += d.distance
        b.totalSpeed += d.speed_max ?? 0
      }
    })
    return ranges
      .map(r => ({
        range: r.label,
        count: buckets[r.label].count,
        avgEff: buckets[r.label].count > 0 ? buckets[r.label].totalEff / buckets[r.label].count : 0,
        totalDist: buckets[r.label].totalDist,
        avgSpeed: buckets[r.label].count > 0 ? buckets[r.label].totalSpeed / buckets[r.label].count : 0,
      }))
      .filter(b => b.count > 0)
  }, [drives, isFahrenheit])

  // Per-drive consumption stats
  const consumptionStats = useMemo(() => {
    if (!drives || drives.length === 0) return null
    let totalDist = 0, count = 0, totalEff = 0
    drives.forEach(d => {
      if (d.distance <= 0) return
      const battUsed = (d.start_battery_level ?? 0) - (d.end_battery_level ?? 0)
      if (battUsed <= 0) return
      const eff = (battUsed * 0.75 * 1000) / d.distance
      if (eff <= 0 || eff > 500) return
      totalDist += d.distance
      totalEff += eff
      count++
    })
    const avgEff = count > 0 ? totalEff / count : 0
    const kmPerKwh = avgEff > 0 ? 1000 / avgEff : 0
    return { totalDist, count, avgEff, kmPerKwh }
  }, [drives])

  const avgEff = energy?.avg_efficiency_wh_km ?? 0
  const totalEnergy = energy?.total_energy_used_kwh ?? 0
  const totalDist = energy?.total_distance_km ?? 0
  const co2Saved = energy?.co2_saved_kg ?? 0

  return (
    <FadeIn>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0 mb-6 sm:mb-8">
        <PageHeader title="Efficiency" subtitle="Energy consumption and driving efficiency analysis" icon={<Zap className="h-7 w-7 text-neon-blue" />} />
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <DateRangeFilter
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={setStartDate}
            onEndDateChange={setEndDate}
          />
          {vehicles && vehicles.length > 1 && (
            <Select
              value={String(vehicleId ?? '')}
              onChange={e => setSelectedVehicle(Number(e.target.value))}
              options={vehicles.map(v => ({ value: String(v.id), label: v.display_name || v.vin }))}
            />
          )}
        </div>
      </div>

      {error && <QueryError error={error} onRetry={refetch} />}

      {/* Stats Cards */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mb-6 sm:mb-8">
          {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mb-6 sm:mb-8">
          {([
            { label: 'Avg Efficiency', value: `${fmtInt(convertEfficiency(avgEff))} ${efficiencyUnit}`, subtitle: '', icon: Gauge, color: 'cyan' as const },
            { label: 'Energy Used', value: `${fmtNumber(totalEnergy)} kWh`, subtitle: 'selected period', icon: Zap, color: 'amber' as const },
            { label: 'Distance', value: `${fmtInt(convertDistance(totalDist))} ${distanceUnit}`, subtitle: 'selected period', icon: TrendingUp, color: 'green' as const },
            { label: 'Cost', value: `$${energy?.total_cost != null ? fmtNumber(energy.total_cost) : '0'}`, subtitle: `$${totalDist > 0 ? fmtNumber((energy?.total_cost ?? 0) / convertDistance(totalDist) * 100) : '0'}/100${distanceUnit}`, icon: Fuel, color: 'purple' as const },
            { label: 'CO₂ Saved', value: `${fmtInt(co2Saved)} kg`, subtitle: 'vs ICE vehicle', icon: Thermometer, color: 'red' as const },
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
      )}

      {/* Daily Efficiency Trend */}
      <ChartContainer title={`Daily Efficiency Trend (${efficiencyUnit})`} height={280} className="mb-6">
        {dailyEfficiency.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[var(--text-muted)] text-sm">No efficiency data</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={dailyEfficiency}>
              <defs>
                <linearGradient id="effGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#00f0ff" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#00f0ff" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="efficiency" stroke="#00f0ff" fill="url(#effGrad)" strokeWidth={2} name={`Efficiency (${efficiencyUnit})`} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </ChartContainer>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-6">
        {/* Speed vs Efficiency Scatter */}
        <ChartContainer title="Speed vs Energy Consumption" height={280}>
          {speedEffData.length === 0 ? (
            <div className="flex items-center justify-center h-full text-[var(--text-muted)] text-sm">Not enough drive data</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
                <XAxis dataKey="speed" name={`Speed (${speedUnit})`} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                <YAxis dataKey="efficiency" name={efficiencyUnit} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                <Tooltip content={<ChartTooltip />} />
                <Scatter data={speedEffData} name="Drives">
                  {speedEffData.map((_, i) => <Cell key={i} fill="#00f0ff" fillOpacity={0.6} />)}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          )}
        </ChartContainer>

        {/* Temperature vs Efficiency */}
        <ChartContainer title="Temperature vs Efficiency" height={280}>
          {tempEffData.length === 0 ? (
            <div className="flex items-center justify-center h-full text-[var(--text-muted)] text-sm">No temperature data</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
                <XAxis dataKey="temp" name={`Temp (${tempUnit})`} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                <YAxis dataKey="efficiency" name={efficiencyUnit} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                <Tooltip content={<ChartTooltip />} />
                <Scatter data={tempEffData} name="Drives">
                  {tempEffData.map((_, i) => <Cell key={i} fill="#f59e0b" fillOpacity={0.6} />)}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          )}
        </ChartContainer>
      </div>

      {/* Speed Distribution */}
      <ChartContainer title="Speed Distribution" height={250}>
        {speedDist.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[var(--text-muted)] text-sm">No speed distribution data</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={speedDist}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
              <XAxis dataKey="range" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="count" fill="#8b5cf6" name="Drives" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartContainer>

      {/* Temperature-Bucketed Efficiency Table */}
      {tempBuckets.length > 0 && (
        <GlassPanel className="p-4 sm:p-6 mt-6">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Thermometer className="h-4 w-4 text-neon-amber" /> Efficiency by Temperature Range
          </h3>
          <DataTable
            data={tempBuckets}
            keyExtractor={b => b.range}
            compact
            columns={[
              { key: 'range', header: 'Temp Range', render: b => <span className="font-medium text-[var(--text-primary)]">{b.range}</span> },
              { key: 'count', header: 'Drives', className: 'text-right', render: b => <span className="text-[var(--text-secondary)]">{b.count}</span> },
              { key: 'avgEff', header: `Avg ${efficiencyUnit}`, className: 'text-right', render: b => (
                <span style={{ color: b.avgEff < 160 ? '#10b981' : b.avgEff < 200 ? '#f59e0b' : '#ef4444' }}>
                  {fmtInt(convertEfficiency(b.avgEff))}
                </span>
              )},
              { key: 'kmPerKwh', header: `${distanceUnit}/kWh`, className: 'text-right', render: b => (
                <span className="text-neon-cyan">{b.avgEff > 0 ? fmtNumber(1000 / convertEfficiency(b.avgEff)) : '—'}</span>
              )},
              { key: 'totalDist', header: `Total ${distanceUnit}`, className: 'text-right', render: b => (
                <span className="text-[var(--text-secondary)]">{fmtInt(convertDistance(b.totalDist))}</span>
              )},
              { key: 'avgSpeed', header: 'Avg Speed', className: 'text-right', render: b => (
                <span className="text-[var(--text-secondary)]">{fmtInt(convertSpeed(b.avgSpeed))} {speedUnit}</span>
              )},
            ]}
          />
        </GlassPanel>
      )}

      {/* Consumption Summary */}
      {consumptionStats && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mt-6">
          <GlassPanel className="p-4 sm:p-6">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <BarChart3 className="h-4 w-4 text-neon-purple" /> Driving Efficiency Summary
            </h3>
            <div className="space-y-3">
              {[
                { label: 'Drives Analyzed', value: consumptionStats.count.toString() },
                { label: 'Total Distance', value: `${fmtInt(convertDistance(consumptionStats.totalDist))} ${distanceUnit}` },
                { label: 'Avg Consumption', value: `${fmtInt(convertEfficiency(consumptionStats.avgEff))} ${efficiencyUnit}` },
                { label: 'Avg Efficiency', value: `${fmtNumber(1000 / convertEfficiency(consumptionStats.avgEff))} ${distanceUnit}/kWh` },
              ].map(row => (
                <div key={row.label} className="flex justify-between items-center py-2 border-b border-white/5">
                  <span className="text-xs text-[var(--text-secondary)]">{row.label}</span>
                  <span className="text-sm font-semibold text-[var(--text-primary)]">{row.value}</span>
                </div>
              ))}
            </div>
          </GlassPanel>

          <GlassPanel className="p-4 sm:p-6">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <Zap className="h-4 w-4 text-neon-green" /> Energy Summary
            </h3>
            <div className="space-y-3">
              {[
                { label: 'Total Energy Used', value: `${fmtNumber(totalEnergy)} kWh` },
                { label: 'Distance Covered', value: `${fmtInt(convertDistance(totalDist))} ${distanceUnit}` },
                { label: `Cost per ${distanceUnit}`, value: totalDist > 0 ? `$${fmtNumber((energy?.total_cost ?? 0) / convertDistance(totalDist))}` : '$0' },
                { label: 'CO₂ Saved vs ICE', value: `${fmtInt(co2Saved)} kg` },
              ].map(row => (
                <div key={row.label} className="flex justify-between items-center py-2 border-b border-white/5">
                  <span className="text-xs text-[var(--text-secondary)]">{row.label}</span>
                  <span className="text-sm font-semibold text-[var(--text-primary)]">{row.value}</span>
                </div>
              ))}
            </div>
          </GlassPanel>
        </div>
      )}
    </FadeIn>
  )
}
