import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getVehicles, getVehicleTimeline, getStateSummary, getDailyStateBreakdown } from '../api'
import { PageHeader, GlassPanel, FadeIn, DateRangeFilter, Skeleton, QueryError, ChartContainer, Select } from '../components/ui'
import { Clock, Activity, Car, BatteryCharging, Moon, Wifi, Download } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts'
import { formatDateShort, formatDateTime } from '../lib/dateFormat'
import { fmtNumber, fmtInt } from '../lib/numberFormat'
import { usePageTitle } from '../hooks/usePageTitle'


const stateColors: Record<string, string> = {
  driving: '#00f0ff',
  charging: '#10b981',
  online: '#3b82f6',
  asleep: '#6366f1',
  offline: '#4b5563',
  updating: '#f59e0b',
}

const stateIcons: Record<string, typeof Car> = {
  driving: Car,
  charging: BatteryCharging,
  online: Wifi,
  asleep: Moon,
  offline: Activity,
  updating: Download,
}

interface TimelineTooltipPayload { name: string; value: number; color?: string; fill?: string }
function TimelineTooltip({ active, payload, label }: { active?: boolean; payload?: TimelineTooltipPayload[]; label?: string }) {
  usePageTitle('Timeline')
  if (!active || !payload?.length) return null
  return (
    <div className="glass-panel p-3 text-xs" style={{ background: 'var(--surface-2)', borderColor: 'var(--glass-border)' }}>
      <p style={{ color: 'var(--text-secondary)' }} className="mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: 'var(--text-primary)' }}>
          <span style={{ color: p.color || p.fill }}>●</span> {p.name}: {typeof p.value === 'number' ? fmtInt(p.value) : p.value} min
        </p>
      ))}
    </div>
  )
}

function formatDuration(min: number): string {
  if (min < 60) return `${Math.round(min)}m`
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

export default function Timeline() {
  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: getVehicles })
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null)
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0])
  const vehicleId = selectedVehicle ?? vehicles?.[0]?.id ?? null

  const { data: timeline, isLoading, error: timelineError, refetch } = useQuery({
    queryKey: ['vehicle-timeline', vehicleId],
    queryFn: () => getVehicleTimeline(vehicleId!, 500),
    enabled: vehicleId !== null,
  })

  const { data: summary, error: summaryError } = useQuery({
    queryKey: ['state-summary', vehicleId, startDate],
    queryFn: () => getStateSummary(vehicleId!, 30, startDate),
    enabled: vehicleId !== null,
  })

  const { data: dailyBreakdown, error: breakdownError } = useQuery({
    queryKey: ['state-daily', vehicleId, startDate],
    queryFn: () => getDailyStateBreakdown(vehicleId!, 30, startDate),
    enabled: vehicleId !== null,
  })

  // Pie chart data from summary
  const pieData = (summary ?? []).map(s => ({
    name: s.state.charAt(0).toUpperCase() + s.state.slice(1),
    value: Math.round(s.total_min),
    fill: stateColors[s.state] ?? '#4b5563',
  }))

  // Aggregate daily breakdown into stacked bar: each day → { day, driving, charging, asleep, online, ... }
  const dailyMap = new Map<string, Record<string, number>>()
  ;(dailyBreakdown ?? []).forEach(d => {
    if (!dailyMap.has(d.day)) dailyMap.set(d.day, { day: 0 })
    const entry = dailyMap.get(d.day)!
    entry[d.state] = (entry[d.state] ?? 0) + d.total_min
  })
  const stackedData = Array.from(dailyMap.entries())
    .map(([day, data]) => ({ day: formatDateShort(day), ...data }))
    .reverse()

  const allStates = Array.from(new Set((dailyBreakdown ?? []).map(d => d.state)))

  const totalMinutes = (summary ?? []).reduce((s, item) => s + item.total_min, 0)

  // Derived key stats
  const parkedMin = (summary ?? []).find(s => s.state === 'asleep')?.total_min ?? 0
  const drivingMin = (summary ?? []).find(s => s.state === 'driving')?.total_min ?? 0
  const chargingMin = (summary ?? []).find(s => s.state === 'charging')?.total_min ?? 0
  const parkedPct = totalMinutes > 0 ? (parkedMin / totalMinutes * 100) : 0
  const drivingPct = totalMinutes > 0 ? (drivingMin / totalMinutes * 100) : 0
  const chargingPct = totalMinutes > 0 ? (chargingMin / totalMinutes * 100) : 0
  const lastStateChange = timeline?.[0] ? formatDateTime(timeline[0].start_date) : '—'
  const lastState = timeline?.[0]?.state ?? '—'

  return (
    <FadeIn>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0 mb-6 sm:mb-8">
        <PageHeader title="Timeline" subtitle="Vehicle state history — driving, charging, sleeping, online" icon={<Clock className="h-7 w-7 text-neon-blue" />} />
        <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
          <DateRangeFilter
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={setStartDate}
            onEndDateChange={setEndDate}
          />
          {vehicles && vehicles.length > 1 && (
            <Select
              value={vehicleId ?? ''}
              onChange={e => setSelectedVehicle(Number(e.target.value))}
              options={vehicles.map(v => ({ value: String(v.id), label: v.display_name || v.vin }))}
            />
          )}
        </div>
      </div>

      {timelineError && <QueryError error={timelineError} onRetry={refetch} />}
      {!timelineError && (summaryError || breakdownError) && (
        <div className="p-4 rounded-lg border border-neon-red/30 bg-neon-red/5 text-neon-red text-sm">
          Failed to load data: {((summaryError || breakdownError) as Error).message}
        </div>
      )}

      {/* State Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3 mb-6 sm:mb-8">
        {(summary ?? []).map(s => {
          const Icon = stateIcons[s.state] ?? Activity
          const pct = totalMinutes > 0 ? (s.total_min / totalMinutes * 100) : 0
          return (
            <GlassPanel key={s.state} className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Icon className="h-4 w-4" style={{ color: stateColors[s.state] }} />
                <span className="text-xs font-medium capitalize" style={{ color: stateColors[s.state] }}>{s.state}</span>
              </div>
              <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{formatDuration(s.total_min)}</p>
              <div className="flex items-center justify-between mt-1">
                <span className="text-[10px] text-[var(--text-muted)]">{s.count} times</span>
                <span className="text-[10px] font-medium" style={{ color: stateColors[s.state] }}>{fmtNumber(pct)}%</span>
              </div>
              <div className="mt-2 h-1 rounded-full bg-white/5 overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: stateColors[s.state] }} />
              </div>
            </GlassPanel>
          )
        })}
      </div>

      {/* Key Stats Bar */}
      <GlassPanel className="p-4 sm:p-6 mb-6 sm:mb-8">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4 text-center">
          <div>
            <p className="text-2xl font-bold" style={{ color: stateColors.asleep }}>{fmtNumber(parkedPct)}%</p>
            <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Parked / Asleep</p>
          </div>
          <div>
            <p className="text-2xl font-bold" style={{ color: stateColors.driving }}>{fmtNumber(drivingPct)}%</p>
            <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Driving</p>
          </div>
          <div>
            <p className="text-2xl font-bold" style={{ color: stateColors.charging }}>{fmtNumber(chargingPct)}%</p>
            <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Charging</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-[var(--text-primary)]">{formatDuration(totalMinutes)}</p>
            <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Total Time</p>
          </div>
          <div>
            <p className="text-lg font-bold capitalize" style={{ color: stateColors[lastState] ?? '#6b7280' }}>{lastState}</p>
            <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Last State</p>
          </div>
          <div>
            <p className="text-sm font-bold text-[var(--text-primary)]">{lastStateChange}</p>
            <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Last Change</p>
          </div>
        </div>
        {/* State proportion bar */}
        <div className="mt-4 h-3 rounded-full bg-white/5 overflow-hidden flex">
          {(summary ?? []).map(s => {
            const pct = totalMinutes > 0 ? (s.total_min / totalMinutes * 100) : 0
            return pct > 0.5 ? <div key={s.state} className="h-full" style={{ width: `${pct}%`, background: stateColors[s.state] ?? '#4b5563' }} title={`${s.state}: ${fmtNumber(pct)}%`} /> : null
          })}
        </div>
      </GlassPanel>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 mb-6 sm:mb-8">
        {/* Pie Chart */}
        <ChartContainer title="Time Distribution" height={280}>
          {pieData.length === 0 ? (
            <div className="flex items-center justify-center h-full text-[var(--text-muted)] text-sm">No data</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} dataKey="value" cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={2}>
                  {pieData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                </Pie>
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Tooltip formatter={(val: number) => formatDuration(val)} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartContainer>

        {/* Daily Stacked Bar */}
        <ChartContainer title="Daily State Breakdown" height={280} className="lg:col-span-2">
          {isLoading ? <Skeleton className="h-full rounded-xl" /> : stackedData.length === 0 ? (
            <div className="flex items-center justify-center h-full text-[var(--text-muted)] text-sm">No daily data</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stackedData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                <Tooltip content={<TimelineTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {allStates.map(state => (
                  <Bar key={state} dataKey={state} stackId="a" fill={stateColors[state] ?? '#4b5563'} name={state.charAt(0).toUpperCase() + state.slice(1)} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartContainer>
      </div>

      {/* Recent Timeline */}
      <GlassPanel className="p-4 sm:p-6">
        <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Recent State Changes</h3>
        {!timeline?.length ? (
          <p className="text-sm text-[var(--text-muted)] py-8 text-center">No state history available</p>
        ) : (
          <div className="relative">
            <div className="absolute left-6 top-0 bottom-0 w-px bg-white/10" />
            <div className="space-y-2">
              {timeline.slice(0, 50).map(s => {
                const Icon = stateIcons[s.state] ?? Activity
                const color = stateColors[s.state] ?? '#4b5563'
                return (
                  <div key={s.id} className="relative pl-14">
                    <div className="absolute left-3.5 top-3 h-5 w-5 rounded-full flex items-center justify-center ring-4 ring-[var(--bg)]" style={{ background: `${color}20` }}>
                      <Icon className="h-3 w-3" style={{ color }} />
                    </div>
                    <GlassPanel className="p-3 flex items-center justify-between">
                      <div>
                        <span className="text-sm font-medium capitalize" style={{ color }}>{s.state}</span>
                        <span className="text-xs text-[var(--text-muted)] ml-2">{formatDuration(s.duration_min)}</span>
                      </div>
                      <span className="text-[11px] text-[var(--text-muted)]">{formatDateTime(s.start_date)}</span>
                    </GlassPanel>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </GlassPanel>
    </FadeIn>
  )
}
