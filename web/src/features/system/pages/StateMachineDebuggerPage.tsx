import { useState, useMemo, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { RefreshCw, ChevronDown, ChevronRight, Activity, Zap, AlertTriangle } from 'lucide-react';
import { PageContainer } from '@/components/layout';
import { GlassPanel, Button, DataTable, HelpTooltip, Select, Pagination, CopyButton, PanelTitle, Caption, Text } from '@/components/ui';
import { RangePicker, VehicleSelect } from '@/components/forms';
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
import { useSignalSnapshot } from '@/api/hooks/useTelemetry';
import type { VehicleState } from '@/api/types';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useRangeState } from '@/hooks/useRangeState';
import { useTimezone } from '@/lib/timezone';
import { fmtInt } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import type { FSMTransition, FSMType } from '@/types/fsm';
import { FSM_TYPE_OPTIONS } from '@/types/fsm';
import { StateBadge } from '../components/StateBadge';
import { TimeStamp } from '@/components/data-display';
import { FSMStateDiagram } from '../components/FSMStateDiagram';
import { FSMHealthPanel, computeFlapIds } from '../components/FSMHealthPanel';
import { FSMTimelineChart } from '../components/FSMTimelineChart';
import { FSMSubFSMPanel } from '../components/FSMSubFSMPanel';
import { StateTimeline } from '../components/state-machine/StateTimeline';
import { LiveControls } from '../components/state-machine/LiveControls';
import { SnapshotInspector } from '../components/state-machine/SnapshotInspector';
import { AIStateMachineDebuggerNarrator } from '@/components/ai/AIStateMachineDebuggerNarrator';
import {
  windowTransitions,
  nextWiderPreset,
} from '../components/state-machine/windowTransitions';

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

/**
 * Human-readable duration. Rounds to whole minutes *before* splitting into
 * hours + minutes so a value that rounds up to a full 60 minutes rolls over
 * into the next hour (e.g. 7199s → "2h", never the "1h 60m" artefact the
 * previous per-branch `fmtInt(mRaw)` rounding produced). Non-finite or
 * negative inputs — which shouldn't occur but can slip in from a corrupt
 * timestamp gap — render as an em dash instead of "NaNh".
 */
function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const roundedSeconds = Math.round(seconds);
  if (roundedSeconds < 60) return `${roundedSeconds}s`;
  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
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

  /* ─── Vehicle selector — global sticky picker ─── */
  const { vehicleId: selectedVehicleId, vehicles } = useSelectedVehicle();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeId = selectedVehicleId != null ? String(selectedVehicleId) : '';

  /* ─── FSM filters ─── */
  const initialFsm = (searchParams.get('fsm') ?? 'all') as FSMType;
  const [fsmType, setFsmType] = useState<FSMType>(initialFsm);

  /* Time range — canonical RangePicker. Default 7d so the debugger surfaces
   * recent dev/replay activity by default; 24h was misleading whenever the
   * last transition was older than a day. The backend handler now accepts
   * RFC 3339 instants and treats the window as half-open `[start, end)` so
   * historical presets like `yesterday`/`lastMonth` and custom calendar
   * picks return the actual chosen window — not a rolling-from-now slice
   * — and crucially never silently drop today's local rows for users east
   * or west of UTC (the original "missing today's transitions" symptom on
   * the production deploy was a PST user's evening drives recorded at
   * next-day UTC falling outside the UTC-midnight filter). The
   * `FSMTimelineChart` still consumes `hours` for bucket sizing. */
  const vehicleTz = useTimezone('vehicle');
  const { start, end, startInstant, endInstantExclusive, setRange } = useRangeState({
    persistKey: 'fsm-debugger.range',
    defaultPresetId: '7d',
    timezone: vehicleTz,
  });
  const hours = useMemo(() => {
    if (!start || !end) return 0; // empty range == "all time" for the API
    const startMs = new Date(`${start}T00:00:00`).getTime();
    const endMs = new Date(`${end}T23:59:59.999`).getTime();
    return Math.max(1, Math.round((endMs - startMs) / 3_600_000));
  }, [start, end]);

  const [serverPage, setServerPage] = useState(1);
  const [perPage, setPerPage] = useState(50);

  useEffect(() => {
    setServerPage(1);
  }, [activeId, end, start]);

  /* ─── Detail panel ─── */
  const [selectedId, setSelectedId] = useState<number | null>(() => {
    const id = searchParams.get('selected');
    return id ? Number(id) : null;
  });

  /* ─── Live/freeze + timeline window ─── */
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
  } = useFSMTransitions(activeId, fsmType, hours, serverPage, perPage, startInstant, endInstantExclusive);

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
      list.push(new Date(tr.ts).getTime());
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
          <Text mono color="primary">{fmtInt(row.count)}</Text>
        ),
      },
      {
        key: 'avg_interval',
        header: t('fsm.avgInterval', 'Avg Interval'),
        className: 'text-right',
        render: (row: StatSummaryRow) => (
          <Text mono color="secondary">
            {row.avg_interval_sec > 0 ? formatDuration(row.avg_interval_sec) : '—'}
          </Text>
        ),
      },
    ],
    [t, fsmType],
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
          return <Text size="xs" color="muted" mono>{globalIdx}</Text>;
        },
      },
      {
        key: 'time',
        header: t('fsm.time', 'Time'),
        render: (row: FSMTransition) => (
          <TimeStamp
            value={row.ts}
            className="text-[var(--text-secondary)] font-mono text-xs whitespace-nowrap"
          />
        ),
      },
      {
        key: 'fsm_name',
        header: t('fsm.type', 'FSM'),
        render: (row: FSMTransition) => (
          <Text size="xs" color="secondary" mono className="capitalize">{row.fsm_name?.replace('_', ' ') ?? 'vehicle'}</Text>
        ),
      },
      {
        key: 'from_state',
        header: t('fsm.from', 'From'),
        render: (row: FSMTransition) => (
          <StateBadge state={row.from_state} fsmType={row.fsm_name || 'vehicle'} />
        ),
      },
      {
        key: 'to_state',
        header: t('fsm.to', 'To'),
        render: (row: FSMTransition) => (
          <StateBadge state={row.to_state} fsmType={row.fsm_name || 'vehicle'} />
        ),
      },
      {
        key: 'trigger',
        header: t('fsm.trigger', 'Trigger'),
        render: (row: FSMTransition) => (
          <Text size="xs" color="secondary" mono>{row.trigger}</Text>
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
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </Button>
        ),
      },
    ],
    [t, transitions, serverPage, perPage, selectedId],
  );

  /* Resolve the active range's human label for empty-state copy so users see
   * "No transitions in the selected window" rather than a generic message.
   * Uses the date span when defined; falls back to "All time" when empty. */
  const activeRangeLabel = useMemo(() => {
    if (!start || !end) return t('fsm.allTime', 'All time');
    if (start === end) return start;
    return `${start} → ${end}`;
  }, [start, end, t]);
  const emptyRangeMessage = t('fsm.noTransitionsInRange', {
    range: activeRangeLabel,
    defaultValue: 'No transitions in {{range}}. Try expanding the time range.',
  });

  const fsmTypeOptions = FSM_TYPE_OPTIONS.map((o) => ({
    value: o.value,
    label: t(o.i18nKey, o.label),
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
    transitions.map(tr => ({ ...tr, fsm_name: tr.to_state })),
    [transitions],
  );

  /* ─── Derived selection + step navigation ─── */
  const sortedByTime = useMemo(
    () => [...transitions].sort(
      (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
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
    return sortedByTime.filter((tr) => new Date(tr.ts) >= bufferClearedAt);
  }, [sortedByTime, bufferClearedAt]);

  /* Single source of truth for windowing. The page,
   * toolbar counter, timeline ticks, and inspector empty-state all derive
   * their view of "what's in/outside the active window" from this one call,
   * so the toolbar can never disagree with the timeline again. */
  const windowed = useMemo(
    () => windowTransitions(visibleTransitions, windowMinutes),
    [visibleTransitions, windowMinutes],
  );

  const widerPreset = useMemo(() => {
    if (windowed.inWindow.length > 0) return null;
    if (!windowed.lastTransition) return null;
    return nextWiderPreset(
      new Date(windowed.lastTransition.ts).getTime(),
      windowed.anchor,
      windowMinutes,
    );
  }, [windowed, windowMinutes]);

  const handleWidenWindow = useCallback(() => {
    if (widerPreset != null) setWindowMinutes(widerPreset);
  }, [widerPreset]);

  const handleJumpToLast = useCallback(() => {
    const last = windowed.lastTransition;
    if (!last) return;
    setIsLive(false);
    setSelectedId(last.id);
  }, [windowed.lastTransition]);

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
  const selectedAtIso = selectedTransition?.ts ?? '';
  const previousAtIso = previousTransition?.ts ?? '';
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

  /* ─── Permalink: keep ?vehicle_id / ?fsm / ?selected / ?at in sync ───
   * Vehicle id is owned by useSelectedVehicle (writes ?vehicle_id when
   * navigated). Time range is persisted by useRangeState in localStorage,
   * so it does not need a URL slot here. */
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (fsmType && fsmType !== 'all') next.set('fsm', fsmType);
    else next.delete('fsm');
    if (selectedId != null) next.set('selected', String(selectedId));
    else next.delete('selected');
    if (!isLive && selectedAtIso) next.set('at', selectedAtIso);
    else next.delete('at');
    // Drop the legacy ?vehicle / ?range params on first render so old
    // permalinks don't keep them stale.
    next.delete('vehicle');
    next.delete('range');
    setSearchParams(next, { replace: true });
  }, [fsmType, selectedId, isLive, selectedAtIso, searchParams, setSearchParams]);

  const permalinkUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}${window.location.pathname}?${searchParams.toString()}`;
  }, [searchParams]);

  const subFsmType = fsmType === 'all' ? 'vehicle' : fsmType;

  return (
    <PageContainer
      title={t('fsm.title', 'FSM Debugger')}
      subtitle={t('fsm.subtitle', 'Multi-FSM transition analysis — vehicle, drive, charge, command, notification')}
      loading={stateLoading && transLoading && statsLoading}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2" data-tour="debugger-share">
          <VehicleSelect
            ariaLabel={t('fsm.selectVehicle', 'Select vehicle')}
            className="w-44"
          />
          <RangePicker
            value={{ start, end }}
            onChange={(r) => {
              setRange(r);
              setServerPage(1);
            }}
            align="end"
            triggerTestId="fsm-debugger-range"
          />
          <Text as="span" size="xs" color="muted" className="hidden items-center gap-1 sm:flex">
            <RefreshCw className={cn('h-3 w-3', stateFetching && 'animate-spin')} aria-hidden="true" />
            {t('fsm.autoRefresh', 'Live 10s')}
          </Text>
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
      {/* ──── 1 — KPI band: full-width responsive metric grid ──── */}
      <FadeIn>
        <section
          aria-label={t('fsm.kpis', 'FSM summary metrics')}
          className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
        >
          <StatCard
            label={t('fsm.totalOnPage', 'Transitions (Page)')}
            value={`${fmtInt(totalTransitionsOnPage)} / ${fmtInt(totalRows)}`}
            icon={<Activity className="h-4 w-4" aria-hidden="true" />}
          />
          <StatCard
            label={t('fsm.totalTransitions', 'Total Transitions')}
            value={fmtInt(totalRows)}
            icon={<Activity className="h-4 w-4" aria-hidden="true" />}
          />
          <StatCard
            label={t('fsm.flapCount', 'Flap Warnings')}
            value={fmtInt(flapIds.size)}
            icon={<AlertTriangle className="h-4 w-4" aria-hidden="true" />}
          />
          <StatCard
            label={t('fsm.currentState', 'Current State')}
            value={stateName ?? '—'}
            icon={<Zap className="h-4 w-4" aria-hidden="true" />}
          />
        </section>
      </FadeIn>

      {/* ──── 2 — Page-specific filters (FSM Type + Per Page) ──── */}
      <FadeIn delay={0.03}>
        <GlassPanel className="p-4 sm:p-5">
          {vehicles.length > 0 ? (
            <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
              <div className="w-full sm:w-64">
                <Select
                  id="fsm-type-select"
                  label={t('fsm.fsmType', 'FSM Type')}
                  help={{
                    i18nKey: 'help.fsm.type',
                    content:
                      'Finite-state machine. Tracks vehicle high-level state (driving, charging, parked, online, asleep, offline) and the transitions between them. Sub-FSMs cover drive, charge, command, and notification lifecycles.',
                    ariaLabel: t('help.fsm.type.aria', { defaultValue: 'More info about FSM types' }),
                  }}
                  options={fsmTypeOptions}
                  value={fsmType}
                  onChange={(e) => {
                    setFsmType(e.target.value as FSMType);
                    setServerPage(1);
                  }}
                />
              </div>
              <div className="w-full sm:w-40">
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
            </div>
          ) : (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('fsm.noVehicles', 'No vehicles available')} />
          )}
        </GlassPanel>
      </FadeIn>

      {/* ──── 3 — FSM Health Indicators (full-width alert band) ──── */}
      <FadeIn delay={0.06}>
        <FSMHealthPanel transitions={transitions} />
      </FadeIn>

      {/* ──── 4 — AI FSM narrator ────
          withAiFeature returns null in off mode so this section is entirely
          absent from the DOM when the state-machine-debugger-narrator toggle
          is off or ai_mode='off'. The numeric vehicle id + Unix-seconds
          window are derived from the page's selectors; the narrator surface
          is wired end-to-end to the registered ai/system/fsm/narrate route. */}
      <FadeIn delay={0.09}>
        <AIStateMachineDebuggerNarrator
          vehicleId={Number(activeId) > 0 ? Number(activeId) : undefined}
          fromUnix={
            startInstant
              ? Math.floor(new Date(startInstant).getTime() / 1000)
              : undefined
          }
          toUnix={
            endInstantExclusive
              ? Math.floor(new Date(endInstantExclusive).getTime() / 1000)
              : undefined
          }
        />
      </FadeIn>

      {/* ──── 5 — State overview bento: live state hero + active sub-FSMs ──── */}
      <FadeIn delay={0.12}>
        <section
          aria-label={t('fsm.overview', 'Vehicle state overview')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-3"
        >
          <GlassPanel className="p-4 sm:p-6 xl:col-span-2">
            <PanelTitle className="mb-3 flex items-center gap-1">
              {t('fsm.vehicleLiveState', 'Vehicle Live State')}
              <HelpTooltip
                size="xs"
                i18nKey="help.fsm.liveState"
                defaultValue="The current state the FSM resolved to from the most recent telemetry. The FSM stays in a terminal state until external evidence (telemetry or poll) triggers an explicit transition out."
                ariaLabel={t('help.fsm.liveState.aria', { defaultValue: 'More info about FSM live state' })}
              />
            </PanelTitle>
            {stateLoading ? (
              <Skeleton height={80} />
            ) : currentState ? (
              <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-8">
                <div
                  className={cn(
                    'rounded-2xl px-6 py-4 text-2xl font-bold uppercase tracking-wider sm:px-8 sm:text-4xl',
                    style.bg,
                    style.text,
                  )}
                >
                  <span
                    className={cn(
                      'mr-3 inline-block h-3 w-3 animate-pulse rounded-full',
                      style.dot,
                    )}
                    aria-hidden="true"
                  />
                  {currentState.state ?? '—'}
                </div>
                <div className="space-y-1">
                  <Text as="p" size="sm" color="secondary">
                    <Text color="muted">{t('fsm.type', 'FSM Type')}:</Text>{' '}
                    <Text weight="medium" color="primary">{t('fsm.fsmTypeVehicle', 'Vehicle')}</Text>
                  </Text>
                  <Text as="p" size="sm" color="secondary">
                    <Text color="muted">{t('fsm.mode', 'Mode')}:</Text>{' '}
                    <Text weight="medium" color="primary">
                      {currentState.is_charging
                        ? t('fsm.modeCharging', 'Charging')
                        : currentState.speed && currentState.speed > 0
                          ? t('fsm.modeDrive', 'Drive')
                          : currentState.state === 'asleep'
                            ? t('fsm.modeSleep', 'Sleep')
                            : t('fsm.modeIdle', 'Idle')}
                    </Text>
                  </Text>
                  <Text as="p" size="sm" color="secondary">
                    <Text color="muted">{t('fsm.since', 'Since')}:</Text>{' '}
                    <TimeStamp
                      value={currentState.since}
                      format="absolute"
                      className="text-[var(--text-primary)] font-medium"
                    />
                  </Text>
                  <Text as="p" size="sm" color="muted">
                    <TimeStamp value={currentState.since} format="relative" />
                  </Text>
                </div>
              </div>
            ) : (
              <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('fsm.noState', 'No state data available')} />
            )}
          </GlassPanel>

          <FSMSubFSMPanel activeSubs={statsData?.active_subs} fsmType={subFsmType} />
        </section>
      </FadeIn>

      {/* ──── 6 — Live controls + state timeline + inspector ──── */}
      <FadeIn delay={0.15}>
        <GlassPanel className="space-y-4 p-4 sm:p-5" data-tour="debugger-timeline">
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
              windowCount={windowed.inWindow.length}
              totalCount={visibleTransitions.length}
            />
          </div>
          <StateTimeline
            transitions={windowed.inWindow}
            fsmType={subFsmType}
            selectedId={selectedId}
            onSelect={(tr) => {
              setSelectedId(tr.id);
              setIsLive(false);
            }}
            windowMinutes={windowMinutes}
            lastTransition={windowed.lastTransition}
            widerPreset={widerPreset}
            onWidenWindow={handleWidenWindow}
            onJumpToLast={handleJumpToLast}
          />
          <div data-tour="debugger-source-badges">
            <SnapshotInspector
              fsmType={selectedTransition?.fsm_name || subFsmType}
              transition={selectedTransition}
              snapshot={selectedSnapshot ?? null}
              previousSnapshot={previousSnapshot ?? null}
              loading={snapshotFetching}
              lastTransition={windowed.lastTransition}
              inWindowCount={windowed.inWindow.length}
              onJumpToLast={handleJumpToLast}
            />
          </div>
        </GlassPanel>
      </FadeIn>

      {/* ──── 7 — State Diagram (full-width graph) ──── */}
      <FadeIn delay={0.18}>
        <FSMStateDiagram fsmType={subFsmType} transitions={transitions} />
      </FadeIn>

      {/* ──── 8 — Analysis bento: distribution + counts ──── */}
      <FadeIn delay={0.21}>
        <section
          aria-label={t('fsm.analysis', 'Transition analysis')}
          className="grid grid-cols-1 gap-4 lg:grid-cols-2"
        >
          <ChartContainer
            title={t('fsm.distributionByState', 'State Distribution')}
            ariaLabel={t('fsm.distributionByState.aria', 'FSM state distribution donut chart with per-state counts')}
            data={pieData.map((p) => ({ name: p.name, value: p.value }))}
            dataColumns={[
              { key: 'name', label: t('fsm.col.state', 'State') },
              { key: 'value', label: t('fsm.col.count', 'Count') },
            ]}
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
                <div className="mt-2 flex flex-wrap justify-center gap-3">
                  {pieData.map((entry, i) => (
                    <div key={entry.name} className="flex items-center gap-1.5">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                        aria-hidden="true"
                      />
                      <Text size="xs" color="secondary">{entry.name}</Text>
                      <Text size="xs" color="muted">{fmtInt(entry.value)}</Text>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={emptyRangeMessage} />
            )}
          </ChartContainer>

          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-4">
              {t('fsm.transitionCounts', 'Transition Counts')}
            </PanelTitle>
            {transLoading ? (
              <Skeleton height={200} />
            ) : summaryRows.length > 0 ? (
              <DataTable<StatSummaryRow>
                tableId="system:fsm-summary"
                columns={summaryColumns}
                data={summaryRows}
                keyExtractor={(row) => row.to_state}
              />
            ) : (
              <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={emptyRangeMessage} />
            )}
          </GlassPanel>
        </section>
      </FadeIn>

      {/* ──── 9 — Transition Timeline Chart (full-width) ──── */}
      <FadeIn delay={0.24}>
        <FSMTimelineChart transitions={timelineTransitions} hours={Number(hours)} emptyMessage={emptyRangeMessage} />
      </FadeIn>

      {/* ──── 10 — Transition Log (full-width detail band) ──── */}
      <FadeIn delay={0.27}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-4 flex flex-wrap items-center gap-2">
            {t('fsm.timelineTitle', 'Transition Log')}
            {totalRows > 0 && (
              <Text size="sm" weight="regular" color="muted">
                {fmtInt(totalRows)} {t('fsm.total', 'total')}
              </Text>
            )}
          </PanelTitle>
          {transLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} height={48} />
              ))}
            </div>
          ) : transitions.length > 0 ? (
            <>
              <DataTable<FSMTransition>
                tableId="system:fsm-transitions"
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
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={emptyRangeMessage} />
          )}
        </GlassPanel>
      </FadeIn>

      {/* ──── 11 — Selected Transition Detail (full-width, conditional) ──── */}
      {selectedId != null && (() => {
        const selected = transitions.find((tr) => tr.id === selectedId);
        return selected ? (
          <FadeIn key={selectedId}>
            <GlassPanel className="p-4 sm:p-5">
              <PanelTitle className="mb-4">
                {t('fsm.detailTitle', 'Transition Detail')}
              </PanelTitle>
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
    <div className="grid grid-cols-1 gap-4 text-xs sm:grid-cols-2 lg:grid-cols-4">
      <div>
        <Caption className="mb-1 block">{t('fsm.detail.id', 'Transition ID')}</Caption>
        <Text mono color="primary" className="break-all">{transition.id}</Text>
      </div>
      <div>
        <Caption className="mb-1 block">{t('fsm.detail.vehicleId', 'Vehicle ID')}</Caption>
        <Text mono color="primary">{transition.vehicle_id}</Text>
      </div>
      {transition.fsm_name && (
        <div>
          <Caption className="mb-1 block">{t('fsm.detail.name', 'FSM Name')}</Caption>
          <Text mono color="primary">{transition.fsm_name}</Text>
        </div>
      )}
      <div>
        <Caption className="mb-1 block">{t('fsm.detail.from', 'From State')}</Caption>
        <StateBadge state={transition.from_state} fsmType={transition.fsm_name || 'vehicle'} />
      </div>
      <div>
        <Caption className="mb-1 block">{t('fsm.detail.to', 'To State')}</Caption>
        <StateBadge state={transition.to_state} fsmType={transition.fsm_name || 'vehicle'} />
      </div>
      <div>
        <Caption className="mb-1 block">{t('fsm.detail.trigger', 'Trigger')}</Caption>
        <Text mono color="primary">{transition.trigger}</Text>
      </div>
      {typeof transition.details?.guard === 'string' && transition.details.guard && (
        <div>
          <Caption className="mb-1 block">{t('fsm.detail.guard', 'Guard')}</Caption>
          <Text mono color="primary">{String(transition.details.guard)}</Text>
        </div>
      )}
      {typeof transition.details?.duration_in_state_ms === 'number' && transition.details.duration_in_state_ms > 0 && (
        <div>
          <Caption className="mb-1 block">{t('fsm.detail.duration', 'Duration in State')}</Caption>
          <Text mono color="primary">{formatDuration((transition.details.duration_in_state_ms as number) / 1000)}</Text>
        </div>
      )}
      <div className="sm:col-span-2 lg:col-span-4">
        <Caption className="mb-1 block">{t('fsm.detail.timestamp', 'Timestamp')}</Caption>
        <TimeStamp
          value={transition.ts}
          format="absolute"
          className="text-[var(--text-primary)] font-mono"
        />
        <span className="ml-2">
          <TimeStamp
            value={transition.ts}
            format="relative"
            className="text-[var(--text-muted)]"
          />
        </span>
      </div>
      {transition.details && Object.keys(transition.details).length > 0 && (
        <div className="sm:col-span-2 lg:col-span-4">
          <Caption className="mb-1 block">{t('fsm.detail.context', 'Details')}</Caption>
          <div className="mt-1 flex flex-wrap gap-2">
            {Object.entries(transition.details).map(([key, val]) => (
              <Text as="span" size="2xs" color="secondary" mono key={key} className="rounded bg-white/[0.04] px-2 py-0.5">
                {key}: {String(val)}
              </Text>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
