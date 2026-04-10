import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getVehicles, getBatteryReport, getMileageStats } from '../api'
import { PageHeader, FadeIn, Skeleton, MetricCard, ChartContainer, Select } from '../components/ui'
import { useSettings } from '../hooks/useSettings'
import { Target, Battery, TrendingDown, Gauge } from 'lucide-react'
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine
} from 'recharts'
import { ChartTooltip } from '../components/Charts'
import { fmtNumber, fmtInt } from '../lib/numberFormat'

export default function ProjectedRange() {
  const { convertDistance, convertTemp, distanceUnit, tempUnit } = useSettings()
  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: getVehicles })
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null)
  const vehicleId = selectedVehicle ?? vehicles?.[0]?.id ?? null

  const { data: battery, isLoading: loadingBattery } = useQuery({
    queryKey: ['battery-report', vehicleId],
    queryFn: () => getBatteryReport(vehicleId!),
    enabled: vehicleId !== null,
  })

  const { data: mileageStats } = useQuery({
    queryKey: ['mileage-stats', vehicleId],
    queryFn: () => getMileageStats(vehicleId!),
    enabled: vehicleId !== null,
  })

  // Projected range based on battery degradation trend
  const trendData = (battery?.monthly_trend ?? []).map(m => ({
    month: m.month,
    range_km: convertDistance(m.range_km),
    capacity_pct: m.capacity_pct,
  }))

  // Simple linear projection: take degradation rate and project forward
  const degradationRate = battery ? battery.degradation_pct / Math.max(1, (battery.total_cycles || 1)) : 0
  const currentRange = battery?.estimated_range_current_km ?? 0
  const newRange = battery?.estimated_range_new_km ?? 0

  // Daily avg driving distance for "days of range" calc
  const avgDailyKm = mileageStats?.avg_daily ?? 0

  // Range at different temperatures (simplified model)
  const temps = [-20, -10, 0, 10, 20, 30, 40]
  const tempRangeData = temps.map(t => {
    // Cold weather reduces range ~30% at -20C, ~0% at 20C, heat slightly reduces at 40C
    let factor = 1.0
    if (t < 20) factor = 1.0 - (20 - t) * 0.015
    else if (t > 30) factor = 1.0 - (t - 30) * 0.005
    factor = Math.max(0.5, Math.min(1.0, factor))
    return { temp: `${Math.round(convertTemp(t))}${tempUnit}`, range_km: Math.round(convertDistance(currentRange * factor)), factor: Math.round(factor * 100) }
  })

  // Project future range (12 months)
  const projectionData = Array.from({ length: 13 }, (_, i) => {
    const monthsAhead = i
    const projectedDeg = Math.min(100, (battery?.degradation_pct ?? 0) + degradationRate * 50 * monthsAhead)
    const projectedRange = newRange * (1 - projectedDeg / 100)
    const now = new Date()
    now.setMonth(now.getMonth() + monthsAhead)
    return {
      month: now.toLocaleDateString(undefined, { year: 'numeric', month: 'short' }),
      range_km: Math.round(convertDistance(projectedRange)),
      degradation: fmtNumber(projectedDeg),
    }
  })

  const daysOfRange = avgDailyKm > 0 ? fmtInt(currentRange / avgDailyKm) : '–'

  return (
    <FadeIn>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0 mb-6 sm:mb-8">
        <PageHeader title="Projected Range" subtitle="Range estimation based on degradation and conditions" icon={<Target className="h-7 w-7 text-neon-blue" />} />
        {vehicles && vehicles.length > 1 && (
          <Select
            value={String(vehicleId ?? '')}
            onChange={e => setSelectedVehicle(Number(e.target.value))}
            options={vehicles.map(v => ({ value: String(v.id), label: v.display_name || v.vin }))}
          />
        )}
      </div>

      {/* Summary Cards */}
      {loadingBattery ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mb-6 sm:mb-8">
          {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mb-6 sm:mb-8">
          {([
            { label: 'Current Range', value: `${fmtInt(convertDistance(currentRange))} ${distanceUnit}`, subtitle: '', icon: Gauge, color: 'cyan' as const },
            { label: 'When New', value: `${fmtInt(convertDistance(newRange))} ${distanceUnit}`, subtitle: '', icon: Battery, color: 'green' as const },
            { label: 'Degradation', value: `${fmtNumber(battery?.degradation_pct ?? 0)}%`, subtitle: `${battery?.total_cycles ?? 0} cycles`, icon: TrendingDown, color: 'amber' as const },
            { label: 'Health Score', value: `${battery?.health_score ?? 0}/100`, subtitle: `${fmtNumber(battery?.current_capacity_pct ?? 0)}% capacity`, icon: Battery, color: 'purple' as const },
            { label: 'Days of Range', value: daysOfRange, subtitle: `at ${fmtInt(convertDistance(avgDailyKm))} ${distanceUnit}/day avg`, icon: Target, color: 'red' as const },
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-6">
        {/* Historical Range Trend */}
        <ChartContainer title="Historical Range Trend" height={280}>
          {trendData.length === 0 ? (
            <div className="flex items-center justify-center h-full text-[var(--text-muted)] text-sm">No trend data</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                <Tooltip content={<ChartTooltip />} />
                <Line type="monotone" dataKey="range_km" stroke="#00f0ff" strokeWidth={2} dot={{ r: 3 }} name={`Range (${distanceUnit})`} />
                <ReferenceLine y={newRange} stroke="#10b981" strokeDasharray="5 5" label={{ value: 'New', fill: '#10b981', fontSize: 10 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartContainer>

        {/* Temperature Impact */}
        <ChartContainer title="Temperature Impact on Range" height={280}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={tempRangeData}>
              <defs>
                <linearGradient id="tempGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
              <XAxis dataKey="temp" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <Tooltip content={<ChartTooltip />} />
              <ReferenceLine y={currentRange} stroke="#00f0ff" strokeDasharray="5 5" label={{ value: 'Ideal', fill: '#00f0ff', fontSize: 10 }} />
              <Area type="monotone" dataKey="range_km" stroke="#f59e0b" fill="url(#tempGrad)" strokeWidth={2} name={`Range (${distanceUnit})`} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartContainer>
      </div>

      {/* Projected Range */}
      <ChartContainer title="12-Month Range Projection" height={300}>
        {projectionData.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[var(--text-muted)] text-sm">No projection data</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={projectionData}>
              <defs>
                <linearGradient id="projGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
              <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <Tooltip content={<ChartTooltip />} />
              <ReferenceLine y={currentRange} stroke="#00f0ff" strokeDasharray="5 5" label={{ value: 'Current', fill: '#00f0ff', fontSize: 10 }} />
              <Area type="monotone" dataKey="range_km" stroke="#8b5cf6" fill="url(#projGrad)" strokeWidth={2} name={`Projected Range (${distanceUnit})`} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </ChartContainer>
    </FadeIn>
  )
}
