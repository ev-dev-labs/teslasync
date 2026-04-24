import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, ChevronDown, ChevronRight, Activity, Zap, AlertTriangle } from 'lucide-react';
import { PageContainer, Grid } from '@/components/layout';
import { GlassPanel, Button, DataTable, Select, Pagination } from '@/components/ui';
import type { Column } from '@/components/ui';
import { StatCard } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import { Skeleton, EmptyState } from '@/components/feedback';
import {
  ChartContainer, PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  ChartTooltip, CHART_COLORS,
} from '@/components/charts';
import { useVehicleStateMachine } from '@/api/hooks/useAdmin';
import { useFSMStats, useFSMTransitions } from '@/api/hooks/useFSM';
import { useVehicles } from '@/api/hooks/useVehicles';
import type { VehicleState } from '@/api/types';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDateTime, formatRelative } from '@/lib/dateFormat';
import { fmtInt } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import type { FSMTransition, FSMType } from '@/types/fsm';
import { HOURS_OPTIONS, FSM_TYPE_OPTIONS } from '@/types/fsm';
import { StateBadge } from '../components/StateBadge';
import { FSMStateDiagram } from '../components/FSMStateDiagram';
import { FSMHealthPanel, computeFlapIds } from '../components/FSMHealthPanel';
import { FSMTimelineChart } from '../components/FSMTimelineChart';
import { FSMSubFSMPanel } from '../components/FSMSubFSMPanel';

/* ─── Vehicle state styling (for live state hero) ─── */
const vehicleStateStyle: Record<string, { bg: string; text: string; dot: string }> = {
  driving: { bg: 'bg-green-500/10', text: 'text-green-400', dot: 'bg-green-400' },
  charging: { bg: 'bg-cyan-500/10', text: 'text-cyan-400', dot: 'bg-cyan-400' },
  parked: { bg: 'bg-purple-500/10', text: 'text-purple-400', dot: 'bg-purple-400' },
  online: { bg: 'bg-blue-500/10', text: 'text-blue-400', dot: 'bg-blue-400' },
  offline: { bg: 'bg-gray-500/10', text: 'text-gray-400', dot: 'bg-gray-400' },
  asleep: { bg: 'bg-gray-600/10', text: 'text-gray-500', dot: 'bg-gray-500' },
};

function getVehicleStyle(state?: string | null) {
  if (!state) return vehicleStateStyle.offline;
  return vehicleStateStyle[state.toLowerCase()] ?? vehicleStateStyle.offline;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${fmtInt(seconds)}s`;
  if (seconds < 3600) return `${fmtInt(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const mRaw = (seconds % 3600) / 60;
  return mRaw >= 0.5 ? `${h}h ${fmtInt(mRaw)}m` : `${h}h`;
}

interface StateResponse {
  state?: VehicleState;
  live?: boolean;
  data_source?: string;
}

/* ─── Stat summary row for the distribution table ─── */
interface StatSummaryRow {
  to_state: string;
  count: number;
  avg_interval_sec: number;
}

/* ─── Page Component ─── */
export default function StateMachineDebuggerPage() {
  const { t } = useTranslation();
  usePageTitle(t('fsm.title', 'FSM Debugger'));

  /* ─── Vehicle selector ─── */
  const { data: vehicles } = useVehicles();
  const [vehicleId, setVehicleId] = useState<string>('');
  const activeId = vehicleId || String(vehicles?.[0]?.id ?? '');

  /* ─── FSM filters ─── */
  const [fsmType, setFsmType] = useState<FSMType>('all');
  const [hours, setHours] = useState('24');
  const [serverPage, setServerPage] = useState(1);
  const [perPage, setPerPage] = useState(50);

  /* ─── Detail panel ─── */
  const [selectedId, setSelectedId] = useState<number | null>(null);

  /* ─── Data hooks ─── */
  const {
    data: stateData,
    isLoading: stateLoading,
    isFetching: stateFetching,
  } = useVehicleStateMachine(activeId);

  const {
    data: statsData,
    isLoading: statsLoading,
  } = useFSMStats(activeId);

  const {
    data: transData,
    isLoading: transLoading,
  } = useFSMTransitions(activeId, fsmType, Number(hours), serverPage, perPage);

  /* ─── Derived data ─── */
  const stateResponse = stateData as unknown as StateResponse | undefined;
  const currentState = stateResponse?.state;
  const stateName = currentState?.state?.toLowerCase() ?? null;
  const style = getVehicleStyle(stateName);

  const transitions: FSMTransition[] = transData?.data ?? [];
  const totalRows = transData?.total ?? 0;

  const flapIds = useMemo(() => computeFlapIds(transitions), [transitions]);

  /* ─── Pie chart data — state distribution ─── */
  const pieData = useMemo(() => {
    const byState = new Map<string, number>();
    for (const tr of transitions) {
      byState.set(tr.to_state, (byState.get(tr.to_state) ?? 0) + 1);
    }
    return Array.from(byState.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, value], i) => ({
        name,
        value,
        fill: CHART_COLORS[i % CHART_COLORS.length],
      }));
  }, [transitions]);

  /* ─── Stat summary rows (grouped by to_state) ─── */
  const summaryRows: StatSummaryRow[] = useMemo(() => {
    const byState = new Map<string, number[]>();
    const counts = new Map<string, number>();
    for (const tr of transitions) {
      const key = tr.to_state;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      const list = byState.get(key) ?? [];
      list.push(new Date(tr.created_at).getTime());
      byState.set(key, list);
    }

    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => {
        const times = byState.get(name) ?? [];
        let avgInterval = 0;
        if (times.length > 1) {
          const sorted = [...times].sort((a, b) => a - b);
          let totalGap = 0;
          for (let i = 1; i < sorted.length; i++) {
            totalGap += sorted[i] - sorted[i - 1];
          }
          avgInterval = totalGap / (sorted.length - 1) / 1000;
        }
        return { to_state: name, count, avg_interval_sec: avgInterval };
      });
  }, [transitions]);

  /* ─── DataTable columns — transition counts ─── */
  const summaryColumns: Column<StatSummaryRow>[] = useMemo(
    () => [
      {
        key: 'to_state',
        header: t('fsm.state', 'State'),
        render: (row: StatSummaryRow) => <StateBadge state={row.to_state} fsmType="vehicle" />,
      },
      {
        key: 'count',
        header: t('fsm.count', 'Transitions'),
        className: 'text-right',
        render: (row: StatSummaryRow) => (
          <span className="text-white/90 font-mono">{fmtInt(row.count)}</span>
        ),
      },
      {
        key: 'avg_interval',
        header: t('fsm.avgInterval', 'Avg Interval'),
        className: 'text-right',
        render: (row: StatSummaryRow) => (
          <span className="text-white/70 font-mono">
            {row.avg_interval_sec > 0 ? formatDuration(row.avg_interval_sec) : '—'}
          </span>
        ),
      },
    ],
    [t],
  );

  /* ─── DataTable columns — transition timeline with color-coded state badges ─── */
  const timelineColumns: Column<FSMTransition>[] = useMemo(
    () => [
      {
        key: 'index',
        header: '#',
        className: 'w-12 text-right',
        render: (_row: FSMTransition, _idx?: number) => {
          const rowIdx = transitions.indexOf(_row);
          const globalIdx = (serverPage - 1) * perPage + rowIdx + 1;
          return <span className="text-white/40 font-mono text-xs">{globalIdx}</span>;
        },
      },
      {
        key: 'time',
        header: t('fsm.time', 'Time'),
        render: (row: FSMTransition) => (
          <span className="text-white/70 font-mono text-xs whitespace-nowrap">
            {formatDateTime(row.created_at)}
          </span>
        ),
      },
      {
        key: 'fsm_type',
        header: t('fsm.type', 'FSM Type'),
        render: (row: FSMTransition) => (
          <span className="text-white/60 text-xs font-mono capitalize">{row.fsm_type?.replace('_', ' ') ?? 'vehicle'}</span>
        ),
      },
      {
        key: 'from_state',
        header: t('fsm.from', 'From'),
        render: (row: FSMTransition) => (
          <StateBadge state={row.from_state} fsmType={row.fsm_type || 'vehicle'} />
        ),
      },
      {
        key: 'to_state',
        header: t('fsm.to', 'To'),
        render: (row: FSMTransition) => (
          <StateBadge state={row.to_state} fsmType={row.fsm_type || 'vehicle'} />
        ),
      },
      {
        key: 'trigger',
        header: t('fsm.trigger', 'Trigger'),
        render: (row: FSMTransition) => (
          <span className="text-white/60 text-xs font-mono">{row.trigger}</span>
        ),
      },
      {
        key: 'detail',
        header: '',
        className: 'w-10',
        render: (row: FSMTransition) => (
          <Button
            variant="ghost"
            size="sm"
            aria-label={t('fsm.viewDetail', 'View detail')}
            onClick={(e) => {
              e.stopPropagation();
              setSelectedId(selectedId === row.id ? null : row.id);
            }}
          >
            {selectedId === row.id ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </Button>
        ),
      },
    ],
    [t, transitions, serverPage, perPage, selectedId],
  );

  const vehicleOptions = (vehicles ?? []).map((v) => ({
    value: String(v.id),
    label: v.display_name || v.vin,
  }));

  const hoursOptions = HOURS_OPTIONS.map((o) => ({
    value: o.value,
    label: o.label,
  }));

  const fsmTypeOptions = FSM_TYPE_OPTIONS.map((o) => ({
    value: o.value,
    label: o.label,
  }));

  const perPageOptions = [
    { value: '25', label: '25' },
    { value: '50', label: '50' },
    { value: '100', label: '100' },
  ];

  // Compute totals from transitions data
  const totalTransitionsOnPage = transitions.length;

  // Map transitions for timeline chart: use to_state as the grouping key
  const timelineTransitions = useMemo(() =>
    transitions.map(tr => ({ ...tr, fsm_type: tr.to_state })),
    [transitions],
  );

  return (
    <PageContainer
      title={t('fsm.title', 'FSM Debugger')}
      subtitle={t('fsm.subtitle', 'Multi-FSM transition analysis — vehicle, drive, charge, command, notification')}
      loading={stateLoading && transLoading && statsLoading}
      actions={
        <span className="flex items-center gap-1 text-xs text-white/40">
          <RefreshCw className={cn('h-3 w-3', stateFetching && 'animate-spin')} />
          {t('fsm.autoRefresh', 'Live 10s')}
        </span>
      }
    >
      {/* ──── Section 1: Filters ──── */}
      <FadeIn>
        <GlassPanel className="p-4 sm:p-5">
          {vehicleOptions.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <Select
                label={t('fsm.vehicle', 'Vehicle')}
                options={vehicleOptions}
                value={activeId}
                onChange={(e) => {
                  setVehicleId(e.target.value);
                  setServerPage(1);
                }}
              />
              <Select
                label={t('fsm.timeRange', 'Time Range')}
                options={hoursOptions}
                value={hours}
                onChange={(e) => {
                  setHours(e.target.value);
                  setServerPage(1);
                }}
              />
              <Select
                label={t('fsm.fsmType', 'FSM Type')}
                options={fsmTypeOptions}
                value={fsmType}
                onChange={(e) => {
                  setFsmType(e.target.value as FSMType);
                  setServerPage(1);
                }}
              />
              <Select
                label={t('fsm.perPage', 'Per Page')}
                options={perPageOptions}
                value={String(perPage)}
                onChange={(e) => {
                  setPerPage(Number(e.target.value));
                  setServerPage(1);
                }}
              />
            </div>
          ) : (
            <EmptyState message={t('fsm.noVehicles', 'No vehicles available')} />
          )}
        </GlassPanel>
      </FadeIn>

      {/* ──── Section 2: FSM Health Indicators ──── */}
      <FadeIn delay={0.05}>
        <FSMHealthPanel transitions={transitions} />
      </FadeIn>

      {/* ──── Section 3: Current Vehicle State ──── */}
      <FadeIn delay={0.1}>
        <GlassPanel className="p-6">
          <h2 className="text-xs font-medium text-white/50 uppercase tracking-wider mb-3">
            {t('fsm.vehicleLiveState', 'Vehicle Live State')}
          </h2>
          {stateLoading ? (
            <Skeleton height={80} />
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
              <div className="text-sm text-white/70 space-y-1">
                <p>
                  <span className="text-white/40">{t('fsm.type', 'FSM Type')}:</span>{' '}
                  <span className="text-white/90 font-medium">Vehicle</span>
                </p>
                <p>
                  <span className="text-white/40">{t('fsm.mode', 'Mode')}:</span>{' '}
                  <span className="text-white/90 font-medium">
                    {currentState.is_charging ? 'Charging' : currentState.speed && currentState.speed > 0 ? 'Drive' : currentState.state === 'asleep' ? 'Sleep' : 'Idle'}
                  </span>
                </p>
                <p>
                  <span className="text-white/40">{t('fsm.since', 'Since')}:</span>{' '}
                  <span className="text-white/90 font-medium">
                    {formatDateTime(currentState.since)}
                  </span>
                </p>
                <p className="text-white/50">{formatRelative(currentState.since)}</p>
              </div>
            </div>
          ) : (
            <EmptyState message={t('fsm.noState', 'No state data available')} />
          )}
        </GlassPanel>
      </FadeIn>

      {/* ──── Section 4: Sub-FSM Panel (active drive/charge context) ──── */}
      <FadeIn delay={0.15}>
        <FSMSubFSMPanel activeSubs={statsData?.active_subs} fsmType="all" />
      </FadeIn>

      {/* ──── Section 5: State Diagram ──── */}
      <FadeIn delay={0.2}>
        <FSMStateDiagram
          fsmType="vehicle"
          transitions={transitions}
        />
      </FadeIn>

      {/* ──── Section 6: Distribution + Counts ──── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <FadeIn delay={0.25}>
          <ChartContainer
            title={t('fsm.distributionByState', 'State Distribution')}
            loading={transLoading}
            height={280}
          >
            {pieData.length > 0 ? (
              <div className="flex flex-col items-center">
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={90}
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
                  {pieData.map((entry, i) => (
                    <div key={entry.name} className="flex items-center gap-1.5 text-xs">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                      />
                      <span className="text-white/70">{entry.name}</span>
                      <span className="text-white/50">{fmtInt(entry.value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <EmptyState message={t('fsm.noStats', 'No transition data recorded')} />
            )}
          </ChartContainer>
        </FadeIn>

        <FadeIn delay={0.3}>
          <GlassPanel className="p-5">
            <h2 className="text-sm font-semibold text-white/90 mb-4">
              {t('fsm.transitionCounts', 'Transition Counts')}
            </h2>
            {transLoading ? (
              <Skeleton height={200} />
            ) : summaryRows.length > 0 ? (
              <DataTable<StatSummaryRow>
                columns={summaryColumns}
                data={summaryRows}
                keyExtractor={(row) => row.to_state}
              />
            ) : (
              <EmptyState message={t('fsm.noTransitions', 'No transitions recorded')} />
            )}
          </GlassPanel>
        </FadeIn>
      </div>

      {/* ──── Section 7: Summary Cards ──── */}
      <FadeIn delay={0.25}>
        <Grid cols={{ default: 2, lg: 4 }} gap={4}>
          <StatCard
            label={t('fsm.totalOnPage', 'Transitions (Page)')}
            value={`${fmtInt(totalTransitionsOnPage)} / ${fmtInt(totalRows)}`}
            icon={<Activity className="h-4 w-4" />}
          />
          <StatCard
            label={t('fsm.totalTransitions', 'Total Transitions')}
            value={fmtInt(totalRows)}
            icon={<Activity className="h-4 w-4" />}
          />
          <StatCard
            label={t('fsm.flapCount', 'Flap Warnings')}
            value={fmtInt(flapIds.size)}
            icon={<AlertTriangle className="h-4 w-4" />}
          />
          <StatCard
            label={t('fsm.currentState', 'Current State')}
            value={stateName ?? '—'}
            icon={<Zap className="h-4 w-4" />}
          />
        </Grid>
      </FadeIn>

      {/* ──── Section 8: Transition Timeline Chart ──── */}
      <FadeIn delay={0.3}>
        <FSMTimelineChart transitions={timelineTransitions} hours={Number(hours)} />
      </FadeIn>

      {/* ──── Section 9: Transition Table ──── */}
      <FadeIn delay={0.25}>
        <GlassPanel className="p-5">
          <h2 className="text-sm font-semibold text-white/90 mb-4">
            {t('fsm.timelineTitle', 'Transition Log')}
            {totalRows > 0 && (
              <span className="ml-2 text-white/50 font-normal">
                {fmtInt(totalRows)} {t('fsm.total', 'total')}
              </span>
            )}
          </h2>
          {transLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} height={48} />
              ))}
            </div>
          ) : transitions.length > 0 ? (
            <>
              <DataTable<FSMTransition>
                columns={timelineColumns}
                data={transitions}
                keyExtractor={(tr) => String(tr.id)}
                compact
              />
              <Pagination
                page={serverPage}
                pageSize={perPage}
                total={totalRows}
                onPageChange={setServerPage}
                onPageSizeChange={(size) => {
                  setPerPage(size);
                  setServerPage(1);
                }}
                pageSizeOptions={[25, 50, 100]}
              />
            </>
          ) : (
            <EmptyState message={t('fsm.noTimeline', 'No transitions in selected time range')} />
          )}
        </GlassPanel>
      </FadeIn>

      {/* ──── Section 10: Selected Transition Detail ──── */}
      {selectedId != null && (() => {
        const selected = transitions.find((tr) => tr.id === selectedId);
        return selected ? (
          <FadeIn key={selectedId}>
            <GlassPanel className="p-5">
              <h2 className="text-sm font-semibold text-white/90 mb-4">
                {t('fsm.detailTitle', 'Transition Detail')}
              </h2>
              <TransitionDetail transition={selected} />
            </GlassPanel>
          </FadeIn>
        ) : null;
      })()}
    </PageContainer>
  );
}

/* ─── Transition Detail Panel ─── */
function TransitionDetail({ transition }: { transition: FSMTransition }) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
      <div>
        <span className="text-white/40 block mb-1">{t('fsm.detail.id', 'Transition ID')}</span>
        <span className="text-white/80 font-mono break-all">{transition.id}</span>
      </div>
      <div>
        <span className="text-white/40 block mb-1">{t('fsm.detail.vehicleId', 'Vehicle ID')}</span>
        <span className="text-white/80 font-mono">{transition.vehicle_id}</span>
      </div>
      {transition.fsm_instance_id != null && (
        <div>
          <span className="text-white/40 block mb-1">{t('fsm.detail.instanceId', 'Instance ID')}</span>
          <span className="text-white/80 font-mono">{transition.fsm_instance_id}</span>
        </div>
      )}
      <div>
        <span className="text-white/40 block mb-1">{t('fsm.detail.from', 'From State')}</span>
        <StateBadge state={transition.from_state} fsmType="vehicle" />
      </div>
      <div>
        <span className="text-white/40 block mb-1">{t('fsm.detail.to', 'To State')}</span>
        <StateBadge state={transition.to_state} fsmType="vehicle" />
      </div>
      <div>
        <span className="text-white/40 block mb-1">{t('fsm.detail.trigger', 'Trigger')}</span>
        <span className="text-white/80 font-mono">{transition.trigger}</span>
      </div>
      {transition.guard && (
        <div>
          <span className="text-white/40 block mb-1">{t('fsm.detail.guard', 'Guard')}</span>
          <span className="text-white/80 font-mono">{transition.guard}</span>
        </div>
      )}
      {transition.duration_in_state_ms > 0 && (
        <div>
          <span className="text-white/40 block mb-1">{t('fsm.detail.duration', 'Duration in State')}</span>
          <span className="text-white/80 font-mono">{formatDuration(transition.duration_in_state_ms / 1000)}</span>
        </div>
      )}
      <div className="sm:col-span-2 lg:col-span-4">
        <span className="text-white/40 block mb-1">{t('fsm.detail.timestamp', 'Timestamp')}</span>
        <span className="text-white/80 font-mono">{formatDateTime(transition.created_at)}</span>
        <span className="text-white/50 ml-2">{formatRelative(transition.created_at)}</span>
      </div>
      {transition.context_snapshot && Object.keys(transition.context_snapshot).length > 0 && (
        <div className="sm:col-span-2 lg:col-span-4">
          <span className="text-white/40 block mb-1">{t('fsm.detail.context', 'Context Snapshot')}</span>
          <div className="flex flex-wrap gap-2 mt-1">
            {Object.entries(transition.context_snapshot).map(([key, val]) => (
              <span key={key} className="px-2 py-0.5 rounded bg-white/[0.04] text-white/60 font-mono text-[10px]">
                {key}: {String(val)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
