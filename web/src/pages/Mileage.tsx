import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getVehicles, getDailyMileage, getMonthlyMileage, getMileageStats } from '../api'
import { PageHeader, GlassPanel, FadeIn, Skeleton, MetricCard, ChartContainer, Select } from '../components/ui'
import { Milestone, TrendingUp, Calendar, MapPin, ArrowUp, ArrowDown } from 'lucide-react'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts'
import { useSettings } from '../hooks/useSettings'
import { formatDateShort } from '../lib/dateFormat'
import { ChartTooltip } from '../components/Charts'
import { fmtNumber, fmtInt } from '../lib/numberFormat'

export default function Mileage() {
  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: getVehicles })
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null)
  const vehicleId = selectedVehicle ?? vehicles?.[0]?.id ?? null
  const { convertDistance, distanceUnit } = useSettings()

  const { data: daily, isLoading } = useQuery({
    queryKey: ['daily-mileage', vehicleId],
    queryFn: () => getDailyMileage(vehicleId!),
    enabled: vehicleId !== null,
  })

  const { data: monthly } = useQuery({
    queryKey: ['monthly-mileage', vehicleId],
    queryFn: () => getMonthlyMileage(vehicleId!),
    enabled: vehicleId !== null,
  })

  const { data: stats } = useQuery({
    queryKey: ['mileage-stats', vehicleId],
    queryFn: () => getMileageStats(vehicleId!),
    enabled: vehicleId !== null,
  })

  const dailyChart = (daily ?? []).map(d => ({
    date: formatDateShort(d.date),
    distance: convertDistance(d.distance_km),
  })).reverse()

  // Cumulative odometer chart from daily data
  const cumulativeChart = useMemo(() => {
    if (!daily || daily.length === 0) return []
    const sorted = [...daily].reverse()
    let cumulative = 0
    return sorted.map(d => {
      cumulative += d.distance_km
      return {
        date: formatDateShort(d.date),
        odometer: convertDistance(d.odometer_end || cumulative),
        cumulative: convertDistance(cumulative),
      }
    })
  }, [daily, convertDistance])

  const monthlyChart = (monthly ?? []).map(m => ({
    month: m.month,
    distance: convertDistance(m.distance),
    drives: m.drives,
  }))

  // Find most and least active months
  const mostActiveMonth = useMemo(() => {
    if (!monthly || monthly.length === 0) return null
    return [...monthly].sort((a, b) => b.distance - a.distance)[0]
  }, [monthly])
  const leastActiveMonth = useMemo(() => {
    if (!monthly || monthly.length < 2) return null
    return [...monthly].filter(m => m.distance > 0).sort((a, b) => a.distance - b.distance)[0]
  }, [monthly])

  const statCards = stats ? [
    { label: 'Total Distance', value: fmtInt(convertDistance(stats.total_distance)), unit: distanceUnit, icon: MapPin, color: '#00f0ff' },
    { label: 'Daily Average', value: fmtNumber(convertDistance(stats.avg_daily)), unit: `${distanceUnit}/day`, icon: TrendingUp, color: '#10b981' },
    { label: 'Best Day', value: fmtInt(convertDistance(stats.max_daily)), unit: distanceUnit, icon: Milestone, color: '#f59e0b' },
    { label: 'Tracked Days', value: `${stats.days_tracked}`, unit: 'days', icon: Calendar, color: '#8b5cf6' },
  ] : []

  return (
    <FadeIn>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0 mb-6 sm:mb-8">
        <PageHeader title="Mileage" subtitle="Daily and monthly distance tracking" icon={<Milestone className="h-7 w-7 text-neon-blue" />} />
        {vehicles && vehicles.length > 1 && (
          <Select
            value={String(vehicleId ?? '')}
            onChange={e => setSelectedVehicle(Number(e.target.value))}
            options={vehicles.map(v => ({ value: String(v.id), label: v.display_name || v.vin }))}
          />
        )}
      </div>

      {/* Stats Cards */}
      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6 sm:mb-8">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6 sm:mb-8">
          {statCards.map(card => (
            <MetricCard
              key={card.label}
              label={card.label}
              value={card.value}
              icon={<card.icon className="h-4 w-4" />}
              color={card.color === '#00f0ff' ? 'cyan' : card.color === '#10b981' ? 'green' : card.color === '#f59e0b' ? 'amber' : 'purple'}
              subtitle={card.unit}
            />
          ))}
        </div>
      )}

      {/* Most/Least Active Month */}
      {(mostActiveMonth || leastActiveMonth) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
          {mostActiveMonth && (
            <GlassPanel className="p-4 flex items-center gap-3">
              <div className="rounded-lg p-2 bg-neon-green/10"><ArrowUp className="h-4 w-4 text-neon-green" /></div>
              <div>
                <p className="text-xs text-[var(--text-secondary)]">Most Active Month</p>
                <p className="text-sm font-bold text-[var(--text-primary)]">{mostActiveMonth.month}</p>
                <p className="text-[10px] text-neon-green">{fmtInt(convertDistance(mostActiveMonth.distance))} {distanceUnit} · {mostActiveMonth.drives} drives</p>
              </div>
            </GlassPanel>
          )}
          {leastActiveMonth && (
            <GlassPanel className="p-4 flex items-center gap-3">
              <div className="rounded-lg p-2 bg-neon-amber/10"><ArrowDown className="h-4 w-4 text-neon-amber" /></div>
              <div>
                <p className="text-xs text-[var(--text-secondary)]">Least Active Month</p>
                <p className="text-sm font-bold text-[var(--text-primary)]">{leastActiveMonth.month}</p>
                <p className="text-[10px] text-neon-amber">{fmtInt(convertDistance(leastActiveMonth.distance))} {distanceUnit} · {leastActiveMonth.drives} drives</p>
              </div>
            </GlassPanel>
          )}
        </div>
      )}

      {/* Cumulative Mileage Area Chart */}
      {cumulativeChart.length > 0 && (
        <ChartContainer title={`Cumulative Mileage (${distanceUnit})`} height={280} className="mb-6">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={cumulativeChart}>
              <defs>
                <linearGradient id="cumulGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#a855f7" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="cumulative" stroke="#a855f7" fill="url(#cumulGrad)" name={`Cumulative (${distanceUnit})`} strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartContainer>
      )}

      {/* Daily Mileage Area Chart */}
      <ChartContainer title="Daily Distance" height={280} className="mb-6">
        {dailyChart.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[var(--text-muted)] text-sm">No daily data</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={dailyChart}>
              <defs>
                <linearGradient id="mileageGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#00f0ff" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#00f0ff" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="distance" stroke="#00f0ff" fill="url(#mileageGrad)" name={`Distance (${distanceUnit})`} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </ChartContainer>

      {/* Monthly Bar Chart */}
      <ChartContainer title="Monthly Mileage" height={280}>
        {monthlyChart.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[var(--text-muted)] text-sm">No monthly data</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthlyChart}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
              <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="distance" fill="#00f0ff" name={`Distance (${distanceUnit})`} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartContainer>
    </FadeIn>
  )
}
