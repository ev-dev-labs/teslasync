import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getVehicles, getTemperatureImpact, Vehicle, TempEfficiencyBucket } from '../api'
import { PageHeader, GlassPanel, FadeIn, StaggerContainer, StaggerItem, Skeleton } from '../components/ui'
import { Thermometer, Snowflake, Sun, TrendingDown, Activity } from 'lucide-react'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ComposedChart, Line, ReferenceLine
} from 'recharts'
import { ChartTooltip, axisTickSm, chartGrid } from '../components/Charts'

const TEMP_COLORS: Record<string, string> = {
  'Below 0°C': '#3b82f6',
  '0-10°C': '#60a5fa',
  '10-20°C': '#34d399',
  '20-30°C': '#10b981',
  'Above 30°C': '#f59e0b',
}

function getBucketColor(bucket: string): string {
  return TEMP_COLORS[bucket] ?? '#00f0ff'
}

export default function TemperatureImpact() {
  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: getVehicles })
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null)
  const vehicleId = selectedVehicle ?? vehicles?.[0]?.id ?? null

  const { data, isLoading } = useQuery({
    queryKey: ['temperature-impact', vehicleId],
    queryFn: () => getTemperatureImpact(vehicleId!),
    enabled: vehicleId !== null,
  })

  // Compute winter/summer penalties relative to optimal zone (20-30°C)
  const penalties = useMemo(() => {
    if (!data?.efficiency?.length) return { winter: null, summer: null, optimalEff: 0 }
    const optimal = data.efficiency.find(b => b.temp_bucket === '20-30°C')
    const cold = data.efficiency.find(b => b.temp_bucket === 'Below 0°C')
    const hot = data.efficiency.find(b => b.temp_bucket === 'Above 30°C')
    const optEff = optimal?.avg_battery_pct_per_100km ?? 0

    let winterPenalty: number | null = null
    let summerPenalty: number | null = null
    if (optEff > 0 && cold) {
      winterPenalty = Math.round(((cold.avg_battery_pct_per_100km - optEff) / optEff) * 100)
    }
    if (optEff > 0 && hot) {
      summerPenalty = Math.round(((hot.avg_battery_pct_per_100km - optEff) / optEff) * 100)
    }
    return { winter: winterPenalty, summer: summerPenalty, optimalEff: optEff }
  }, [data])

  // Insight text
  const insight = useMemo(() => {
    if (!data?.efficiency?.length) return null
    const sorted = [...data.efficiency].sort((a, b) => a.avg_battery_pct_per_100km - b.avg_battery_pct_per_100km)
    const best = sorted[0]
    const worst = sorted[sorted.length - 1]
    if (!best || !worst || best.avg_battery_pct_per_100km === 0) return null
    const increase = worst.avg_battery_pct_per_100km > 0
      ? Math.round(((worst.avg_battery_pct_per_100km - best.avg_battery_pct_per_100km) / best.avg_battery_pct_per_100km) * 100)
      : 0
    return `Your car is most efficient at ${best.temp_bucket} (${best.avg_battery_pct_per_100km.toFixed(1)}%/100km). ${worst.temp_bucket} increases consumption by ${increase}%.`
  }, [data])

  // Chart data for efficiency curve with colored area
  const efficiencyChartData = useMemo(() => {
    if (!data?.efficiency?.length) return []
    return data.efficiency.map(b => ({
      ...b,
      fill: getBucketColor(b.temp_bucket),
    }))
  }, [data])

  // Monthly trend chart data
  const monthlyData = useMemo(() => {
    if (!data?.monthly_trend?.length) return []
    return data.monthly_trend.map(m => ({
      ...m,
      month: m.month.slice(0, 7),
    }))
  }, [data])

  const hasData = data && data.efficiency.length > 0

  return (
    <div className="space-y-8">
      <PageHeader
        title="Temperature Impact"
        subtitle="How temperature affects driving efficiency, battery drain, and energy consumption"
        actions={
          vehicles && vehicles.length > 1 ? (
            <select
              value={vehicleId ?? ''}
              onChange={e => setSelectedVehicle(Number(e.target.value))}
              className="glass-input text-sm px-3 py-2"
            >
              {vehicles.map((v: Vehicle) => (
                <option key={v.id} value={v.id}>{v.display_name || v.vin}</option>
              ))}
            </select>
          ) : undefined
        }
      />

      {isLoading ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Skeleton className="h-56 sm:h-80" />
          <Skeleton className="h-56 sm:h-80" />
          <Skeleton className="h-56 sm:h-80" />
          <Skeleton className="h-56 sm:h-80" />
        </div>
      ) : !hasData ? (
        <FadeIn>
          <GlassPanel className="p-12 text-center">
            <Thermometer className="mx-auto h-12 w-12 text-neon-cyan opacity-40 mb-4" />
            <p className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>No temperature data yet</p>
            <p className="text-sm mt-2" style={{ color: 'var(--text-muted)' }}>
              Drive data with temperature readings is needed to show impact analysis.
            </p>
          </GlassPanel>
        </FadeIn>
      ) : (
        <>
          {/* Penalty Callout Cards */}
          <StaggerContainer className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StaggerItem>
              <GlassPanel className="p-4 text-center">
                <Snowflake className="mx-auto h-6 w-6 text-blue-400 mb-2" />
                <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Winter Penalty</p>
                <p className="text-xl font-bold text-blue-400">
                  {penalties.winter !== null ? `${penalties.winter > 0 ? '+' : ''}${penalties.winter}%` : 'N/A'}
                </p>
              </GlassPanel>
            </StaggerItem>
            <StaggerItem>
              <GlassPanel className="p-4 text-center">
                <Sun className="mx-auto h-6 w-6 text-amber-400 mb-2" />
                <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Summer Penalty</p>
                <p className="text-xl font-bold text-amber-400">
                  {penalties.summer !== null ? `${penalties.summer > 0 ? '+' : ''}${penalties.summer}%` : 'N/A'}
                </p>
              </GlassPanel>
            </StaggerItem>
            <StaggerItem>
              <GlassPanel className="p-4 text-center">
                <Activity className="mx-auto h-6 w-6 text-neon-green mb-2" />
                <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Optimal Efficiency</p>
                <p className="text-xl font-bold text-neon-green">
                  {penalties.optimalEff > 0 ? `${penalties.optimalEff.toFixed(1)}%` : 'N/A'}
                </p>
                <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>per 100km</p>
              </GlassPanel>
            </StaggerItem>
            <StaggerItem>
              <GlassPanel className="p-4 text-center">
                <Thermometer className="mx-auto h-6 w-6 text-neon-cyan mb-2" />
                <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Temp Buckets</p>
                <p className="text-xl font-bold text-neon-cyan">{data.efficiency.length}</p>
              </GlassPanel>
            </StaggerItem>
          </StaggerContainer>

          {/* Insight Banner */}
          {insight && (
            <FadeIn>
              <GlassPanel className="p-4 border-l-4 border-neon-green">
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  <span className="font-semibold text-neon-green">💡 Insight: </span>
                  {insight}
                </p>
              </GlassPanel>
            </FadeIn>
          )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Efficiency vs Temperature */}
            <FadeIn>
              <GlassPanel className="p-6">
                <h3 className="section-title mb-6 flex items-center gap-2">
                  <Thermometer className="h-4 w-4 text-neon-cyan" /> Efficiency vs Temperature
                </h3>
                <div className="h-48 sm:h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={efficiencyChartData}>
                      <defs>
                        <linearGradient id="tempEffGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      {chartGrid}
                      <XAxis dataKey="temp_bucket" tick={axisTickSm} tickLine={false} axisLine={false} />
                      <YAxis tick={axisTickSm} tickLine={false} axisLine={false}
                        label={{ value: '%/100km', angle: -90, position: 'insideLeft', style: { fill: 'var(--text-muted)', fontSize: 10 } }} />
                      <Tooltip content={<ChartTooltip />} />
                      <Area type="monotone" dataKey="avg_battery_pct_per_100km" name="Battery %/100km"
                        stroke="#10b981" fill="url(#tempEffGrad)" strokeWidth={2} animationDuration={800} />
                      <ReferenceLine y={penalties.optimalEff} stroke="#10b981" strokeDasharray="3 3" strokeOpacity={0.5} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </GlassPanel>
            </FadeIn>

            {/* Vampire Drain vs Temperature */}
            <FadeIn delay={0.1}>
              <GlassPanel className="p-6">
                <h3 className="section-title mb-6 flex items-center gap-2">
                  <TrendingDown className="h-4 w-4 text-neon-purple" /> Vampire Drain vs Temperature
                </h3>
                <div className="h-48 sm:h-64">
                  {data.vampire_drain.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.vampire_drain}>
                        {chartGrid}
                        <XAxis dataKey="temp_bucket" tick={axisTickSm} tickLine={false} axisLine={false} />
                        <YAxis tick={axisTickSm} tickLine={false} axisLine={false}
                          label={{ value: '%/hr', angle: -90, position: 'insideLeft', style: { fill: 'var(--text-muted)', fontSize: 10 } }} />
                        <Tooltip content={<ChartTooltip />} />
                        <Bar dataKey="avg_drain_rate" name="Drain Rate (%/hr)" radius={[3, 3, 0, 0]} animationDuration={800}>
                          {data.vampire_drain.map((entry, i) => {
                            const color = getBucketColor(entry.temp_bucket)
                            return <rect key={i} fill={color} fillOpacity={0.7} />
                          })}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex items-center justify-center h-full text-sm" style={{ color: 'var(--text-muted)' }}>
                      No vampire drain data available
                    </div>
                  )}
                </div>
              </GlassPanel>
            </FadeIn>

            {/* Monthly Trend */}
            <FadeIn delay={0.2}>
              <GlassPanel className="p-6 lg:col-span-2">
                <h3 className="section-title mb-6 flex items-center gap-2">
                  <Activity className="h-4 w-4 text-neon-amber" /> Monthly Temperature &amp; Efficiency Trend
                </h3>
                <div className="h-48 sm:h-64">
                  {monthlyData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={monthlyData}>
                        <defs>
                          <linearGradient id="monthEffGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#00f0ff" stopOpacity={0.8} />
                            <stop offset="100%" stopColor="#00f0ff" stopOpacity={0.3} />
                          </linearGradient>
                        </defs>
                        {chartGrid}
                        <XAxis dataKey="month" tick={axisTickSm} tickLine={false} axisLine={false} />
                        <YAxis yAxisId="left" tick={axisTickSm} tickLine={false} axisLine={false}
                          label={{ value: '%/100km', angle: -90, position: 'insideLeft', style: { fill: 'var(--text-muted)', fontSize: 10 } }} />
                        <YAxis yAxisId="right" orientation="right" tick={axisTickSm} tickLine={false} axisLine={false}
                          label={{ value: '°C', angle: 90, position: 'insideRight', style: { fill: 'var(--text-muted)', fontSize: 10 } }} />
                        <Tooltip content={<ChartTooltip />} />
                        <Bar yAxisId="left" dataKey="avg_efficiency" name="Efficiency (%/100km)"
                          fill="url(#monthEffGrad)" fillOpacity={0.6} radius={[3, 3, 0, 0]} animationDuration={800} />
                        <Line yAxisId="right" type="monotone" dataKey="avg_temp" name="Avg Temp (°C)"
                          stroke="#f59e0b" strokeWidth={2} dot={{ r: 3, fill: '#f59e0b' }} animationDuration={800} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex items-center justify-center h-full text-sm" style={{ color: 'var(--text-muted)' }}>
                      Not enough monthly data yet
                    </div>
                  )}
                </div>
              </GlassPanel>
            </FadeIn>
          </div>

          {/* Detailed Efficiency Table */}
          <FadeIn delay={0.3}>
            <GlassPanel className="p-6">
              <h3 className="section-title mb-4 flex items-center gap-2">
                <Thermometer className="h-4 w-4 text-neon-cyan" /> Efficiency by Temperature Range
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b" style={{ borderColor: 'var(--glass-border)' }}>
                      <th className="text-left py-2 px-3 font-medium" style={{ color: 'var(--text-muted)' }}>Temp Range</th>
                      <th className="text-right py-2 px-3 font-medium" style={{ color: 'var(--text-muted)' }}>Drives</th>
                      <th className="text-right py-2 px-3 font-medium" style={{ color: 'var(--text-muted)' }}>Avg Dist (km)</th>
                      <th className="text-right py-2 px-3 font-medium" style={{ color: 'var(--text-muted)' }}>Avg Duration</th>
                      <th className="text-right py-2 px-3 font-medium" style={{ color: 'var(--text-muted)' }}>Battery %/100km</th>
                      <th className="text-right py-2 px-3 font-medium" style={{ color: 'var(--text-muted)' }}>Avg Temp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.efficiency.map((b: TempEfficiencyBucket) => (
                      <tr key={b.temp_bucket} className="border-b" style={{ borderColor: 'var(--glass-border)' }}>
                        <td className="py-2 px-3 font-medium" style={{ color: getBucketColor(b.temp_bucket) }}>
                          {b.temp_bucket}
                        </td>
                        <td className="text-right py-2 px-3" style={{ color: 'var(--text-secondary)' }}>{b.drive_count}</td>
                        <td className="text-right py-2 px-3" style={{ color: 'var(--text-secondary)' }}>{b.avg_distance_km.toFixed(1)}</td>
                        <td className="text-right py-2 px-3" style={{ color: 'var(--text-secondary)' }}>{b.avg_duration_min.toFixed(0)} min</td>
                        <td className="text-right py-2 px-3 font-bold" style={{ color: getBucketColor(b.temp_bucket) }}>
                          {b.avg_battery_pct_per_100km.toFixed(2)}
                        </td>
                        <td className="text-right py-2 px-3" style={{ color: 'var(--text-secondary)' }}>{b.avg_temp.toFixed(1)}°C</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </GlassPanel>
          </FadeIn>
        </>
      )}
    </div>
  )
}
