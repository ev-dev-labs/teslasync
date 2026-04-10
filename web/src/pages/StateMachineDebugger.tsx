import { useQuery } from '@tanstack/react-query'
import { Cpu } from 'lucide-react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { PageHeader, GlassPanel, FadeIn, Skeleton, Badge, DataTable, type Column } from '../components/ui'
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

  const stateCountRows = Object.entries(countByState)
    .sort((a, b) => (durationByState[b[0]] ?? 0) - (durationByState[a[0]] ?? 0))
    .map(([state, count]) => ({
      state,
      count,
      duration: durationByState[state] ?? 0,
      pct: totalDuration > 0 ? ((durationByState[state] ?? 0) / totalDuration) * 100 : 0,
    }))

  type StateCountRow = (typeof stateCountRows)[number]

  const stateCountColumns: Column<StateCountRow>[] = [
    { key: 'state', header: 'State', render: (row) => (
      <Badge color={row.state === 'driving' ? 'green' : row.state === 'charging' ? 'amber' : row.state === 'parked' ? 'cyan' : row.state === 'asleep' ? 'purple' : 'neutral'} dot>
        {row.state}
      </Badge>
    )},
    { key: 'transitions', header: 'Transitions', className: 'text-right', render: (row) => <span className="text-[var(--text-primary)] font-mono">{row.count}</span> },
    { key: 'totalDuration', header: 'Total Duration', className: 'text-right', render: (row) => <span className="text-[var(--text-secondary)] font-mono">{formatDuration(row.duration)}</span> },
    { key: 'pctTime', header: '% of Time', className: 'text-right', render: (row) => <span className="text-[var(--text-muted)] font-mono">{fmtNumber(row.pct, 1)}%</span> },
  ]

  const timelineColumns: Column<StateTransition>[] = [
    { key: 'state', header: 'State', render: (t) => (
      <Badge color={t.state?.toLowerCase() === 'driving' ? 'green' : t.state?.toLowerCase() === 'charging' ? 'amber' : t.state?.toLowerCase() === 'parked' ? 'cyan' : t.state?.toLowerCase() === 'asleep' ? 'purple' : 'neutral'} dot>
        {t.state}
      </Badge>
    )},
    { key: 'started', header: 'Started', render: (t) => <span className="text-[var(--text-secondary)] font-mono whitespace-nowrap">{formatDateTime(t.started_at)}</span> },
    { key: 'ended', header: 'Ended', render: (t) => <span className="text-[var(--text-secondary)] font-mono whitespace-nowrap">{t.ended_at ? formatDateTime(t.ended_at) : <span className="text-neon-green">ongoing</span>}</span> },
    { key: 'duration', header: 'Duration', className: 'text-right', render: (t) => <span className="text-[var(--text-primary)] font-mono whitespace-nowrap">{formatDuration(t.duration_seconds)}</span> },
  ]

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
              <DataTable
                columns={stateCountColumns}
                data={stateCountRows}
                keyExtractor={(row) => row.state}
              />
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
            <DataTable
              columns={timelineColumns}
              data={transitions}
              keyExtractor={(t) => t.started_at}
              compact
              className="max-h-[50vh] overflow-auto"
            />
          ) : (
            <p className="text-center py-12 text-[var(--text-muted)]">No transitions in the last 24h</p>
          )}
        </GlassPanel>
      </FadeIn>
    </div>
  )
}
