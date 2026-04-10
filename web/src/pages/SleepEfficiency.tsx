import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getVehicles, getSleepAnalytics, Vehicle, SleepAnalytics } from '../api'
import { PageHeader, GlassPanel, FadeIn, StaggerContainer, StaggerItem, Skeleton, MetricCard, ChartContainer, Select, DataTable, type Column } from '../components/ui'
import { Moon, Eye, Clock, Zap, DollarSign, Thermometer } from 'lucide-react'
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, Legend,
} from 'recharts'
import { ChartTooltip, axisTickSm, chartGrid } from '../components/Charts'
import { CHART_COLORS } from '../lib/colors'
import { formatDateShort, formatTime } from '../lib/dateFormat'
import { fmtNumber, fmtInt } from '../lib/numberFormat'

type SleepDrainEvent = SleepAnalytics['recent_events'][number]

const sleepDrainColumns: Column<SleepDrainEvent>[] = [
  { key: 'date', header: 'Date', render: (event) => (
    <span className="text-xs">
      {formatDateShort(event.start_date)}
      <span className="text-[var(--text-muted)] ml-1">{formatTime(event.start_date)}</span>
    </span>
  )},
  { key: 'duration', header: 'Duration', render: (event) => <>{fmtNumber(event.duration_hours)}h</> },
  { key: 'batteryLost', header: 'Battery Lost', render: (event) => <span className="text-neon-red">{fmtNumber(event.battery_lost)}%</span> },
  { key: 'drainRate', header: 'Drain Rate', render: (event) => (
    <span className={event.drain_rate > 1.5 ? 'text-neon-red' : 'text-neon-green'}>
      {fmtNumber(event.drain_rate)}%/hr
    </span>
  )},
  { key: 'sentry', header: 'Sentry', render: (event) => event.sentry_mode ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-400 ring-1 ring-amber-500/20">
      <Eye className="h-3 w-3" /> On
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-purple-500/10 px-2 py-0.5 text-xs text-purple-400 ring-1 ring-purple-500/20">
      <Moon className="h-3 w-3" /> Off
    </span>
  )},
  { key: 'temp', header: 'Temp', render: (event) => event.outside_temp != null ? (
    <span className="flex items-center gap-1">
      <Thermometer className="h-3 w-3 text-[var(--text-muted)]" />
      {fmtNumber(event.outside_temp)}°C
    </span>
  ) : (
    <span className="text-[var(--text-muted)]">—</span>
  )},
]

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


  const pieData = sleep?.state_distribution.map(s => ({
    name: STATE_LABELS[s.state] || s.state,
    value: Math.round(s.total_minutes),
    color: STATE_COLORS[s.state] || CHART_COLORS[0],
    hours: fmtNumber(s.total_minutes / 60),
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
            <Select
              value={days}
              onChange={e => setDays(Number(e.target.value))}
              className="text-sm px-3 py-2"
              options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }, { value: '180', label: '180 days' }]}
            />
            {vehicles && vehicles.length > 1 && (
              <Select
                value={vehicleId ?? ''}
                onChange={e => setSelectedVehicle(Number(e.target.value))}
                className="text-sm px-3 py-2"
                options={vehicles.map((v: Vehicle) => ({ value: String(v.id), label: v.display_name }))}
              />
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
              <MetricCard
                icon={<Moon className="h-4 w-4" />}
                label="Sleep Efficiency"
                value={`${fmtNumber(sleep.sleep_efficiency_pct)}%`}
                color="purple"
                subtitle="Time spent sleeping vs total"
              />
            </StaggerItem>

            <StaggerItem>
              <MetricCard
                icon={<Clock className="h-4 w-4" />}
                label="Avg Time to Sleep"
                value={`${fmtInt(sleep.time_to_sleep_avg_min)} min`}
                color="cyan"
                subtitle="After going idle"
              />
            </StaggerItem>

            <StaggerItem>
              <MetricCard
                icon={<Eye className="h-4 w-4" />}
                label="Sentry Drain Rate"
                value={`${fmtNumber(sleep.sentry_on_drain_rate)}%/hr`}
                color="amber"
                subtitle={`vs ${fmtNumber(sleep.sentry_off_drain_rate)}%/hr without`}
              />
            </StaggerItem>

            <StaggerItem>
              <MetricCard
                icon={<DollarSign className="h-4 w-4" />}
                label="Sentry Monthly Cost"
                value={`$${fmtNumber(sleep.sentry_monthly_cost, 2)}`}
                color="red"
                subtitle={`${fmtNumber(sleep.sentry_monthly_kwh)} kWh/month`}
              />
            </StaggerItem>
          </StaggerContainer>

          {/* Donut chart + Sentry comparison */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <FadeIn>
              <ChartContainer title="State Distribution" height={264}>
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
                <div className="flex flex-wrap justify-center gap-3 mt-4">
                  {pieData.map(entry => (
                    <div key={entry.name} className="flex items-center gap-1.5 text-xs">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
                      <span className="text-[var(--text-secondary)]">{entry.name}</span>
                      <span className="text-[var(--text-muted)]">{entry.hours}h</span>
                    </div>
                  ))}
                </div>
              </ChartContainer>
            </FadeIn>

            <FadeIn delay={0.1}>
              <ChartContainer title="Sentry vs No-Sentry" height={224}>
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

                {/* Sentry cost callout */}
                <div className="mt-4 rounded-xl bg-amber-500/10 border border-amber-500/20 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Eye className="h-4 w-4 text-amber-400" />
                    <span className="text-sm font-medium text-amber-300">Monthly Sentry Mode Impact</span>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div>
                      <p className="text-lg font-bold text-amber-400">{fmtNumber(sleep.sentry_extra_drain_rate)}%</p>
                      <p className="text-xs text-[var(--text-muted)]">Extra drain/hr</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-amber-400">{fmtNumber(sleep.sentry_extra_monthly_kwh)} kWh</p>
                      <p className="text-xs text-[var(--text-muted)]">Extra monthly</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-neon-red">${fmtNumber(sleep.sentry_extra_monthly_cost, 2)}</p>
                      <p className="text-xs text-[var(--text-muted)]">Extra cost/mo</p>
                    </div>
                  </div>
                </div>
              </ChartContainer>
            </FadeIn>
          </div>

          {/* Recent drain events table */}
          <FadeIn delay={0.2}>
            <GlassPanel className="p-6">
              <h3 className="section-title mb-6 flex items-center gap-2">
                <Zap className="h-4 w-4 text-neon-cyan" /> Recent Drain Events
              </h3>
              <DataTable
                columns={sleepDrainColumns}
                data={sleep.recent_events}
                keyExtractor={(event) => event.id}
                emptyMessage="No drain events recorded yet"
              />
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
