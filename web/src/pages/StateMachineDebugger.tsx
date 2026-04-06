import { useQuery } from '@tanstack/react-query'
import { Cpu } from 'lucide-react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { PageHeader, GlassPanel, FadeIn, Skeleton } from '../components/ui'
import { ChartTooltip } from '../components/Charts'
import { request } from '../api/client'
import { formatDateTime, formatRelative } from '../lib/dateFormat'
import { fmtNumber } from '../lib/numberFormat'
import clsx from 'clsx'

interface VehicleState {
  state: string
  since: string
  vehicle_id: number
}

interface StateTransition {
  state: string
  started_at: string
  ended_at: string | null
  duration_seconds: number
}

interface TimelineResponse {
  vehicle_id: number
  days: number
  transitions: StateTransition[]
}

const stateColors: Record<string, { bg: string; text: string; dot: string; hex: string }> = {
  driving: { bg: 'bg-neon-green/10', text: 'text-neon-green', dot: 'bg-neon-green', hex: '#10b981' },
  charging: { bg: 'bg-neon-amber/10', text: 'text-neon-amber', dot: 'bg-neon-amber', hex: '#f59e0b' },
  parked: { bg: 'bg-neon-cyan/10', text: 'text-neon-cyan', dot: 'bg-neon-cyan', hex: '#00f0ff' },
  online: { bg: 'bg-blue-500/10', text: 'text-blue-400', dot: 'bg-blue-400', hex: '#60a5fa' },
  offline: { bg: 'bg-gray-500/10', text: 'text-gray-400', dot: 'bg-gray-400', hex: '#9ca3af' },
  asleep: { bg: 'bg-purple-500/10', text: 'text-purple-400', dot: 'bg-purple-400', hex: '#a78bfa' },
}

function getStateStyle(state?: string | null) {
  if (!state || typeof state !== 'string') return stateColors.offline
  return stateColors[state.toLowerCase()] ?? stateColors.offline
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

export default function StateMachineDebugger() {
  const vehicleId = 1

  const { data: stateResponse, isLoading: stateLoading } = useQuery<{ state?: VehicleState; live?: boolean }>({
    queryKey: ['vehicle-state', vehicleId],
    queryFn: () => request(`/vehicles/${vehicleId}/state`),
    refetchInterval: 3_000,
  })

  const currentState = stateResponse?.state

  const { data: timeline, isLoading: timelineLoading } = useQuery<TimelineResponse>({
    queryKey: ['state-timeline', vehicleId],
    queryFn: () => request(`/vehicle-states/timeline?vehicle_id=${vehicleId}&days=1`),
    refetchInterval: 10_000,
  })

  const transitions = timeline?.transitions ?? []

  // Aggregate durations by state for pie chart
  const durationByState: Record<string, number> = {}
  const countByState: Record<string, number> = {}
  for (const t of transitions) {
    const s = (t.state ?? 'unknown').toLowerCase()
    durationByState[s] = (durationByState[s] ?? 0) + t.duration_seconds
    countByState[s] = (countByState[s] ?? 0) + 1
  }

  const pieData = Object.entries(durationByState).map(([name, value]) => ({
    name: name.charAt(0).toUpperCase() + name.slice(1),
    value: Math.round(value),
    fill: getStateStyle(name).hex,
  }))

  const totalDuration = Object.values(durationByState).reduce((a, b) => a + b, 0)

  const style = currentState ? getStateStyle(currentState.state) : getStateStyle('offline')

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="State Machine Debugger"
        subtitle="Vehicle state transitions and duration analysis"
        icon={<Cpu className="h-6 w-6 text-neon-cyan" />}
      />

      {/* Current State Hero */}
      <FadeIn delay={0.1}>
        <GlassPanel className="p-6">
          {stateLoading ? (
            <Skeleton className="h-24" />
          ) : currentState ? (
            <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-8">
              <div className={clsx('px-8 py-4 rounded-2xl text-2xl sm:text-4xl font-bold uppercase tracking-wider', style.bg, style.text)}>
                <span className={clsx('inline-block h-3 w-3 rounded-full mr-3 animate-pulse', style.dot)} />
                {currentState.state}
              </div>
              <div className="text-sm text-[var(--text-secondary)]">
                <p>Since: <span className="text-[var(--text-primary)] font-medium">{formatDateTime(currentState.since)}</span></p>
                <p className="text-[var(--text-muted)] mt-1">{formatRelative(currentState.since)}</p>
              </div>
            </div>
          ) : (
            <p className="text-[var(--text-muted)]">No state data available</p>
          )}
        </GlassPanel>
      </FadeIn>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        {/* Duration Pie Chart */}
        <FadeIn delay={0.2}>
          <GlassPanel className="p-5">
            <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-4">State Duration Distribution (24h)</h2>
            {timelineLoading ? (
              <Skeleton className="h-64" />
            ) : pieData.length > 0 ? (
              <div className="flex flex-col items-center">
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {pieData.map((entry, i) => (
                        <Cell key={i} fill={entry.fill} stroke="transparent" />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap justify-center gap-3 mt-2">
                  {pieData.map(entry => (
                    <div key={entry.name} className="flex items-center gap-1.5 text-xs">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.fill }} />
                      <span className="text-[var(--text-secondary)]">{entry.name}</span>
                      <span className="text-[var(--text-muted)]">{formatDuration(entry.value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-center py-12 text-[var(--text-muted)]">No transitions in the last 24h</p>
            )}
          </GlassPanel>
        </FadeIn>

        {/* Transition Count Table */}
        <FadeIn delay={0.3}>
          <GlassPanel className="p-5">
            <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-4">State Transition Counts (24h)</h2>
            {timelineLoading ? (
              <Skeleton className="h-64" />
            ) : Object.keys(countByState).length > 0 ? (
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)]">
                      <th className="text-left px-3 py-2.5 text-[var(--text-muted)] font-medium text-xs">State</th>
                      <th className="text-right px-3 py-2.5 text-[var(--text-muted)] font-medium text-xs">Transitions</th>
                      <th className="text-right px-3 py-2.5 text-[var(--text-muted)] font-medium text-xs">Total Duration</th>
                      <th className="text-right px-3 py-2.5 text-[var(--text-muted)] font-medium text-xs">% of Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(countByState)
                      .sort((a, b) => (durationByState[b[0]] ?? 0) - (durationByState[a[0]] ?? 0))
                      .map(([state, count]) => {
                        const s = getStateStyle(state)
                        const dur = durationByState[state] ?? 0
                        const pct = totalDuration > 0 ? (dur / totalDuration) * 100 : 0
                        return (
                          <tr key={state} className="border-b border-[var(--border)] hover:bg-white/[0.02]">
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-2">
                                <span className={clsx('h-2 w-2 rounded-full', s.dot)} />
                                <span className={clsx('font-medium capitalize', s.text)}>{state}</span>
                              </div>
                            </td>
                            <td className="px-3 py-2.5 text-right text-[var(--text-primary)] font-mono">{count}</td>
                            <td className="px-3 py-2.5 text-right text-[var(--text-secondary)] font-mono">{formatDuration(dur)}</td>
                            <td className="px-3 py-2.5 text-right text-[var(--text-muted)] font-mono">{fmtNumber(pct, 1)}%</td>
                          </tr>
                        )
                      })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-center py-12 text-[var(--text-muted)]">No transitions recorded</p>
            )}
          </GlassPanel>
        </FadeIn>
      </div>

      {/* State Transition Timeline */}
      <FadeIn delay={0.4}>
        <GlassPanel className="p-5">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-4">
            Transition Timeline (Last 24h)
            {transitions.length > 0 && (
              <span className="ml-2 text-[var(--text-muted)] font-normal">{transitions.length} transitions</span>
            )}
          </h2>
          {timelineLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : transitions.length > 0 ? (
            <div className="overflow-auto max-h-[50vh]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-[var(--surface)] z-10">
                  <tr className="border-b border-[var(--border)]">
                    <th className="text-left px-3 py-2.5 text-[var(--text-muted)] font-medium">State</th>
                    <th className="text-left px-3 py-2.5 text-[var(--text-muted)] font-medium">Started</th>
                    <th className="text-left px-3 py-2.5 text-[var(--text-muted)] font-medium">Ended</th>
                    <th className="text-right px-3 py-2.5 text-[var(--text-muted)] font-medium">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {transitions.map((t, i) => {
                    const s = getStateStyle(t.state)
                    return (
                      <tr key={i} className="border-b border-[var(--border)] hover:bg-white/[0.02]">
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className={clsx('h-2 w-2 rounded-full', s.dot)} />
                            <span className={clsx('font-medium capitalize', s.text)}>{t.state}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-[var(--text-secondary)] font-mono whitespace-nowrap">{formatDateTime(t.started_at)}</td>
                        <td className="px-3 py-2.5 text-[var(--text-secondary)] font-mono whitespace-nowrap">
                          {t.ended_at ? formatDateTime(t.ended_at) : <span className="text-neon-green">ongoing</span>}
                        </td>
                        <td className="px-3 py-2.5 text-right text-[var(--text-primary)] font-mono whitespace-nowrap">
                          {formatDuration(t.duration_seconds)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-center py-12 text-[var(--text-muted)]">No transitions in the last 24h</p>
          )}
        </GlassPanel>
      </FadeIn>
    </div>
  )
}
