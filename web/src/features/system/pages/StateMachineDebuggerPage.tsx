import { useState, useMemo, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { RefreshCw, ChevronDown, ChevronRight, Activity, Zap, AlertTriangle } from 'lucide-react';
import { PageContainer, Grid } from '@/components/layout';
import { GlassPanel, Button, DataTable, HelpTooltip, Select, Pagination, CopyButton } from '@/components/ui';
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
import { useSignalSnapshot } from '@/api/hooks/useTelemetry';
import type { VehicleState } from '@/api/types';
import { usePageTitle } from '@/hooks/usePageTitle';
import { fmtInt } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import type { FSMTransition, FSMType } from '@/types/fsm';
import { HOURS_OPTIONS, FSM_TYPE_OPTIONS } from '@/types/fsm';
import { StateBadge } from '../components/StateBadge';
import { TimeStamp } from '@/components/data-display';
import { FSMStateDiagram } from '../components/FSMStateDiagram';
import { FSMHealthPanel, computeFlapIds } from '../components/FSMHealthPanel';
import { FSMTimelineChart } from '../components/FSMTimelineChart';
import { FSMSubFSMPanel } from '../components/FSMSubFSMPanel';
import { StateTimeline } from '../components/state-machine/StateTimeline';
import { LiveControls } from '../components/state-machine/LiveControls';
import { SnapshotInspector } from '../components/state-machine/SnapshotInspector';

/* ─── Vehicle state styling (for live state hero) ─── */
const vehicleStateStyle: Record<string, { bg: string; text: string; dot: string }> = {
  driving: { bg: 'bg-green-500/10', text: 'text-green-400', dot: 'bg-green-400' },
  charging: { bg: 'bg-cyan-500/10', text: 'text-cyan-400', dot: 'bg-cyan-400' },
  parked: { bg: 'bg-purple-500/10', text: 'text-purple-400', dot: 'bg-purple-400' },
  online: { bg: 'bg-blue-500/10', text: 'text-blue-400', dot: 'bg-blue-400' },
  offline: { bg: 'bg-gray-500/10', text: 'text-[var(--text-secondary)]', dot: 'bg-gray-400' },
  asleep: { bg: 'bg-gray-600/10', text: 'text-[var(--text-muted)]', dot: 'bg-gray-500' },
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
  const [searchParams, setSearchParams] = useSearchParams();
  const [vehicleId, setVehicleId] = useState<string>(() => searchParams.get('vehicle') ?? '');
  const activeId = vehicleId || String(vehicles?.[0]?.id ?? '');

  /* ─── FSM filters ─── */
  const initialFsm = (searchParams.get('fsm') ?? 'all') as FSMType;
  const [fsmType, setFsmType] = useState<FSMType>(initialFsm);
  const [hours, setHours] = useState('24');
  const [serverPage, setServerPage] = useState(1);
  const [perPage, setPerPage] = useState(50);

  /* ─── Detail panel ─── */
  const [selectedId, setSelectedId] = useState<number | null>(() => {
    const id = searchParams.get('selected');
    return id ? Number(id) : null;
  });

  /* ─── Phase 40 / Prompt 58 — live/freeze + timeline window ─── */
  const initialAt = searchParams.get('at');
  const [isLive, setIsLive] = useState<boolean>(!initialAt);
  const [windowMinutes, setWindowMinutes] = useState(10);
  const [bufferClearedAt, setBufferClearedAt] = useState<Date | null>(null);

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
        render: (row: StatSummaryRow) => <StateBadge state={row.to_state} fsmType={fsmType === 'all' ? 'vehicle' : fsmType} />,
      },
      {
        key: 'count',
        header: t('fsm.count', 'Transitions'),
        className: 'text-right',
        render: (row: StatSummaryRow) => (
          <span className="text-[var(--text-primary)] font-mono">{fmtInt(row.count)}</span>
        ),
      },
      {
        key: 'avg_interval',
        header: t('fsm.avgInterval', 'Avg Interval'),
        className: 'text-right',
        render: (row: StatSummaryRow) => (
          <span className="text-[var(--text-secondary)] font-mono">
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
          return <span className="text-[var(--text-muted)] font-mono text-xs">{globalIdx}</span>;
        },
      },
      {
        key: 'time',
        header: t('fsm.time', 'Time'),
        render: (row: FSMTransition) => (
          <TimeStamp
            value={row.created_at}
            className="text-[var(--text-secondary)] font-mono text-xs whitespace-nowrap"
          />
        ),
      },
      {
        key: 'fsm_type',
        header: t('fsm.type', 'FSM Type'),
        render: (row: FSMTransition) => (
          <span className="text-[var(--text-secondary)] text-xs font-mono capitalize">{row.fsm_type?.replace('_', ' ') ?? 'vehicle'}</span>
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
          <span className="text-[var(--text-secondary)] text-xs font-mono">{row.trigger}</span>
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

  /* ─── Phase 40 / Prompt 58 — derived selection + step navigation ─── */
  const sortedByTime = useMemo(
    () => [...transitions].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    ),
    [transitions],
  );

  const selectedTransition = useMemo(
    () => (selectedId != null ? transitions.find((tr) => tr.id === selectedId) ?? null : null),
    [transitions, selectedId],
  );
  const selectedIndex = useMemo(
    () => (selectedTransition ? sortedByTime.findIndex((tr) => tr.id === selectedTransition.id) : -1),
    [sortedByTime, selectedTransition],
  );

  const previousTransition = useMemo(() => {
    if (selectedIndex <= 0) return null;
    return sortedByTime[selectedIndex - 1] ?? null;
  }, [sortedByTime, selectedIndex]);

  const visibleTransitions = useMemo(() => {
    if (!bufferClearedAt) return sortedByTime;
    return sortedByTime.filter((tr) => new Date(tr.created_at) >= bufferClearedAt);
  }, [sortedByTime, bufferClearedAt]);

  const handleStepPrev = useCallback(() => {
    if (sortedByTime.length === 0) return;
    setIsLive(false);
    if (selectedIndex <= 0) {
      setSelectedId(sortedByTime[0].id);
    } else {
      setSelectedId(sortedByTime[selectedIndex - 1].id);
    }
  }, [sortedByTime, selectedIndex]);

  const handleStepNext = useCallback(() => {
    if (sortedByTime.length === 0) return;
    setIsLive(false);
    if (selectedIndex < 0) {
      setSelectedId(sortedByTime[sortedByTime.length - 1].id);
    } else if (selectedIndex < sortedByTime.length - 1) {
      setSelectedId(sortedByTime[selectedIndex + 1].id);
    }
  }, [sortedByTime, selectedIndex]);

  const handleClearBuffer = useCallback(() => {
    setBufferClearedAt(new Date());
    setSelectedId(null);
  }, []);

  /* ─── Snapshot hooks: live (when no `at`) + selected/previous (when frozen) ─── */
  const selectedAtIso = selectedTransition?.created_at ?? '';
  const previousAtIso = previousTransition?.created_at ?? '';
  const numericVehicleId = Number(activeId) || 0;

  const { data: selectedSnapshot, isFetching: snapshotFetching } = useSignalSnapshot(
    numericVehicleId,
    selectedAtIso,
    '',
    { enabled: numericVehicleId > 0 && Boolean(selectedAtIso) },
  );

  const { data: previousSnapshot } = useSignalSnapshot(
    numericVehicleId,
    previousAtIso,
    '',
    { enabled: numericVehicleId > 0 && Boolean(previousAtIso) },
  );

  /* ─── Permalink: keep ?vehicle / ?fsm / ?selected / ?at in sync ─── */
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (activeId) next.set('vehicle', activeId);
    else next.delete('vehicle');
    if (fsmType && fsmType !== 'all') next.set('fsm', fsmType);
    else next.delete('fsm');
    if (selectedId != null) next.set('selected', String(selectedId));
    else next.delete('selected');
    if (!isLive && selectedAtIso) next.set('at', selectedAtIso);
    else next.delete('at');
    setSearchParams(next, { replace: true });
  }, [activeId, fsmType, selectedId, isLive, selectedAtIso, searchParams, setSearchParams]);

  const permalinkUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}${window.location.pathname}?${searchParams.toString()}`;
  }, [searchParams]);

  return (
    <PageContainer
      title={t('fsm.title', 'FSM Debugger')}
      subtitle={t('fsm.subtitle', 'Multi-FSM transition analysis — vehicle, drive, charge, command, notification')}
      loading={stateLoading && transLoading && statsLoading}
      actions={
        <div className="flex items-center gap-2" data-tour="debugger-share">
          <span className="hidden items-center gap-1 text-xs text-[var(--text-muted)] sm:flex">
            <RefreshCw className={cn('h-3 w-3', stateFetching && 'animate-spin')} />
            {t('fsm.autoRefresh', 'Live 10s')}
          </span>
          {permalinkUrl ? (
            <CopyButton
              text={permalinkUrl}
              label={t('debugger.share', 'Share permalink')}
              size="sm"
            />
          ) : null}
        </div>
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
              <div className="space-y-1">
                <label
                  htmlFor="fsm-type-select"
                  className="flex items-center gap-1 text-sm font-medium text-[var(--text-secondary)]"
                >
                  {t('fsm.fsmType', 'FSM Type')}
                  <HelpTooltip
                    i18nKey="help.fsm.type"
                    defaultValue="Finite-state machine. Tracks vehicle high-level state (driving, charging, parked, online, asleep, offline) and the transitions between them. Sub-FSMs cover drive, charge, command, and notification lifecycles."
                    ariaLabel={t('help.fsm.type.aria', { defaultValue: 'More info about FSM types' })}
                  />
                </label>
                <Select
                  id="fsm-type-select"
                  options={fsmTypeOptions}
                  value={fsmType}
                  onChange={(e) => {
                    setFsmType(e.target.value as FSMType);
                    setServerPage(1);
                  }}
                />
              </div>
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
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('fsm.noVehicles', 'No vehicles available')} />
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
          <h2 className="flex items-center gap-1 text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-3">
            {t('fsm.vehicleLiveState', 'Vehicle Live State')}
            <HelpTooltip
              size="xs"
              i18nKey="help.fsm.liveState"
              defaultValue="The current state the FSM resolved to from the most recent telemetry. The FSM stays in a terminal state until external evidence (telemetry or poll) triggers an explicit transition out."
              ariaLabel={t('help.fsm.liveState.aria', { defaultValue: 'More info about FSM live state' })}
            />
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
              <div className="text-sm text-[var(--text-secondary)] space-y-1">
                <p>
                  <span className="text-[var(--text-muted)]">{t('fsm.type', 'FSM Type')}:</span>{' '}
                  <span className="text-[var(--text-primary)] font-medium">Vehicle</span>
                </p>
                <p>
                  <span className="text-[var(--text-muted)]">{t('fsm.mode', 'Mode')}:</span>{' '}
                  <span className="text-[var(--text-primary)] font-medium">
                    {currentState.is_charging ? 'Charging' : currentState.speed && currentState.speed > 0 ? 'Drive' : currentState.state === 'asleep' ? 'Sleep' : 'Idle'}
                  </span>
                </p>
                <p>
                  <span className="text-[var(--text-muted)]">{t('fsm.since', 'Since')}:</span>{' '}
                  <TimeStamp
                    value={currentState.since}
                    format="absolute"
                    className="text-[var(--text-primary)] font-medium"
                  />
                </p>
                <p className="text-[var(--text-muted)]">
                  <TimeStamp value={currentState.since} format="relative" />
                </p>
              </div>
            </div>
          ) : (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('fsm.noState', 'No state data available')} />
          )}
        </GlassPanel>
      </FadeIn>

      {/* ──── Section 4: Sub-FSM Panel (active drive/charge context) ──── */}
      <FadeIn delay={0.15}>
        <FSMSubFSMPanel activeSubs={statsData?.active_subs} fsmType={fsmType === 'all' ? 'vehicle' : fsmType} />
      </FadeIn>

      {/* ──── Phase 40 / Prompt 58 — Live controls + state timeline + inspector ──── */}
      <FadeIn delay={0.18}>
        <GlassPanel className="p-4 sm:p-5 space-y-4" data-tour="debugger-timeline">
          <div data-tour="debugger-controls">
          <LiveControls
            isLive={isLive}
            onToggleLive={(live) => {
              setIsLive(live);
              if (live) setSelectedId(null);
            }}
            onStepPrev={handleStepPrev}
            onStepNext={handleStepNext}
            canStepPrev={!isLive && sortedByTime.length > 0 && selectedIndex > 0}
            canStepNext={!isLive && sortedByTime.length > 0 && selectedIndex < sortedByTime.length - 1}
            windowMinutes={windowMinutes}
            onWindowChange={setWindowMinutes}
            onClearBuffer={handleClearBuffer}
            bufferCount={visibleTransitions.length}
          />
          </div>
          <StateTimeline
            transitions={visibleTransitions}
            fsmType={fsmType === 'all' ? 'vehicle' : fsmType}
            selectedId={selectedId}
            onSelect={(tr) => {
              setSelectedId(tr.id);
              setIsLive(false);
            }}
            windowMinutes={windowMinutes}
          />
          <div data-tour="debugger-source-badges">
          <SnapshotInspector
            fsmType={selectedTransition?.fsm_type || (fsmType === 'all' ? 'vehicle' : fsmType)}
            transition={selectedTransition}
            snapshot={selectedSnapshot ?? null}
            previousSnapshot={previousSnapshot ?? null}
            loading={snapshotFetching}
          />
          </div>
        </GlassPanel>
      </FadeIn>

      {/* ──── Section 5: State Diagram ──── */}
      <FadeIn delay={0.2}>
        <FSMStateDiagram
          fsmType={fsmType === 'all' ? 'vehicle' : fsmType}
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
                      <span className="text-[var(--text-secondary)]">{entry.name}</span>
                      <span className="text-[var(--text-muted)]">{fmtInt(entry.value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('fsm.noStats', 'No transition data recorded')} />
            )}
          </ChartContainer>
        </FadeIn>

        <FadeIn delay={0.3}>
          <GlassPanel className="p-5">
            <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-4">
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
              <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('fsm.noTransitions', 'No transitions recorded')} />
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
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-4">
            {t('fsm.timelineTitle', 'Transition Log')}
            {totalRows > 0 && (
              <span className="ml-2 text-[var(--text-muted)] font-normal">
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
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('fsm.noTimeline', 'No transitions in selected time range')} />
          )}
        </GlassPanel>
      </FadeIn>

      {/* ──── Section 10: Selected Transition Detail ──── */}
      {selectedId != null && (() => {
        const selected = transitions.find((tr) => tr.id === selectedId);
        return selected ? (
          <FadeIn key={selectedId}>
            <GlassPanel className="p-5">
              <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-4">
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
        <span className="text-[var(--text-muted)] block mb-1">{t('fsm.detail.id', 'Transition ID')}</span>
        <span className="text-[var(--text-primary)] font-mono break-all">{transition.id}</span>
      </div>
      <div>
        <span className="text-[var(--text-muted)] block mb-1">{t('fsm.detail.vehicleId', 'Vehicle ID')}</span>
        <span className="text-[var(--text-primary)] font-mono">{transition.vehicle_id}</span>
      </div>
      {transition.fsm_instance_id != null && (
        <div>
          <span className="text-[var(--text-muted)] block mb-1">{t('fsm.detail.instanceId', 'Instance ID')}</span>
          <span className="text-[var(--text-primary)] font-mono">{transition.fsm_instance_id}</span>
        </div>
      )}
      <div>
        <span className="text-[var(--text-muted)] block mb-1">{t('fsm.detail.from', 'From State')}</span>
        <StateBadge state={transition.from_state} fsmType={transition.fsm_type || 'vehicle'} />
      </div>
      <div>
        <span className="text-[var(--text-muted)] block mb-1">{t('fsm.detail.to', 'To State')}</span>
        <StateBadge state={transition.to_state} fsmType={transition.fsm_type || 'vehicle'} />
      </div>
      <div>
        <span className="text-[var(--text-muted)] block mb-1">{t('fsm.detail.trigger', 'Trigger')}</span>
        <span className="text-[var(--text-primary)] font-mono">{transition.trigger}</span>
      </div>
      {transition.guard && (
        <div>
          <span className="text-[var(--text-muted)] block mb-1">{t('fsm.detail.guard', 'Guard')}</span>
          <span className="text-[var(--text-primary)] font-mono">{transition.guard}</span>
        </div>
      )}
      {transition.duration_in_state_ms > 0 && (
        <div>
          <span className="text-[var(--text-muted)] block mb-1">{t('fsm.detail.duration', 'Duration in State')}</span>
          <span className="text-[var(--text-primary)] font-mono">{formatDuration(transition.duration_in_state_ms / 1000)}</span>
        </div>
      )}
      <div className="sm:col-span-2 lg:col-span-4">
        <span className="text-[var(--text-muted)] block mb-1">{t('fsm.detail.timestamp', 'Timestamp')}</span>
        <TimeStamp
          value={transition.created_at}
          format="absolute"
          className="text-[var(--text-primary)] font-mono"
        />
        <span className="ml-2">
          <TimeStamp
            value={transition.created_at}
            format="relative"
            className="text-[var(--text-muted)]"
          />
        </span>
      </div>
      {transition.context_snapshot && Object.keys(transition.context_snapshot).length > 0 && (
        <div className="sm:col-span-2 lg:col-span-4">
          <span className="text-[var(--text-muted)] block mb-1">{t('fsm.detail.context', 'Context Snapshot')}</span>
          <div className="flex flex-wrap gap-2 mt-1">
            {Object.entries(transition.context_snapshot).map(([key, val]) => (
              <span key={key} className="px-2 py-0.5 rounded bg-white/[0.04] text-[var(--text-secondary)] font-mono text-[10px]">
                {key}: {String(val)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
