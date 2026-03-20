import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getVehicles, getDailyMileage, getMonthlyMileage, getMileageStats } from '../api'
import { PageHeader, GlassPanel, FadeIn, Skeleton } from '../components/ui'
import { Milestone, TrendingUp, Calendar, MapPin } from 'lucide-react'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts'

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
    miles: d.distance_km * 0.621371,
    km: d.distance_km,
  })).reverse()

  const monthlyChart = (monthly ?? []).map(m => ({
    month: m.month,
    miles: m.distance * 0.621371,
    km: m.distance,
  }))

  const statCards = stats ? [
    { label: 'Total Distance', value: `${(stats.total_distance * 0.621371).toFixed(0)} mi`, sub: `${stats.total_distance.toFixed(0)} km`, icon: MapPin, color: '#00f0ff' },
    { label: 'Daily Average', value: `${(stats.avg_daily * 0.621371).toFixed(1)} mi/day`, sub: `${stats.avg_daily.toFixed(1)} km/day`, icon: TrendingUp, color: '#10b981' },
    { label: 'Best Day', value: `${(stats.max_daily * 0.621371).toFixed(0)} mi`, sub: `${stats.max_daily.toFixed(0)} km`, icon: Milestone, color: '#f59e0b' },
    { label: 'Tracked Days', value: `${stats.days_tracked}`, sub: 'days', icon: Calendar, color: '#8b5cf6' },
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
              <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{card.value}</p>
              <p className="text-[10px] text-[var(--text-muted)] mt-1">{card.sub}</p>
            </GlassPanel>
          ))}
        </div>
      )}

      {/* Daily Mileage Area Chart */}
      <GlassPanel className="p-4 sm:p-6 mb-6">
        <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Daily Mileage</h3>
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
              <Area type="monotone" dataKey="km" stroke="#00f0ff" fill="url(#mileageGrad)" name="Distance (km)" />
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
              <Bar dataKey="km" fill="#00f0ff" name="Total (km)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </GlassPanel>
    </FadeIn>
  )
}
