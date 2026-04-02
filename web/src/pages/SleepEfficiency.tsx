import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getVehicles, getSleepAnalytics, Vehicle } from '../api'
import { PageHeader, GlassPanel, FadeIn, StaggerContainer, StaggerItem, Skeleton } from '../components/ui'
import { Moon, Shield, Eye, Clock, Zap, DollarSign, Thermometer } from 'lucide-react'
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, Legend,
} from 'recharts'
import { ChartTooltip, axisTickSm, chartGrid, NEON_COLORS } from '../components/Charts'

const STATE_COLORS: Record<string, string> = {
  asleep: '#a855f7',
  online: '#00f0ff',
  driving: '#10b981',
  charging: '#f59e0b',
  updating: '#ec4899',
  suspended: '#6366f1',
}

const STATE_LABELS: Record<string, string> = {
  asleep: 'Sleeping',
  online: 'Online/Idle',
  driving: 'Driving',
  charging: 'Charging',
  updating: 'Updating',
  suspended: 'Suspended',
}

export default function SleepEfficiency() {
  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: getVehicles })
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null)
  const [days, setDays] = useState(30)
  const vehicleId = selectedVehicle ?? vehicles?.[0]?.id ?? null

  const { data: sleep, isLoading } = useQuery({
    queryKey: ['sleep-analytics', vehicleId, days],
    queryFn: () => getSleepAnalytics(vehicleId!, days),
    enabled: vehicleId !== null,
  })

  const fmt = (v: number, decimals = 2) => v.toFixed(decimals)

  const pieData = sleep?.state_distribution.map(s => ({
    name: STATE_LABELS[s.state] || s.state,
    value: Math.round(s.total_minutes),
    color: STATE_COLORS[s.state] || NEON_COLORS[0],
    hours: (s.total_minutes / 60).toFixed(1),
  })) ?? []

  const sentryOn = sleep?.sentry_comparison.find(s => s.sentry_mode)
  const sentryOff = sleep?.sentry_comparison.find(s => !s.sentry_mode)

  const comparisonData = [
    {
      name: 'Drain Rate (%/hr)',
      sentry_on: sentryOn?.avg_drain_rate ?? 0,
      sentry_off: sentryOff?.avg_drain_rate ?? 0,
    },
    {
      name: 'Avg Battery Lost (%)',
      sentry_on: sentryOn?.avg_battery_lost ?? 0,
      sentry_off: sentryOff?.avg_battery_lost ?? 0,
    },
  ]

  return (
    <div className="space-y-8">
      <PageHeader
        title="Sleep Efficiency"
        subtitle="Analyze vehicle sleep patterns, vampire drain, and sentry mode costs"
        icon={<Moon className="h-5 w-5 text-neon-purple" />}
        actions={
          <div className="flex items-center gap-3">
            <select
              value={days}
              onChange={e => setDays(Number(e.target.value))}
              className="glass-input text-sm px-3 py-2"
            >
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
              <option value={180}>180 days</option>
            </select>
            {vehicles && vehicles.length > 1 && (
              <select
                value={vehicleId ?? ''}
                onChange={e => setSelectedVehicle(Number(e.target.value))}
                className="glass-input text-sm px-3 py-2"
              >
                {vehicles.map((v: Vehicle) => (
                  <option key={v.id} value={v.id}>{v.display_name}</option>
                ))}
              </select>
            )}
          </div>
        }
      />

      {isLoading ? (
        <Skeleton className="h-64" />
      ) : sleep ? (
        <>
          {/* Key metric cards */}
          <StaggerContainer className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StaggerItem>
              <GlassPanel className="p-5" glow="purple" hover>
                <div className="flex items-center gap-2 mb-3">
                  <Moon className="h-4 w-4 text-neon-purple" />
                  <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">Sleep Efficiency</span>
                </div>
                <p className="text-2xl font-bold text-neon-purple">{fmt(sleep.sleep_efficiency_pct, 1)}%</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">Time spent sleeping vs total</p>
              </GlassPanel>
            </StaggerItem>

            <StaggerItem>
              <GlassPanel className="p-5" hover>
                <div className="flex items-center gap-2 mb-3">
                  <Clock className="h-4 w-4 text-neon-cyan" />
                  <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">Avg Time to Sleep</span>
                </div>
                <p className="text-2xl font-bold text-neon-cyan">{fmt(sleep.time_to_sleep_avg_min, 0)} min</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">After going idle</p>
              </GlassPanel>
            </StaggerItem>

            <StaggerItem>
              <GlassPanel className="p-5" hover>
                <div className="flex items-center gap-2 mb-3">
                  <Eye className="h-4 w-4 text-amber-400" />
                  <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">Sentry Drain Rate</span>
                </div>
                <p className="text-2xl font-bold text-amber-400">{fmt(sleep.sentry_on_drain_rate, 2)}%/hr</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">vs {fmt(sleep.sentry_off_drain_rate, 2)}%/hr without</p>
              </GlassPanel>
            </StaggerItem>

            <StaggerItem>
              <GlassPanel className="p-5" glow="red" hover>
                <div className="flex items-center gap-2 mb-3">
                  <DollarSign className="h-4 w-4 text-neon-red" />
                  <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">Sentry Monthly Cost</span>
                </div>
                <p className="text-2xl font-bold text-neon-red">${fmt(sleep.sentry_monthly_cost, 2)}</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">{fmt(sleep.sentry_monthly_kwh, 1)} kWh/month</p>
              </GlassPanel>
            </StaggerItem>
          </StaggerContainer>

          {/* Donut chart + Sentry comparison */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <FadeIn>
              <GlassPanel className="p-6">
                <h3 className="section-title mb-6 flex items-center gap-2">
                  <Moon className="h-4 w-4 text-neon-purple" /> State Distribution
                </h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={90}
                        paddingAngle={3}
                        dataKey="value"
                        nameKey="name"
                        animationDuration={800}
                      >
                        {pieData.map((entry, i) => (
                          <Cell key={`cell-${i}`} fill={entry.color} stroke="transparent" />
                        ))}
                      </Pie>
                      <Tooltip content={<ChartTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex flex-wrap justify-center gap-3 mt-4">
                  {pieData.map(entry => (
                    <div key={entry.name} className="flex items-center gap-1.5 text-xs">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
                      <span className="text-[var(--text-secondary)]">{entry.name}</span>
                      <span className="text-[var(--text-muted)]">{entry.hours}h</span>
                    </div>
                  ))}
                </div>
              </GlassPanel>
            </FadeIn>

            <FadeIn delay={0.1}>
              <GlassPanel className="p-6">
                <h3 className="section-title mb-6 flex items-center gap-2">
                  <Shield className="h-4 w-4 text-amber-400" /> Sentry vs No-Sentry
                </h3>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={comparisonData}>
                      {chartGrid}
                      <XAxis dataKey="name" tick={axisTickSm} tickLine={false} axisLine={false} />
                      <YAxis tick={axisTickSm} tickLine={false} axisLine={false} />
                      <Tooltip content={<ChartTooltip />} />
                      <Legend wrapperStyle={{ fontSize: 11, color: 'var(--text-muted)' }} />
                      <Bar dataKey="sentry_on" name="Sentry On" fill="#f59e0b" radius={[4, 4, 0, 0]} animationDuration={800} />
                      <Bar dataKey="sentry_off" name="Sentry Off" fill="#a855f7" radius={[4, 4, 0, 0]} animationDuration={800} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Sentry cost callout */}
                <div className="mt-4 rounded-xl bg-amber-500/10 border border-amber-500/20 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Eye className="h-4 w-4 text-amber-400" />
                    <span className="text-sm font-medium text-amber-300">Monthly Sentry Mode Impact</span>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div>
                      <p className="text-lg font-bold text-amber-400">{fmt(sleep.sentry_extra_drain_rate, 2)}%</p>
                      <p className="text-xs text-[var(--text-muted)]">Extra drain/hr</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-amber-400">{fmt(sleep.sentry_extra_monthly_kwh, 1)} kWh</p>
                      <p className="text-xs text-[var(--text-muted)]">Extra monthly</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-neon-red">${fmt(sleep.sentry_extra_monthly_cost, 2)}</p>
                      <p className="text-xs text-[var(--text-muted)]">Extra cost/mo</p>
                    </div>
                  </div>
                </div>
              </GlassPanel>
            </FadeIn>
          </div>

          {/* Recent drain events table */}
          <FadeIn delay={0.2}>
            <GlassPanel className="p-6">
              <h3 className="section-title mb-6 flex items-center gap-2">
                <Zap className="h-4 w-4 text-neon-cyan" /> Recent Drain Events
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-white/[0.06] text-[var(--text-muted)] text-xs uppercase tracking-wider">
                    <tr>
                      <th className="pb-3 pr-4">Date</th>
                      <th className="pb-3 pr-4">Duration</th>
                      <th className="pb-3 pr-4">Battery Lost</th>
                      <th className="pb-3 pr-4">Drain Rate</th>
                      <th className="pb-3 pr-4">Sentry</th>
                      <th className="pb-3 pr-4">Temp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.03]">
                    {sleep.recent_events.map(event => (
                      <tr key={event.id} className="text-gray-300 hover:bg-white/[0.02] transition-colors">
                        <td className="py-3 pr-4 text-xs">
                          {new Date(event.start_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                          <span className="text-[var(--text-muted)] ml-1">
                            {new Date(event.start_date).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </td>
                        <td className="py-3 pr-4">{fmt(event.duration_hours, 1)}h</td>
                        <td className="py-3 pr-4">
                          <span className="text-neon-red">{fmt(event.battery_lost, 1)}%</span>
                        </td>
                        <td className="py-3 pr-4">
                          <span className={event.drain_rate > 1.5 ? 'text-neon-red' : 'text-neon-green'}>
                            {fmt(event.drain_rate, 2)}%/hr
                          </span>
                        </td>
                        <td className="py-3 pr-4">
                          {event.sentry_mode ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-400 ring-1 ring-amber-500/20">
                              <Eye className="h-3 w-3" /> On
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-purple-500/10 px-2 py-0.5 text-xs text-purple-400 ring-1 ring-purple-500/20">
                              <Moon className="h-3 w-3" /> Off
                            </span>
                          )}
                        </td>
                        <td className="py-3 pr-4">
                          {event.outside_temp != null ? (
                            <span className="flex items-center gap-1">
                              <Thermometer className="h-3 w-3 text-[var(--text-muted)]" />
                              {fmt(event.outside_temp, 1)}°C
                            </span>
                          ) : (
                            <span className="text-[var(--text-muted)]">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {sleep.recent_events.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-[var(--text-muted)]">
                          No drain events recorded yet
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </GlassPanel>
          </FadeIn>
        </>
      ) : (
        <GlassPanel className="p-8 text-center">
          <p className="text-[var(--text-muted)]">No sleep data available. Data will appear after your vehicle records sleep/wake events.</p>
        </GlassPanel>
      )}
    </div>
  )
}
