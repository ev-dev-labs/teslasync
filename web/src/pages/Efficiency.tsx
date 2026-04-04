import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getVehicles, getEnergyStats, getDrives, getFleetAnalytics } from '../api'
import { PageHeader, GlassPanel, FadeIn, DateRangeFilter, Skeleton } from '../components/ui'
import { useSettings } from '../hooks/useSettings'
import { formatDateShort } from '../lib/dateFormat'
import { Zap, TrendingUp, Thermometer, Gauge, Fuel, BarChart3 } from 'lucide-react'
import {
  AreaChart, Area, BarChart, Bar, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell
} from 'recharts'
import { ChartTooltip } from '../components/Charts'

export default function Efficiency() {
  const { convertDistance, convertSpeed, convertTemp, convertEfficiency, distanceUnit, speedUnit, tempUnit, efficiencyUnit, isFahrenheit } = useSettings()
  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: getVehicles })
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null)
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0])
  const vehicleId = selectedVehicle ?? vehicles?.[0]?.id ?? null

  const { data: energy, isLoading } = useQuery({
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
    .filter(d => d.distance > 0 && d.speed_max && d.start_range_km && d.end_range_km && d.start_battery_level && d.end_battery_level)
    .map(d => {
      const battUsed = (d.start_battery_level! - d.end_battery_level!)
      const efficiency = d.distance > 0 && battUsed > 0 ? (battUsed / d.distance * 1000) : 0
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
            <select
              value={vehicleId ?? ''}
              onChange={e => setSelectedVehicle(Number(e.target.value))}
              className="glass-card px-3 py-2 text-sm rounded-lg border-0 focus:ring-1 focus:ring-neon-cyan/50"
              style={{ background: 'var(--surface-2)', color: 'var(--text-primary)' }}
            >
              {vehicles.map(v => <option key={v.id} value={v.id}>{v.display_name || v.vin}</option>)}
            </select>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mb-6 sm:mb-8">
          {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mb-6 sm:mb-8">
          {[
            { label: 'Avg Efficiency', value: `${convertEfficiency(avgEff).toFixed(0)} ${efficiencyUnit}`, sub: '', icon: Gauge, color: '#00f0ff' },
            { label: 'Energy Used', value: `${totalEnergy.toFixed(1)} kWh`, sub: `selected period`, icon: Zap, color: '#f59e0b' },
            { label: 'Distance', value: `${convertDistance(totalDist).toFixed(0)} ${distanceUnit}`, sub: 'selected period', icon: TrendingUp, color: '#10b981' },
            { label: 'Cost', value: `$${energy?.total_cost?.toFixed(2) ?? '0'}`, sub: `$${totalDist > 0 ? ((energy?.total_cost ?? 0) / convertDistance(totalDist) * 100).toFixed(1) : '0'}/100${distanceUnit}`, icon: Fuel, color: '#8b5cf6' },
            { label: 'CO₂ Saved', value: `${co2Saved.toFixed(0)} kg`, sub: 'vs ICE vehicle', icon: Thermometer, color: '#ec4899' },
          ].map(card => (
            <GlassPanel key={card.label} className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <card.icon className="h-4 w-4" style={{ color: card.color }} />
                <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{card.label}</span>
              </div>
              <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{card.value}</p>
              <p className="text-[10px] text-[var(--text-muted)] mt-1">{card.sub}</p>
            </GlassPanel>
          ))}
        </div>
      )}

      {/* Daily Efficiency Trend */}
      <GlassPanel className="p-4 sm:p-6 mb-6">
        <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Daily Efficiency Trend ({efficiencyUnit})</h3>
        {dailyEfficiency.length === 0 ? (
          <div className="flex items-center justify-center h-48 sm:h-64 text-[var(--text-muted)] text-sm">No efficiency data</div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
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
      </GlassPanel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-6">
        {/* Speed vs Efficiency Scatter */}
        <GlassPanel className="p-4 sm:p-6">
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Speed vs Energy Consumption</h3>
          {speedEffData.length === 0 ? (
            <div className="flex items-center justify-center h-48 sm:h-64 text-[var(--text-muted)] text-sm">Not enough drive data</div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
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
        </GlassPanel>

        {/* Temperature vs Efficiency */}
        <GlassPanel className="p-4 sm:p-6">
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
            <Thermometer className="h-4 w-4 inline mr-1" /> Temperature vs Efficiency
          </h3>
          {tempEffData.length === 0 ? (
            <div className="flex items-center justify-center h-48 sm:h-64 text-[var(--text-muted)] text-sm">No temperature data</div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
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
        </GlassPanel>
      </div>

      {/* Speed Distribution */}
      <GlassPanel className="p-4 sm:p-6">
        <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Speed Distribution</h3>
        {speedDist.length === 0 ? (
          <div className="flex items-center justify-center h-48 sm:h-64 text-[var(--text-muted)] text-sm">No speed distribution data</div>
        ) : (
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={speedDist}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
              <XAxis dataKey="range" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="count" fill="#8b5cf6" name="Drives" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </GlassPanel>

      {/* Temperature-Bucketed Efficiency Table */}
      {tempBuckets.length > 0 && (
        <GlassPanel className="p-4 sm:p-6 mt-6">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Thermometer className="h-4 w-4 text-neon-amber" /> Efficiency by Temperature Range
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wider text-[var(--text-muted)] border-b border-white/5">
                  <th className="text-left py-2 pr-4">Temp Range</th>
                  <th className="text-right py-2 px-3">Drives</th>
                  <th className="text-right py-2 px-3">Avg {efficiencyUnit}</th>
                  <th className="text-right py-2 px-3">{distanceUnit}/kWh</th>
                  <th className="text-right py-2 px-3">Total {distanceUnit}</th>
                  <th className="text-right py-2 px-3">Avg Speed</th>
                </tr>
              </thead>
              <tbody>
                {tempBuckets.map(b => (
                  <tr key={b.range} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                    <td className="py-2 pr-4 font-medium text-[var(--text-primary)]">{b.range}</td>
                    <td className="text-right py-2 px-3 text-[var(--text-secondary)]">{b.count}</td>
                    <td className="text-right py-2 px-3">
                      <span style={{ color: b.avgEff < 160 ? '#10b981' : b.avgEff < 200 ? '#f59e0b' : '#ef4444' }}>
                        {convertEfficiency(b.avgEff).toFixed(0)}
                      </span>
                    </td>
                    <td className="text-right py-2 px-3 text-neon-cyan">{b.avgEff > 0 ? (1000 / convertEfficiency(b.avgEff)).toFixed(1) : '—'}</td>
                    <td className="text-right py-2 px-3 text-[var(--text-secondary)]">{convertDistance(b.totalDist).toFixed(0)}</td>
                    <td className="text-right py-2 px-3 text-[var(--text-secondary)]">{convertSpeed(b.avgSpeed).toFixed(0)} {speedUnit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
                { label: 'Total Distance', value: `${convertDistance(consumptionStats.totalDist).toFixed(0)} ${distanceUnit}` },
                { label: 'Avg Consumption', value: `${convertEfficiency(consumptionStats.avgEff).toFixed(0)} ${efficiencyUnit}` },
                { label: 'Avg Efficiency', value: `${(1000 / convertEfficiency(consumptionStats.avgEff)).toFixed(1)} ${distanceUnit}/kWh` },
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
                { label: 'Total Energy Used', value: `${totalEnergy.toFixed(1)} kWh` },
                { label: 'Distance Covered', value: `${convertDistance(totalDist).toFixed(0)} ${distanceUnit}` },
                { label: `Cost per ${distanceUnit}`, value: totalDist > 0 ? `$${((energy?.total_cost ?? 0) / convertDistance(totalDist)).toFixed(3)}` : '$0' },
                { label: 'CO₂ Saved vs ICE', value: `${co2Saved.toFixed(0)} kg` },
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
