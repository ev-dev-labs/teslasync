import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getVehicles, getBatteryReport, getMileageStats } from '../api'
import { PageHeader, GlassPanel, FadeIn, Skeleton } from '../components/ui'
import { useSettings } from '../hooks/useSettings'
import { Target, Battery, Thermometer, TrendingDown, Gauge } from 'lucide-react'
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine
} from 'recharts'

interface TooltipPayload { name: string; value: number; color?: string; stroke?: string }
function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipPayload[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="glass-panel p-3 text-xs" style={{ background: 'var(--surface-2)', borderColor: 'var(--glass-border)' }}>
      <p style={{ color: 'var(--text-secondary)' }} className="mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: 'var(--text-primary)' }}>
          <span style={{ color: p.color || p.stroke }}>●</span> {p.name}: {typeof p.value === 'number' ? p.value.toFixed(1) : p.value}
        </p>
      ))}
    </div>
  )
}

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
      degradation: projectedDeg.toFixed(1),
    }
  })

  const daysOfRange = avgDailyKm > 0 ? (currentRange / avgDailyKm).toFixed(0) : '–'

  return (
    <FadeIn>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0 mb-6 sm:mb-8">
        <PageHeader title="Projected Range" subtitle="Range estimation based on degradation and conditions" icon={<Target className="h-7 w-7 text-neon-blue" />} />
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

      {/* Summary Cards */}
      {loadingBattery ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mb-6 sm:mb-8">
          {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mb-6 sm:mb-8">
          {[
            { label: 'Current Range', value: `${convertDistance(currentRange).toFixed(0)} ${distanceUnit}`, sub: '', icon: Gauge, color: '#00f0ff' },
            { label: 'When New', value: `${convertDistance(newRange).toFixed(0)} ${distanceUnit}`, sub: '', icon: Battery, color: '#10b981' },
            { label: 'Degradation', value: `${(battery?.degradation_pct ?? 0).toFixed(1)}%`, sub: `${battery?.total_cycles ?? 0} cycles`, icon: TrendingDown, color: '#f59e0b' },
            { label: 'Health Score', value: `${battery?.health_score ?? 0}/100`, sub: `${(battery?.current_capacity_pct ?? 0).toFixed(1)}% capacity`, icon: Battery, color: '#8b5cf6' },
            { label: 'Days of Range', value: daysOfRange, sub: `at ${convertDistance(avgDailyKm).toFixed(0)} ${distanceUnit}/day avg`, icon: Target, color: '#ec4899' },
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-6">
        {/* Historical Range Trend */}
        <GlassPanel className="p-4 sm:p-6">
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Historical Range Trend</h3>
          {trendData.length === 0 ? (
            <div className="flex items-center justify-center h-48 sm:h-64 text-[var(--text-muted)] text-sm">No trend data</div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
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
        </GlassPanel>

        {/* Temperature Impact */}
        <GlassPanel className="p-4 sm:p-6">
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
            <Thermometer className="h-4 w-4 inline mr-1" /> Temperature Impact on Range
          </h3>
          <ResponsiveContainer width="100%" height={280}>
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
        </GlassPanel>
      </div>

      {/* Projected Range */}
      <GlassPanel className="p-4 sm:p-6">
        <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>12-Month Range Projection</h3>
        {projectionData.length === 0 ? (
          <div className="flex items-center justify-center h-48 sm:h-64 text-[var(--text-muted)] text-sm">No projection data</div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
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
      </GlassPanel>
    </FadeIn>
  )
}
