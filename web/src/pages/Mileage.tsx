import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getVehicles, getDailyMileage, getMonthlyMileage, getMileageStats } from '../api'
import { PageHeader, GlassPanel, FadeIn, Skeleton } from '../components/ui'
import { AnimatedNumber } from '../components/Widgets'
import { Milestone, TrendingUp, Calendar, MapPin, ArrowUp, ArrowDown } from 'lucide-react'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts'
import { useSettings } from '../hooks/useSettings'

interface TooltipPayload { name: string; value: number; color?: string; fill?: string }
function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipPayload[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="glass-panel p-3 text-xs" style={{ background: 'var(--surface-2)', borderColor: 'var(--glass-border)' }}>
      <p style={{ color: 'var(--text-secondary)' }} className="mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: 'var(--text-primary)' }}>
          <span style={{ color: p.color || p.fill }}>●</span> {p.name}: {typeof p.value === 'number' ? p.value.toFixed(1) : p.value}
        </p>
      ))}
    </div>
  )
}

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
    date: new Date(d.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
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
        date: new Date(d.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
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
    { label: 'Total Distance', value: convertDistance(stats.total_distance).toFixed(0), unit: distanceUnit, icon: MapPin, color: '#00f0ff' },
    { label: 'Daily Average', value: convertDistance(stats.avg_daily).toFixed(1), unit: `${distanceUnit}/day`, icon: TrendingUp, color: '#10b981' },
    { label: 'Best Day', value: convertDistance(stats.max_daily).toFixed(0), unit: distanceUnit, icon: Milestone, color: '#f59e0b' },
    { label: 'Tracked Days', value: `${stats.days_tracked}`, unit: 'days', icon: Calendar, color: '#8b5cf6' },
  ] : []

  return (
    <FadeIn>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0 mb-6 sm:mb-8">
        <PageHeader title="Mileage" subtitle="Daily and monthly distance tracking" icon={<Milestone className="h-7 w-7 text-neon-blue" />} />
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

      {/* Stats Cards */}
      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6 sm:mb-8">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6 sm:mb-8">
          {statCards.map(card => (
            <GlassPanel key={card.label} className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <card.icon className="h-4 w-4" style={{ color: card.color }} />
                <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{card.label}</span>
              </div>
              <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
                <AnimatedNumber value={Number(card.value)} decimals={card.label === 'Daily Average' ? 1 : 0} />
              </p>
              <p className="text-[10px] text-[var(--text-muted)] mt-1">{card.unit}</p>
            </GlassPanel>
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
                <p className="text-[10px] text-neon-green">{convertDistance(mostActiveMonth.distance).toFixed(0)} {distanceUnit} · {mostActiveMonth.drives} drives</p>
              </div>
            </GlassPanel>
          )}
          {leastActiveMonth && (
            <GlassPanel className="p-4 flex items-center gap-3">
              <div className="rounded-lg p-2 bg-neon-amber/10"><ArrowDown className="h-4 w-4 text-neon-amber" /></div>
              <div>
                <p className="text-xs text-[var(--text-secondary)]">Least Active Month</p>
                <p className="text-sm font-bold text-[var(--text-primary)]">{leastActiveMonth.month}</p>
                <p className="text-[10px] text-neon-amber">{convertDistance(leastActiveMonth.distance).toFixed(0)} {distanceUnit} · {leastActiveMonth.drives} drives</p>
              </div>
            </GlassPanel>
          )}
        </div>
      )}

      {/* Cumulative Mileage Area Chart */}
      {cumulativeChart.length > 0 && (
        <GlassPanel className="p-4 sm:p-6 mb-6">
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Cumulative Mileage ({distanceUnit})</h3>
          <ResponsiveContainer width="100%" height={280}>
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
        </GlassPanel>
      )}

      {/* Daily Mileage Area Chart */}
      <GlassPanel className="p-4 sm:p-6 mb-6">
        <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Daily Distance</h3>
        {dailyChart.length === 0 ? (
          <div className="flex items-center justify-center h-48 sm:h-64 text-[var(--text-muted)] text-sm">No daily data</div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
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
      </GlassPanel>

      {/* Monthly Bar Chart */}
      <GlassPanel className="p-4 sm:p-6">
        <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Monthly Mileage</h3>
        {monthlyChart.length === 0 ? (
          <div className="flex items-center justify-center h-48 sm:h-64 text-[var(--text-muted)] text-sm">No monthly data</div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={monthlyChart}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
              <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="distance" fill="#00f0ff" name={`Distance (${distanceUnit})`} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </GlassPanel>
    </FadeIn>
  )
}
