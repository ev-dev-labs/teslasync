import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Cpu, RefreshCw } from 'lucide-react';
import { PageContainer, Grid } from '@/components/layout';
import { GlassPanel, Badge, DataTable, Select } from '@/components/ui';
import type { Column } from '@/components/ui';
import { StatCard } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import { Skeleton, EmptyState } from '@/components/feedback';
import {
  ChartContainer, PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  ChartTooltip, CHART_COLORS,
} from '@/components/charts';
import { useVehicleStateMachine, useStateTimeline } from '@/api/hooks/useAdmin';
import { useVehicles } from '@/api/hooks/useVehicles';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDateTime, formatRelative } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import type { StateTransition } from '@/types/admin';

// Badge variant per state name
const stateVariant: Record<string, 'success' | 'warning' | 'info' | 'danger' | 'neutral'> = {
  driving: 'success',
  charging: 'warning',
  parked: 'info',
  online: 'info',
  offline: 'danger',
  asleep: 'neutral',
};

// Hex colors for the pie chart cells
const stateHex: Record<string, string> = {
  driving: '#10b981',
  charging: '#f59e0b',
  parked: '#06b6d4',
  online: '#60a5fa',
  offline: '#9ca3af',
  asleep: '#a78bfa',
};

// Tailwind class sets for the Current State hero section
const stateStyle: Record<string, { bg: string; text: string; dot: string }> = {
  driving: { bg: 'bg-green-500/10', text: 'text-green-400', dot: 'bg-green-400' },
  charging: { bg: 'bg-amber-500/10', text: 'text-amber-400', dot: 'bg-amber-400' },
  parked: { bg: 'bg-cyan-500/10', text: 'text-cyan-400', dot: 'bg-cyan-400' },
  online: { bg: 'bg-blue-500/10', text: 'text-blue-400', dot: 'bg-blue-400' },
  offline: { bg: 'bg-gray-500/10', text: 'text-gray-400', dot: 'bg-gray-400' },
  asleep: { bg: 'bg-purple-500/10', text: 'text-purple-400', dot: 'bg-purple-400' },
};

function getStyle(state?: string | null) {
  if (!state) return stateStyle.offline;
  return stateStyle[state.toLowerCase()] ?? stateStyle.offline;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// Backend wraps the vehicle state: {state: {state: "driving", since: "..."}, live: boolean}
interface StateResponse {
  state?: { state?: string; since?: string };
  live?: boolean;
}

interface StateCountRow {
  state: string;
  count: number;
  duration: number;
  pct: number;
}

export default function StateMachineDebuggerPage() {
  const { t } = useTranslation();
  usePageTitle(t('stateMachine.title', 'FSM Debugger'));

  const { data: vehicles } = useVehicles();
  const [vehicleId, setVehicleId] = useState<string>('');
  const activeId = vehicleId || String(vehicles?.[0]?.id ?? '');

  const {
    data: stateData,
    isLoading: stateLoading,
    isFetching: stateFetching,
  } = useVehicleStateMachine(activeId);
  const {
    data: timelineData,
    isLoading: timelineLoading,
  } = useStateTimeline(activeId, 7);

  // Safely extract the nested state (backend wraps in {state: {...}, live: ...})
  const stateResponse = stateData as unknown as StateResponse | undefined;
  const currentState = stateResponse?.state;
  const stateName = currentState?.state?.toLowerCase() ?? null;
  const style = getStyle(stateName);

  const transitions: StateTransition[] = timelineData?.transitions ?? [];

  // Aggregate durations and counts per state
  const { durationByState, countByState } = useMemo(() => {
    const dur: Record<string, number> = {};
    const cnt: Record<string, number> = {};
    for (const tr of transitions) {
      const s = (tr.state ?? 'unknown').toLowerCase();
      dur[s] = (dur[s] ?? 0) + tr.durationSeconds;
      cnt[s] = (cnt[s] ?? 0) + 1;
    }
    return { durationByState: dur, countByState: cnt };
  }, [transitions]);

  const totalDuration = Object.values(durationByState).reduce((a, b) => a + b, 0);

  // Pie chart data
  const pieData = useMemo(
    () =>
      Object.entries(durationByState).map(([name, value]) => ({
        name: name.charAt(0).toUpperCase() + name.slice(1),
        value: Math.round(value),
        fill: stateHex[name] ?? CHART_COLORS[0],
      })),
    [durationByState],
  );

  // State count rows for the summary table
  const stateCountRows: StateCountRow[] = useMemo(
    () =>
      Object.entries(countByState)
        .sort((a, b) => (durationByState[b[0]] ?? 0) - (durationByState[a[0]] ?? 0))
        .map(([state, count]) => ({
          state,
          count,
          duration: durationByState[state] ?? 0,
          pct: totalDuration > 0 ? ((durationByState[state] ?? 0) / totalDuration) * 100 : 0,
        })),
    [countByState, durationByState, totalDuration],
  );

  // DataTable columns for state counts
  const stateCountColumns: Column<StateCountRow>[] = useMemo(
    () => [
      {
        key: 'state',
        header: t('stateMachine.state', 'State'),
        render: (row: StateCountRow) => (
          <Badge variant={stateVariant[row.state] ?? 'neutral'} dot>
            {row.state}
          </Badge>
        ),
      },
      {
        key: 'transitions',
        header: t('stateMachine.transitions', 'Transitions'),
        className: 'text-right',
        render: (row: StateCountRow) => (
          <span className="text-white/90 font-mono">{row.count}</span>
        ),
      },
      {
        key: 'totalDuration',
        header: t('stateMachine.totalDuration', 'Total Duration'),
        className: 'text-right',
        render: (row: StateCountRow) => (
          <span className="text-white/70 font-mono">{formatDuration(row.duration)}</span>
        ),
      },
      {
        key: 'pctTime',
        header: t('stateMachine.pctTime', '% of Time'),
        className: 'text-right',
        render: (row: StateCountRow) => (
          <span className="text-white/50 font-mono">{fmtNumber(row.pct)}%</span>
        ),
      },
    ],
    [t],
  );

  // DataTable columns for the transition timeline
  const timelineColumns: Column<StateTransition>[] = useMemo(
    () => [
      {
        key: 'state',
        header: t('stateMachine.state', 'State'),
        render: (tr: StateTransition) => (
          <Badge variant={stateVariant[tr.state?.toLowerCase()] ?? 'neutral'} dot>
            {tr.state}
          </Badge>
        ),
      },
      {
        key: 'started',
        header: t('stateMachine.started', 'Started'),
        render: (tr: StateTransition) => (
          <span className="text-white/70 font-mono whitespace-nowrap">
            {formatDateTime(tr.startedAt)}
          </span>
        ),
      },
      {
        key: 'ended',
        header: t('stateMachine.ended', 'Ended'),
        render: (tr: StateTransition) => (
          <span className="text-white/70 font-mono whitespace-nowrap">
            {tr.endedAt ? (
              formatDateTime(tr.endedAt)
            ) : (
              <span className="text-green-400">{t('stateMachine.ongoing', 'ongoing')}</span>
            )}
          </span>
        ),
      },
      {
        key: 'duration',
        header: t('stateMachine.duration', 'Duration'),
        className: 'text-right',
        render: (tr: StateTransition) => (
          <span className="text-white/90 font-mono whitespace-nowrap">
            {formatDuration(tr.durationSeconds)}
          </span>
        ),
      },
    ],
    [t],
  );

  const vehicleOptions = (vehicles ?? []).map((v) => ({
    value: String(v.id),
    label: v.display_name || v.vin,
  }));

  return (
    <PageContainer
      title={t('stateMachine.title', 'FSM Debugger')}
      subtitle={t('stateMachine.subtitle', 'Vehicle state transitions and duration analysis')}
      loading={stateLoading && timelineLoading}
      actions={
        <span className="flex items-center gap-1 text-xs text-white/40">
          <RefreshCw className={cn('h-3 w-3', stateFetching && 'animate-spin')} />
          {t('stateMachine.autoRefresh', 'Live 3s')}
        </span>
      }
    >
      {/* Vehicle Selector */}
      <FadeIn delay={0.05}>
        <GlassPanel className="p-4 sm:p-5">
          {vehicleOptions.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Select
                label={t('stateMachine.vehicle', 'Vehicle')}
                options={vehicleOptions}
                value={activeId}
                onChange={(e) => setVehicleId(e.target.value)}
              />
            </div>
          ) : (
            <EmptyState message={t('stateMachine.noVehicles', 'No vehicles available')} />
          )}
        </GlassPanel>
      </FadeIn>

      {/* Current State Hero */}
      <FadeIn delay={0.1}>
        <GlassPanel className="p-6">
          {stateLoading ? (
            <Skeleton height={96} />
          ) : currentState ? (
            <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-8">
              <div
                className={cn(
                  'px-8 py-4 rounded-2xl text-2xl sm:text-4xl font-bold uppercase tracking-wider',
                  style.bg,
                  style.text,
                )}
              >
                <span
                  className={cn(
                    'inline-block h-3 w-3 rounded-full mr-3 animate-pulse',
                    style.dot,
                  )}
                />
                {currentState.state ?? '—'}
              </div>
              <div className="text-sm text-white/70">
                <p>
                  {t('stateMachine.since', 'Since')}:{' '}
                  <span className="text-white/90 font-medium">
                    {formatDateTime(currentState.since)}
                  </span>
                </p>
                <p className="text-white/50 mt-1">{formatRelative(currentState.since)}</p>
              </div>
            </div>
          ) : (
            <EmptyState message={t('stateMachine.noState', 'No state data available')} />
          )}
        </GlassPanel>
      </FadeIn>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        {/* Duration Pie Chart */}
        <FadeIn delay={0.2}>
          <ChartContainer
            title={t('stateMachine.pieTitle', 'State Duration Distribution (7d)')}
            loading={timelineLoading}
            height={260}
          >
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
              {/* Legend */}
              <div className="flex flex-wrap justify-center gap-3 mt-2">
                {pieData.map((entry) => (
                  <div key={entry.name} className="flex items-center gap-1.5 text-xs">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: entry.fill }}
                    />
                    <span className="text-white/70">{entry.name}</span>
                    <span className="text-white/50">{formatDuration(entry.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          </ChartContainer>
        </FadeIn>

        {/* State Transition Count Table */}
        <FadeIn delay={0.3}>
          <GlassPanel className="p-5">
            <h2 className="text-sm font-semibold text-white/90 mb-4">
              {t('stateMachine.countTitle', 'State Transition Counts (7d)')}
            </h2>
            {timelineLoading ? (
              <Skeleton height={260} />
            ) : stateCountRows.length > 0 ? (
              <DataTable<StateCountRow>
                columns={stateCountColumns}
                data={stateCountRows}
                keyExtractor={(row) => row.state}
              />
            ) : (
              <EmptyState
                message={t('stateMachine.noTransitions', 'No transitions recorded')}
              />
            )}
          </GlassPanel>
        </FadeIn>
      </div>

      {/* Summary Cards */}
      <FadeIn delay={0.35}>
        <Grid cols={{ default: 2, lg: 4 }} gap={4}>
          <StatCard
            label={t('stateMachine.totalTransitions', 'Transitions')}
            value={transitions.length}
            icon={<Cpu className="h-4 w-4" />}
          />
          <StatCard
            label={t('stateMachine.statesSeen', 'States Seen')}
            value={Object.keys(durationByState).length}
          />
          <StatCard
            label={t('stateMachine.totalTime', 'Total Time')}
            value={formatDuration(totalDuration)}
          />
          <StatCard
            label={t('stateMachine.current', 'Current')}
            value={stateName ?? '—'}
          />
        </Grid>
      </FadeIn>

      {/* Transition Timeline */}
      <FadeIn delay={0.4}>
        <GlassPanel className="p-5">
          <h2 className="text-sm font-semibold text-white/90 mb-4">
            {t('stateMachine.timelineTitle', 'Transition Timeline (Last 7 Days)')}
            {transitions.length > 0 && (
              <span className="ml-2 text-white/50 font-normal">
                {transitions.length} {t('stateMachine.transitionsLabel', 'transitions')}
              </span>
            )}
          </h2>
          {timelineLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} height={48} />
              ))}
            </div>
          ) : transitions.length > 0 ? (
            <DataTable<StateTransition>
              columns={timelineColumns}
              data={transitions}
              keyExtractor={(tr) => tr.startedAt}
              compact
              className="max-h-[50vh] overflow-auto"
            />
          ) : (
            <EmptyState
              message={t('stateMachine.noTimeline', 'No transitions in the last 7 days')}
            />
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
