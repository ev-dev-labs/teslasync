import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, ChevronDown, ChevronRight, Clock, Activity, Layers, Zap } from 'lucide-react';
import { PageContainer, Grid } from '@/components/layout';
import { GlassPanel, Badge, Button, DataTable, Select, Pagination } from '@/components/ui';
import type { Column } from '@/components/ui';
import { StatCard, FSMBadge, TransitionArrow } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import { Skeleton, EmptyState } from '@/components/feedback';
import {
  ChartContainer, PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  ChartTooltip, CHART_COLORS,
} from '@/components/charts';
import { useVehicleStateMachine } from '@/api/hooks/useAdmin';
import { useFSMStats, useFSMTransitions } from '@/api/hooks/useFSM';
import { useVehicles } from '@/api/hooks/useVehicles';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDateTime, formatRelative } from '@/lib/dateFormat';
import { fmtInt } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import type { FSMTransition, FSMType } from '@/types/fsm';
import { FSM_TYPE_OPTIONS, HOURS_OPTIONS } from '@/types/fsm';

/* ─── Vehicle state styling ─── */
const stateStyle: Record<string, { bg: string; text: string; dot: string }> = {
  driving: { bg: 'bg-green-500/10', text: 'text-green-400', dot: 'bg-green-400' },
  charging: { bg: 'bg-amber-500/10', text: 'text-amber-400', dot: 'bg-amber-400' },
  parked: { bg: 'bg-cyan-500/10', text: 'text-cyan-400', dot: 'bg-cyan-400' },
  online: { bg: 'bg-blue-500/10', text: 'text-blue-400', dot: 'bg-blue-400' },
  offline: { bg: 'bg-gray-500/10', text: 'text-gray-400', dot: 'bg-gray-400' },
  asleep: { bg: 'bg-purple-500/10', text: 'text-purple-400', dot: 'bg-purple-400' },
};

const stateVariant: Record<string, 'success' | 'warning' | 'info' | 'danger' | 'neutral'> = {
  driving: 'success',
  charging: 'warning',
  parked: 'info',
  online: 'info',
  offline: 'danger',
  asleep: 'neutral',
};

function getStyle(state?: string | null) {
  if (!state) return stateStyle.offline;
  return stateStyle[state.toLowerCase()] ?? stateStyle.offline;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${fmtInt(seconds)}s`;
  if (seconds < 3600) return `${fmtInt(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const mRaw = (seconds % 3600) / 60;
  return mRaw >= 0.5 ? `${h}h ${fmtInt(mRaw)}m` : `${h}h`;
}

interface StateResponse {
  state?: { state?: string; since?: string };
  live?: boolean;
}

/* ─── Flap detection: >5 transitions of same FSM within any 1-min window ─── */
function detectFlaps(transitions: FSMTransition[]): Set<string> {
  const flapped = new Set<string>();
  const byType = new Map<string, FSMTransition[]>();
  for (const tr of transitions) {
    const list = byType.get(tr.fsm_name) ?? [];
    list.push(tr);
    byType.set(tr.fsm_name, list);
  }
  for (const [, list] of byType) {
    const sorted = [...list].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
    for (let i = 0; i < sorted.length; i++) {
      const windowEnd = new Date(sorted[i].created_at).getTime() + 60_000;
      let count = 0;
      for (let j = i; j < sorted.length; j++) {
        if (new Date(sorted[j].created_at).getTime() <= windowEnd) {
          count++;
        } else break;
      }
      if (count > 5) {
        for (let j = i; j < sorted.length; j++) {
          if (new Date(sorted[j].created_at).getTime() <= windowEnd) {
            flapped.add(sorted[j].id);
          } else break;
        }
      }
    }
  }
  return flapped;
}

/* ─── Stat summary row for the distribution table ─── */
interface StatSummaryRow {
  fsm_name: string;
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
  const [hours, setHours] = useState('1');
  const [serverPage, setServerPage] = useState(1);
  const [perPage, setPerPage] = useState(50);

  /* ─── Detail panel ─── */
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
  const style = getStyle(stateName);

  const stats = statsData?.stats ?? {};
  const transitions: FSMTransition[] = transData?.data ?? [];
  const totalRows = transData?.total ?? 0;

  const flapIds = useMemo(() => detectFlaps(transitions), [transitions]);

  /* ─── Pie chart data (from transitions — actual state distribution) ─── */
  const pieData = useMemo(() => {
    const byState = new Map<string, number>();
    for (const tr of transitions) {
      const state = tr.to_state;
      if (state) {
        byState.set(state, (byState.get(state) ?? 0) + 1);
      }
    }
    return Array.from(byState.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, value], i) => ({
        name,
        value,
        fill: CHART_COLORS[i % CHART_COLORS.length],
      }));
  }, [transitions]);

  /* ─── Stat summary rows (deduplicated — skip camelCase duplicates) ─── */
  const summaryRows: StatSummaryRow[] = useMemo(() => {
    // Compute average interval between transitions per FSM type
    const byType = new Map<string, number[]>();
    for (const tr of transitions) {
      const list = byType.get(tr.fsm_name) ?? [];
      list.push(new Date(tr.created_at).getTime());
      byType.set(tr.fsm_name, list);
    }
    // Filter stats to only snake_case keys (skip camelCase duplicates from response transformer)
    const cleanEntries = Object.entries(stats).filter(([key]) => {
      if (!key.includes('_')) {
        // Check if a snake_case equivalent exists — if so, this is a camelCase duplicate
        return !Object.keys(stats).some(
          k => k.includes('_') && k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase()) === key
        );
      }
      return true;
    });
    return cleanEntries
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => {
        const times = byType.get(name) ?? [];
        let avgInterval = 0;
        if (times.length > 1) {
          const sorted = [...times].sort((a, b) => a - b);
          let totalGap = 0;
          for (let i = 1; i < sorted.length; i++) {
            totalGap += sorted[i] - sorted[i - 1];
          }
          avgInterval = totalGap / (sorted.length - 1) / 1000;
        }
        return { fsm_name: name, count, avg_interval_sec: avgInterval };
      });
  }, [stats, transitions]);

  /* ─── DataTable columns — transition counts ─── */
  const summaryColumns: Column<StatSummaryRow>[] = useMemo(
    () => [
      {
        key: 'fsm_name',
        header: t('fsm.type', 'FSM Type'),
        render: (row: StatSummaryRow) => <FSMBadge type={row.fsm_name} />,
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

  /* ─── DataTable columns — transition timeline ─── */
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
        key: 'fsm_name',
        header: t('fsm.type', 'FSM Type'),
        render: (row: FSMTransition) => <FSMBadge type={row.fsm_name} />,
      },
      {
        key: 'transition',
        header: t('fsm.transition', 'From → To'),
        render: (row: FSMTransition) => (
          <TransitionArrow from={row.from_state} to={row.to_state} />
        ),
      },
      {
        key: 'event',
        header: t('fsm.trigger', 'Trigger'),
        render: (row: FSMTransition) => (
          <span className="text-white/60 text-xs font-mono">{row.event}</span>
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

  const fsmTypeOptions = FSM_TYPE_OPTIONS.map((o) => ({
    value: o.value,
    label: o.label,
  }));

  const hoursOptions = HOURS_OPTIONS.map((o) => ({
    value: o.value,
    label: o.label,
  }));

  const perPageOptions = [
    { value: '25', label: '25' },
    { value: '50', label: '50' },
    { value: '100', label: '100' },
  ];

  const totalTransitions = Object.values(stats).reduce((a, b) => a + b, 0);
  const fsmTypeCount = Object.keys(stats).length;

  return (
    <PageContainer
      title={t('fsm.title', 'FSM Debugger')}
      subtitle={t('fsm.subtitle', 'Finite state machine transitions, distribution, and context analysis')}
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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
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
                label={t('fsm.fsmType', 'FSM Type')}
                options={fsmTypeOptions}
                value={fsmType}
                onChange={(e) => {
                  setFsmType(e.target.value as FSMType);
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

      {/* ──── Section 2: Current Vehicle State ──── */}
      <FadeIn delay={0.05}>
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
              <div className="text-sm text-white/70">
                <p>
                  {t('fsm.since', 'Since')}:{' '}
                  <span className="text-white/90 font-medium">
                    {formatDateTime(currentState.since)}
                  </span>
                </p>
                <p className="text-white/50 mt-1">{formatRelative(currentState.since)}</p>
              </div>
            </div>
          ) : (
            <EmptyState message={t('fsm.noState', 'No state data available')} />
          )}
        </GlassPanel>
      </FadeIn>

      {/* ──── Section 3: Distribution + Counts ──── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <FadeIn delay={0.1}>
          <ChartContainer
            title={t('fsm.distribution', 'Transition Distribution')}
            loading={statsLoading}
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

        <FadeIn delay={0.15}>
          <GlassPanel className="p-5">
            <h2 className="text-sm font-semibold text-white/90 mb-4">
              {t('fsm.transitionCounts', 'Transition Counts')}
            </h2>
            {statsLoading ? (
              <Skeleton height={200} />
            ) : summaryRows.length > 0 ? (
              <DataTable<StatSummaryRow>
                columns={summaryColumns}
                data={summaryRows}
                keyExtractor={(row) => row.fsm_name}
              />
            ) : (
              <EmptyState message={t('fsm.noTransitions', 'No transitions recorded')} />
            )}
          </GlassPanel>
        </FadeIn>
      </div>

      {/* ──── Section 4: Summary Cards ──── */}
      <FadeIn delay={0.2}>
        <Grid cols={{ default: 2, lg: 4 }} gap={4}>
          <StatCard
            label={t('fsm.totalTransitions', 'Total Transitions')}
            value={fmtInt(totalTransitions)}
            icon={<Activity className="h-4 w-4" />}
          />
          <StatCard
            label={t('fsm.fsmTypes', 'FSM Types')}
            value={fmtInt(fsmTypeCount)}
            icon={<Layers className="h-4 w-4" />}
          />
          <StatCard
            label={t('fsm.pageResults', 'Page Results')}
            value={`${fmtInt(transitions.length)} / ${fmtInt(totalRows)}`}
            icon={<Clock className="h-4 w-4" />}
          />
          <StatCard
            label={t('fsm.currentState', 'Current State')}
            value={stateName ?? '—'}
            icon={<Zap className="h-4 w-4" />}
          />
        </Grid>
      </FadeIn>

      {/* ──── Section 5: Transition Timeline ──── */}
      <FadeIn delay={0.25}>
        <GlassPanel className="p-5">
          <h2 className="text-sm font-semibold text-white/90 mb-4">
            {t('fsm.timelineTitle', 'Transition Timeline')}
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
                keyExtractor={(tr) => tr.id}
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
              {/* Flap detection warning */}
              {flapIds.size > 0 && (
                <div className="mt-3 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400">
                  ⚠ {t('fsm.flapWarning', '{{count}} transitions flagged as potential state flapping (>5 same-FSM transitions within 1 minute)', { count: flapIds.size })}
                </div>
              )}
            </>
          ) : (
            <EmptyState message={t('fsm.noTimeline', 'No transitions in selected time range')} />
          )}
        </GlassPanel>
      </FadeIn>

      {/* ──── Section 6: Selected Transition Detail ──── */}
      {selectedId && (() => {
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
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
      <div>
        <span className="text-white/40 block mb-1">{t('fsm.detail.id', 'Transition ID')}</span>
        <span className="text-white/80 font-mono break-all">{transition.id}</span>
      </div>
      <div>
        <span className="text-white/40 block mb-1">{t('fsm.detail.entityId', 'Entity ID')}</span>
        <span className="text-white/80 font-mono">{transition.entity_id}</span>
      </div>
      <div>
        <span className="text-white/40 block mb-1">{t('fsm.detail.fsmName', 'FSM Name')}</span>
        <FSMBadge type={transition.fsm_name} />
      </div>
      <div>
        <span className="text-white/40 block mb-1">{t('fsm.detail.from', 'From State')}</span>
        <Badge variant={stateVariant[transition.from_state.toLowerCase()] ?? 'neutral'} dot>
          {transition.from_state}
        </Badge>
      </div>
      <div>
        <span className="text-white/40 block mb-1">{t('fsm.detail.to', 'To State')}</span>
        <Badge variant={stateVariant[transition.to_state.toLowerCase()] ?? 'neutral'} dot>
          {transition.to_state}
        </Badge>
      </div>
      <div>
        <span className="text-white/40 block mb-1">{t('fsm.detail.event', 'Event / Trigger')}</span>
        <span className="text-white/80 font-mono">{transition.event}</span>
      </div>
      <div className="sm:col-span-2 lg:col-span-3">
        <span className="text-white/40 block mb-1">{t('fsm.detail.timestamp', 'Timestamp')}</span>
        <span className="text-white/80 font-mono">{formatDateTime(transition.created_at)}</span>
        <span className="text-white/50 ml-2">{formatRelative(transition.created_at)}</span>
      </div>
    </div>
  );
}
