import { useState, useMemo, useEffect, useCallback, useId } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
import { PageLayout, Grid, ChartCard, LayoutCard } from '@/components/layout';
import { GlassPanel, Button, DataTable, HelpTooltip, Select, Pagination, CopyButton, PanelTitle, Caption, Text } from '@/components/ui';

import type { Column, MobileDataTablePresentation } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { Skeleton, EmptyState, QueryError, StaleRefreshWarning, AlertBanner } from '@/components/feedback';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  ChartTooltip, CHART_COLORS,
} from '@/components/charts';
import { useVehicleStateMachine } from '@/api/hooks/useAdmin';
import { getVehicleStateEvidence, type RawStateResponse } from '@/api/hooks/useVehicles';
import { useFSMStats, useFSMTransitions } from '@/api/hooks/useFSM';
import { useSignalSnapshot } from '@/api/hooks/useTelemetry';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDataState } from '@/hooks/useDataState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useRangeState } from '@/hooks/useRangeState';

import { cn } from '@/lib/cn';
import { toIsoString } from '@/lib/dateConvert';
import type { FSMTransition, FSMType } from '@/types/fsm';
import { FSM_TYPE_OPTIONS } from '@/types/fsm';
import { StateBadge } from '../components/StateBadge';
import { TimeStamp } from '@/components/data-display';
import { FSMStateDiagram } from '../components/FSMStateDiagram';
import { FSMHealthPanel } from '../components/FSMHealthPanel';
import { FSMTimelineChart } from '../components/FSMTimelineChart';
import { FSMSubFSMPanel } from '../components/FSMSubFSMPanel';
import { StateTimeline } from '../components/state-machine/StateTimeline';
import { LiveControls } from '../components/state-machine/LiveControls';
import { SnapshotInspector } from '../components/state-machine/SnapshotInspector';
import { AIStateMachineDebuggerNarrator } from '@/components/ai';
import {
  windowTransitions,
  nextWiderPreset,
} from '../components/state-machine/windowTransitions';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { FSMOperationalBrief } from '../components/statstrip-fsm/FSMOperationalBrief';
import type { StatPeriod } from '@/lib/metric-reference';

interface StateResponse extends RawStateResponse {
  data_source?: string;
}

function isStateResponse(value: unknown): value is StateResponse {
  return value != null && typeof value === 'object'
    && 'state' in value
    && (value.state == null || (typeof value.state === 'object' && 'state' in value.state
      && typeof value.state.state === 'string'));
}

/* ─── Stat summary row for the distribution table ─── */
interface StatSummaryRow {
  to_state: string;
  count: number;
  avg_interval_sec: number | null;
}

/* ─── Page Component ─── */
export default function StateMachineDebuggerPage() {
  const { fmtInt, formatDurationMsCompact } = useNumberFormatting();
  const { t } = useTranslation();
  usePageTitle(t('fsm.title', 'FSM debugger'));

  /* ─── Vehicle selector — global sticky picker ─── */
  const { vehicleId: selectedVehicleId, vehicles } = useSelectedVehicle();
  const [searchParams, setSearchParams] = useSearchParams();
  const { pathname } = useLocation();
  const activeId = selectedVehicleId != null ? String(selectedVehicleId) : '';

  /* ─── FSM filters ─── */
  const initialFsm = FSM_TYPE_OPTIONS.find((option) => option.value === searchParams.get('fsm'))?.value ?? 'all';
  const [fsmType, setFsmType] = useState<FSMType>(initialFsm);

  /* Time range — header View settings. Default 7d so the debugger surfaces
   * recent dev/replay activity by default; 24h was misleading whenever the
   * last transition was older than a day. The backend handler now accepts
   * RFC 3339 instants and treats the window as half-open `[start, end)` so
   * historical presets like `yesterday`/`lastMonth` and custom calendar
   * picks return the actual chosen window — not a rolling-from-now slice
   * — and crucially never silently drop today's local rows for users east
   * or west of UTC (the original "missing today's transitions" symptom on
   * the production deploy was a PST user's evening drives recorded at
   * next-day UTC falling outside the UTC-midnight filter). The
   * The API and timeline chart share these exact half-open bounds. */
  const { tz: vehicleTz, formatDateTime } = useDateFormat();
  const { start, end, startInstant, endInstantExclusive, presetId } = useRangeState({
    persistKey: 'fsm-debugger.range',
    defaultPresetId: '7d',
    timezone: vehicleTz,
  });
  const hours = useMemo(() => {
    if (!startInstant || !endInstantExclusive) return 0;
    return (Date.parse(endInstantExclusive) - Date.parse(startInstant)) / 3_600_000;
  }, [startInstant, endInstantExclusive]);

  const [serverPage, setServerPage] = useState(1);
  const [perPage, setPerPage] = useState(50);

  useEffect(() => {
    setServerPage(1);
  }, [activeId, endInstantExclusive, startInstant]);

  /* ─── Detail panel ─── */
  const [initialSelectedId] = useState<number | null>(() => {
    const id = searchParams.get('selected');
    return id && /^\d+$/.test(id) && Number.isSafeInteger(Number(id)) && Number(id) > 0
      ? Number(id) : null;
  });
  const [selectedId, setSelectedId] = useState<number | null>(initialSelectedId);
  const detailId = useId();
  const detailTitleId = `${detailId}-title`;

  /* ─── Live/freeze + timeline window ─── */
  const [initialAt, setInitialAt] = useState(() => {
    const at = searchParams.get('at');
    return at && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(at)
      && Number.isFinite(Date.parse(at)) ? at : '';
  });
  const [isLive, setIsLive] = useState<boolean>(!initialAt);
  const [windowMinutes, setWindowMinutes] = useState(10);
  const [bufferClearedAt, setBufferClearedAt] = useState<Date | null>(null);

  /* ─── Data hooks ─── */
  const stateQuery = useVehicleStateMachine(activeId);
  // The admin hook is typed as the inner state, but this endpoint returns an envelope.
  const stateResponse = isStateResponse(stateQuery.data) ? stateQuery.data : undefined;
  const stateEvidence = getVehicleStateEvidence(stateResponse);
  const confirmedLiveState = stateResponse?.live === true
    && stateResponse.state != null
    && stateResponse.data_source === 'live_signal_store'
    && stateEvidence.freshness === 'fresh'
    && stateEvidence.verifiedFields.includes('state');
  const stateProvenance = confirmedLiveState ? 'live'
    : stateResponse?.data_source === 'as_of' ? 'historical'
      : stateResponse?.data_source === 'db_fallback' || stateEvidence.freshness === 'stale'
        ? 'cached' : 'unknown';
  const stateTrust = useDataState(stateQuery, { provenance: stateProvenance });
  const {
    isLoading: stateLoading,
    isFetching: stateFetching,
    refetch: refetchState,
  } = stateQuery;
  const stateError = stateTrust.fatalError;

  const statsQuery = useFSMStats(activeId);
  const statsTrust = useDataState(statsQuery, { provenance: 'historical' });
  const {
    data: statsData,
    isLoading: statsLoading,
    refetch: refetchStats,
  } = statsQuery;
  const statsError = statsTrust.fatalError;

  const transQuery = useFSMTransitions(activeId, fsmType, hours, serverPage, perPage, startInstant, endInstantExclusive);
  const transTrust = useDataState(transQuery, { provenance: 'historical' });
  const {
    data: transData,
    refetch: refetchTrans,
  } = transQuery;
  const transError = transTrust.fatalError;
  const transInitial = transTrust.status === 'initial';
  const transLoading = transInitial && !transTrust.isRefreshBlocked;
  const transitionPlaceholder = (label: string, height: number, rows = 1) => (
    <div
      role="status"
      aria-label={label}
      aria-busy={transLoading}
      data-transition-pending
      className={cn('space-y-2', transTrust.isRefreshBlocked && '[&_.animate-pulse]:animate-none')}
    >
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} height={height} className="animate-pulse motion-reduce:animate-none" />)}
    </div>
  );

  const retryKpiQueries = useCallback(() => {
    refetchTrans();
    refetchState();
  }, [refetchTrans, refetchState]);

  /* ─── Derived data ─── */
  const currentState = stateResponse?.state;
  const stateName = currentState?.state?.toLowerCase() ?? null;
  const hasModeEvidence = (field: 'is_charging' | 'speed' | 'state') =>
    stateEvidence.verifiedFields.includes(field);
  const mode = hasModeEvidence('is_charging') && currentState?.is_charging === true ? t('fsm.modeCharging', 'Charging')
    : hasModeEvidence('speed') && typeof currentState?.speed === 'number' && Number.isFinite(currentState.speed) && currentState.speed > 0
      ? t('fsm.modeDrive', 'Drive')
      : hasModeEvidence('state') && stateName === 'asleep' ? t('fsm.modeSleep', 'Sleep')
        : hasModeEvidence('is_charging') && hasModeEvidence('speed') && hasModeEvidence('state')
          && currentState?.is_charging === false && currentState.speed === 0
          && (stateName === 'parked' || stateName === 'online')
          ? t('fsm.modeIdle', 'Idle') : t('common.unknown', 'Unknown');
  const stateTitle = confirmedLiveState && stateTrust.status === 'ok'
    ? t('fsm.vehicleLiveState', 'Vehicle live state') : t('fsm.currentState', 'Current state');

  const transitions: FSMTransition[] = transData?.data ?? [];
  const totalRows = transData?.total ?? 0;


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
      const timestamp = Date.parse(tr.ts);
      if (Number.isFinite(timestamp)) list.push(timestamp);
      byState.set(key, list);
    }

    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => {
        const times = byState.get(name) ?? [];
        let avgInterval: number | null = null;
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
        align: 'right',
        header: t('fsm.count', 'Transitions'),
        className: 'text-right',
        render: (row: StatSummaryRow) => (
          <Text mono color="primary">{fmtInt(row.count)}</Text>
        ),
      },
      {
        key: 'avg_interval',
        align: 'right',
        header: t('fsm.avgInterval', 'Avg interval'),
        className: 'text-right',
        render: (row: StatSummaryRow) => (
          <Text mono color="secondary">
            {formatDurationMsCompact(row.avg_interval_sec == null ? null : row.avg_interval_sec * 1000)}
          </Text>
        ),
      },
    ],
    [t, fsmType, fmtInt, formatDurationMsCompact],
  );

  /* ─── DataTable columns — transition timeline with color-coded state badges ─── */
  const timelineColumns: Column<FSMTransition>[] = useMemo(
    () => [
      {
        key: 'index',
        align: 'right',
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
        header: t('fsm.type', "FSM type"),
        render: (row: FSMTransition) => (
          <Text size="xs" color="secondary" mono className="">{row.fsm_name?.replace('_', ' ') ?? 'vehicle'}</Text>
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
            className="min-h-11 min-w-11 md:min-h-0 md:min-w-0"
            aria-label={t('fsm.viewDetail', 'View detail')}
            aria-expanded={selectedId === row.id}
            aria-controls={detailId}
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
    [t, transitions, serverPage, perPage, selectedId, detailId],
  );

  const timelineMobilePresentation: MobileDataTablePresentation<FSMTransition> = {
    roles: {
      time: 'title',
      to_state: 'primary',
      from_state: 'meta',
      fsm_name: 'meta',
      trigger: 'meta',
    },
    displayValue: (row, key) => {
      switch (key) {
        case 'time': return formatDateTime(row.ts);
        case 'fsm_name': return row.fsm_name?.replace('_', ' ') ?? 'vehicle';
        case 'from_state': return row.from_state;
        case 'to_state': return row.to_state;
        case 'trigger': return row.trigger;
        default: return null;
      }
    },
    inlineActions: (row) => timelineColumns.find(column => column.key === 'detail')?.render(row),
    allDetails: (row) => [
      { key: 'transition_id', label: t('fsm.detail.id', 'Transition ID'), value: row.id },
      { key: 'vehicle_id', label: t('fsm.detail.vehicleId', 'Vehicle ID'), value: row.vehicle_id },
      {
        key: 'context',
        label: t('fsm.detail.context', "Context snapshot"),
        value: row.details && Object.keys(row.details).length > 0
          ? <Text as="pre" mono className="whitespace-pre-wrap break-words">{JSON.stringify(row.details, null, 2)}</Text>
          : '—',
      },
    ],
  };

  /* Resolve the active range's human label for empty-state copy so users see
   * "No transitions in the selected window" rather than a generic message.
   * Uses the date span when defined; falls back to "All time" when empty. */
  const { formatDateRange, formatDayKeyRange } = useDateFormat();
  const activeRangeLabel = useMemo(() => {
    if (!start || !end) return t('fsm.allTime', 'All time');
    return formatDayKeyRange(start, end);
  }, [start, end, t, formatDayKeyRange]);
  const emptyRangeMessage = totalRows > 0
    ? t('fsm.noTransitionsOnPage', 'No transitions on the loaded server page.')
    : t('fsm.noTransitionsInRange', {
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

  const unconfirmedStateScope = t('fsm.brief.description', 'Inspect page-scoped transitions and flap evidence alongside the matching server total and independently fetched current state.');
  const summaryPeriod: StatPeriod = startInstant && endInstantExclusive ? {
    kind: 'analysis', label: activeRangeLabel, start: startInstant, endExclusive: endInstantExclusive,
    timezone: vehicleTz, completeness: 'subset',
    provenance: confirmedLiveState && stateTrust.status === 'ok'
      ? t('fsm.statstrip.provenance', 'Page and flap counts cover the loaded server page; total covers matching transitions in the selected window. Current state comes from a separate live-state snapshot.')
      : unconfirmedStateScope,
  } : !start && !end ? {
    kind: 'alltime', label: activeRangeLabel,
    provenance: confirmedLiveState && stateTrust.status === 'ok'
      ? t('fsm.statstrip.alltimeProvenance', 'All matching transition history; page and flap counts cover only loaded rows. Current state is a separate live snapshot.')
      : unconfirmedStateScope,
  } : {
    kind: 'unknown', label: activeRangeLabel,
    reason: confirmedLiveState && stateTrust.status === 'ok'
      ? t('fsm.statstrip.unknownPeriod', 'Transition bounds were not supplied. Page and flap counts remain page-scoped; current state is a separate live snapshot.')
      : unconfirmedStateScope,
  };
  const rangeScope = startInstant && endInstantExclusive
    ? formatDateRange(startInstant, endInstantExclusive)
    : summaryPeriod.kind === 'unknown' ? summaryPeriod.reason : activeRangeLabel;
  const pageScope = t('fsm.statstrip.pageOnly', 'Loaded transition page only');

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
    setInitialAt('');
  }, []);

  /* ─── Snapshot hooks: live (when no `at`) + selected/previous (when frozen) ─── */
  const selectedAtIso = selectedTransition?.ts ?? '';
  const previousAtIso = previousTransition?.ts ?? '';
  const numericVehicleId = Number(activeId) || 0;

  const selectedSnapshotQuery = useSignalSnapshot(
    numericVehicleId,
    selectedAtIso,
    '',
    { enabled: numericVehicleId > 0 && Boolean(selectedAtIso) },
  );

  const previousSnapshotQuery = useSignalSnapshot(
    numericVehicleId,
    previousAtIso,
    '',
    { enabled: numericVehicleId > 0 && Boolean(previousAtIso) },
  );
  const selectedSnapshotTrust = useDataState(selectedSnapshotQuery, { provenance: 'historical' });
  const previousSnapshotTrust = useDataState(previousSnapshotQuery, { provenance: 'historical' });

  /* A linked transition can be absent during loading or on another server
   * page. Keep its timestamp without inventing a row or fetching outside
   * the typed queries; a resolved row supplies the authoritative timestamp. */
  const evidenceAt = selectedAtIso || (selectedId === initialSelectedId ? initialAt : '');
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (fsmType && fsmType !== 'all') next.set('fsm', fsmType);
    else next.delete('fsm');
    if (selectedId != null) next.set('selected', String(selectedId));
    else next.delete('selected');
    if (!isLive && evidenceAt) next.set('at', evidenceAt);
    else next.delete('at');
    // Drop the legacy ?vehicle / ?range params on first render so old
    // permalinks don't keep them stale.
    next.delete('vehicle');
    next.delete('range');
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
  }, [fsmType, selectedId, isLive, evidenceAt, searchParams, setSearchParams]);

  const rollingScope = presetId === 'live' || presetId === '24h';
  const permalinkUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const next = new URLSearchParams(searchParams);
    if (activeId) next.set('vehicle_id', activeId);
    if (start && end) {
      next.set('from', start);
      next.set('to', end);
      next.set('time_scope', rollingScope ? presetId ?? 'custom' : 'custom');
    } else if (!start && !end) {
      next.delete('from');
      next.delete('to');
      next.set('time_scope', 'all');
    }
    return `${window.location.origin}${pathname}?${next.toString()}`;
  }, [searchParams, pathname, activeId, start, end, rollingScope, presetId]);

  const subFsmType = fsmType === 'all' ? 'vehicle' : fsmType;

  return (
    <PageLayout
      title={t('fsm.title', 'FSM debugger')}
      subtitle={t('fsm.subtitle', 'Multi-FSM transition analysis — vehicle, drive, charge, command, notification')}
      loading={stateLoading && transLoading && statsLoading}
      secondaryActions={
        <div className="flex flex-wrap items-center justify-end gap-2" data-tour="debugger-share">
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
          {rollingScope && (
            <Caption as="p">
              {t('fsm.shareRollingLimit', 'The link reopens the rolling preset, not these exact time bounds.')}
            </Caption>
          )}
        </div>
      }
    >
      <StaleRefreshWarning state={stateTrust} label={stateTitle} />
      <StaleRefreshWarning state={statsTrust} label={t('fsm.subFsms', 'Active sub-FSMs')} />
      <StaleRefreshWarning state={transTrust} label={t('fsm.timelineTitle', 'Transition log')} />
      {transInitial && transTrust.isRefreshBlocked && (
        <AlertBanner variant="info" role="status" title={t('dataSources.status.paused', 'Refresh paused')}>
          <Text as="p" variant="bodySm">
            {t('dataSources.unavailableMessage', 'No requested source has returned usable data yet.')}
          </Text>
          <Button variant="ghost" size="sm" onClick={() => refetchTrans()}>
            {t('common.refresh', 'Refresh')}
          </Button>
        </AlertBanner>
      )}
      {/* ──── 1 — KPI band: full-width responsive metric grid ──── */}
      <FadeIn>
        <FSMOperationalBrief transitions={transQuery} stateQuery={stateQuery} currentState={stateName}
          period={summaryPeriod} onRetry={retryKpiQueries} />
      </FadeIn>

      {/* ──── 2 — Page-specific filters (FSM Type + Per Page) ──── */}
      <FadeIn delay={0.03}>
        <GlassPanel className="p-4 sm:p-5">
          {vehicles.length > 0 ? (
            <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
              <div className="w-full sm:w-64">
                <Select
                  id="fsm-type-select"
                  label={t('fsm.fsmType', 'FSM type')}
                  help={{
                    i18nKey: 'help.fsm.type',
                    content:
                      'Finite-state machine. Tracks vehicle high-level state (driving, charging, parked, online, asleep, offline) and the transitions between them. Sub-FSMs cover drive, charge, command, and notification lifecycles.',
                    ariaLabel: t('help.fsm.typeAria', { defaultValue: 'More info about FSM types' }),
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
                  label={t('fsm.perPage', "Per page")}
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
        <Caption as="p">{pageScope}</Caption>
        {transInitial ? (
          <GlassPanel className="p-4">
            {transitionPlaceholder(t('fsm.health.title', 'FSM health'), 24)}
          </GlassPanel>
        ) : transError ? (
          <QueryError error={transError} onRetry={() => refetchTrans()} />
        ) : (
          <FSMHealthPanel transitions={transitions} sourceState={transTrust} hideStaleWarning />
        )}
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
            {/* The help tooltip sits beside the heading (not inside it) so its
                content does not bleed into the heading's accessible name. */}
            <div className="mb-3 flex items-center gap-1">
              <PanelTitle>{stateTitle}</PanelTitle>
              <HelpTooltip
                size="xs"
                i18nKey="help.fsm.liveState"
                defaultValue="The current state the FSM resolved to from the most recent telemetry. The FSM stays in a terminal state until external evidence (telemetry or poll) triggers an explicit transition out."
                ariaLabel={t('help.fsm.liveStateAria', { defaultValue: 'More info about FSM live state' })}
              />
            </div>
            {stateLoading ? (
              <Skeleton height={80} />
            ) : stateError ? (
              <QueryError error={stateError} onRetry={() => refetchState()} />
            ) : currentState ? (
              <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-8">
                {/* Reuse the canonical FSM presentation; a current state is not a pulsing activity indicator. */}
                <StateBadge state={currentState.state} fsmType="vehicle" />
                <div className="space-y-1">
                  <Text as="p" size="sm" color="secondary">
                    <Text color="muted">{t('fsm.type', 'FSM type')}:</Text>{' '}
                    <Text weight="medium" color="primary">{t('fsm.fsmTypeVehicle', 'Vehicle')}</Text>
                  </Text>
                  <Text as="p" size="sm" color="secondary">
                    <Text color="muted">{t('fsm.mode', 'Mode')}:</Text>{' '}
                    <Text weight="medium" color="primary">
                      {mode}
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

          {subFsmType === 'vehicle' && statsLoading ? (
            <GlassPanel className="p-4">
              <Skeleton height={80} />
            </GlassPanel>
          ) : statsError && subFsmType === 'vehicle' ? (
            <GlassPanel className="p-4">
              <QueryError error={statsError} onRetry={() => refetchStats()} compact />
            </GlassPanel>
          ) : (
            <FSMSubFSMPanel activeSubs={statsData?.active_subs} fsmType={subFsmType} />
          )}
        </section>
      </FadeIn>

      {/* ──── 6 — Live controls + state timeline + inspector ──── */}
      <FadeIn delay={0.15}>
        <GlassPanel className="space-y-4 p-4 sm:p-5" data-tour="debugger-timeline">
          {transInitial ? (
            transitionPlaceholder(t('fsm.timelineTitle', 'Transition log'), 48, 3)
          ) : transError ? (
            <QueryError error={transError} onRetry={() => refetchTrans()} />
          ) : (
            <>
          <div data-tour="debugger-controls">
            <LiveControls
              isLive={isLive}
              onToggleLive={(live) => {
                setIsLive(live);
                if (live) {
                  setSelectedId(null);
                  setInitialAt('');
                }
              }}
              onStepPrev={handleStepPrev}
              onStepNext={handleStepNext}
              canStepPrev={!isLive && sortedByTime.length > 0 && selectedIndex > 0}
              canStepNext={!isLive && sortedByTime.length > 0 && selectedIndex < sortedByTime.length - 1}
              windowMinutes={windowMinutes}
              onWindowChange={setWindowMinutes}
              onClearBuffer={handleClearBuffer}
              windowCount={transData ? windowed.inWindow.length : undefined}
              filteredBufferCount={transData ? visibleTransitions.length : undefined}
              loadedCount={transData ? transitions.length : undefined}
              totalCount={transData?.total}
              rangeScope={rangeScope}
              page={serverPage}
              bufferSince={toIsoString(bufferClearedAt)}
              windowEnd={toIsoString(windowed.anchor)}
            />
          </div>
          <StateTimeline
            transitions={windowed.inWindow}
            fsmType={subFsmType}
            selectedId={selectedId}
            detailId={detailId}
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
              snapshot={selectedSnapshotQuery.data ?? null}
              previousSnapshot={previousSnapshotQuery.data ?? null}
              loading={selectedSnapshotQuery.isFetching}
              selectedTrust={selectedSnapshotTrust}
              previousTrust={previousSnapshotTrust}
              previousLoading={previousSnapshotQuery.isFetching}
              hasPreviousTransition={previousTransition != null}
              lastTransition={windowed.lastTransition}
              inWindowCount={windowed.inWindow.length}
              onJumpToLast={handleJumpToLast}
            />
          </div>
            </>
          )}
        </GlassPanel>
      </FadeIn>

      {/* ──── 7 — State Diagram (full-width graph) ──── */}
      <FadeIn delay={0.18}>
        <Caption as="p">{pageScope}</Caption>
        {transInitial ? (
          <GlassPanel className="p-5">
            <PanelTitle className="mb-4">{t('fsm.stateDiagram', 'State diagram')}</PanelTitle>
            {transitionPlaceholder(t('fsm.stateDiagram', 'State diagram'), 120)}
          </GlassPanel>
        ) : transError ? (
          <QueryError error={transError} onRetry={() => refetchTrans()} />
        ) : (
          <FSMStateDiagram fsmType={subFsmType} transitions={transitions} />
        )}
      </FadeIn>

      {/* ──── 8 — Analysis bento: distribution + counts ──── */}
      <FadeIn delay={0.21}>
        <section
          aria-label={t('fsm.analysis', 'Transition analysis')}
          className="grid gap-4"
        >
          <Caption as="p">{pageScope}</Caption>
          <Grid cols={{ default: 1, lg: 2 }} gap={4}>
          <ChartCard
            title={t('fsm.distributionByState', 'State distribution')}
            ariaLabel={t('fsm.distributionByStateAria', 'FSM state distribution donut chart with per-state counts')}
            data={transTrust.hasData ? pieData.map((p) => ({ name: p.name, value: p.value })) : undefined}
            exportable={!transInitial && !transError}
            dataColumns={[
              { key: 'name', label: t('fsm.col.state', 'State') },
              { key: 'value', label: t('fsm.col.count', 'Count') },
            ]}
            error={transError}
            onRetry={() => refetchTrans()}
            height={280}
            size="standard"
          >
            {transInitial ? (
              transitionPlaceholder(t('fsm.distributionByState', 'State distribution'), 240)
            ) : pieData.length > 0 ? (
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
          </ChartCard>

          <LayoutCard title={t('fsm.transitionCounts', 'Transition counts')}>
            {transInitial ? (
              transitionPlaceholder(t('fsm.transitionCounts', 'Transition counts'), 48, 4)
            ) : transError ? (
              <QueryError error={transError} onRetry={() => refetchTrans()} />
            ) : summaryRows.length > 0 ? (
              <DataTable<StatSummaryRow>
                cardLayout
                variant="embedded"
                tableId="system:fsm-summary"
                enableValueFilters={false}
                columns={summaryColumns}
                mobileColumns={['to_state', 'count', 'avg_interval']}
                data={summaryRows}
                keyExtractor={(row) => row.to_state}
              />
            ) : (
              <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={emptyRangeMessage} />
            )}
          </LayoutCard>
          </Grid>
        </section>
      </FadeIn>

      {/* ──── 9 — Transition Timeline Chart (full-width) ──── */}
      <FadeIn delay={0.24}>
        <Caption as="p">{pageScope}</Caption>
        {transInitial ? (
          <GlassPanel className="p-5">
            <PanelTitle className="mb-4">{t('fsm.timelineChart', 'Transitions over time')}</PanelTitle>
            {transitionPlaceholder(t('fsm.timelineChart', 'Transitions over time'), 240)}
          </GlassPanel>
        ) : transError ? (
          <QueryError error={transError} onRetry={() => refetchTrans()} />
        ) : (
          <FSMTimelineChart
            transitions={timelineTransitions}
            hours={hours}
            startInstant={startInstant}
            endInstantExclusive={endInstantExclusive}
            emptyMessage={emptyRangeMessage}
          />
        )}
      </FadeIn>

      {/* ──── 10 — Transition Log (full-width detail band) ──── */}
      <FadeIn delay={0.27}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-4 flex flex-wrap items-center gap-2">
            {t('fsm.timelineTitle', 'Transition log')}
            {totalRows > 0 && (
              <Text size="sm" weight="regular" color="muted">
                {fmtInt(totalRows)} {t('fsm.total', 'total')}
              </Text>
            )}
          </PanelTitle>
          <Caption as="p" className="mb-4">{rangeScope} · {pageScope}</Caption>
          {transInitial ? (
            transitionPlaceholder(t('fsm.timelineTitle', 'Transition log'), 48, 5)
          ) : transError ? (
            <QueryError error={transError} onRetry={() => refetchTrans()} />
          ) : transitions.length > 0 ? (
            <>
              <DataTable<FSMTransition>
                tableId="system:fsm-transitions"
                caption={t('fsm.timelineTitle', 'Transition log')}
                enableValueFilters={false}
                columns={timelineColumns}
                mobilePresentation={timelineMobilePresentation}
                mobileColumns={['index', 'time', 'fsm_name', 'from_state', 'to_state', 'trigger', 'detail']}
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

      {/* ──── 11 — Selected Transition Detail (full-width) ──── */}
      <FadeIn>
        <GlassPanel id={detailId} role="region" aria-labelledby={detailTitleId} className="p-4 sm:p-5">
          <PanelTitle id={detailTitleId} className="mb-4">
            {t('fsm.detailTitle', 'Transition detail')}
          </PanelTitle>
          {transInitial ? (
            transitionPlaceholder(t('fsm.detailTitle', 'Transition detail'), 48, 2)
          ) : transError ? (
            <QueryError error={transError} onRetry={() => refetchTrans()} />
          ) : selectedTransition ? (
            <TransitionDetail transition={selectedTransition} />
          ) : (
            <EmptyState /* no-action: select a transition using the existing log or timeline controls */ message={t('debugger.inspector.empty', 'Select a transition to inspect its snapshot')} />
          )}
        </GlassPanel>
      </FadeIn>
    </PageLayout>
  );
}

/* ─── Transition Detail Panel ─── */
function TransitionDetail({ transition }: { transition: FSMTransition }) {
  const { t } = useTranslation();
  const { formatDurationMsCompact } = useNumberFormatting();
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
          <Caption className="mb-1 block">{t('fsm.detail.name', 'FSM name')}</Caption>
          <Text mono color="primary">{transition.fsm_name}</Text>
        </div>
      )}
      <div>
        <Caption className="mb-1 block">{t('fsm.detail.from', 'From state')}</Caption>
        <StateBadge state={transition.from_state} fsmType={transition.fsm_name || 'vehicle'} />
      </div>
      <div>
        <Caption className="mb-1 block">{t('fsm.detail.to', 'To state')}</Caption>
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
        <div>
          <Caption className="mb-1 block">{t('fsm.detail.duration', 'Duration in state')}</Caption>
          <Text mono color="primary">{formatDurationMsCompact(typeof transition.details?.duration_in_state_ms === 'number'
            ? transition.details.duration_in_state_ms : null)}</Text>
        </div>
      <div className="sm:col-span-2 lg:col-span-4">
        <Caption className="mb-1 block">{t('fsm.detail.timestamp', 'Timestamp')}</Caption>
        <TimeStamp
          value={transition.ts}
          format="absolute"
          className="text-[var(--text-primary)] font-mono"
        />
        <span className="ms-2">
          <TimeStamp
            value={transition.ts}
            format="relative"
            className="text-[var(--text-muted)]"
          />
        </span>
      </div>
      {transition.details && Object.keys(transition.details).length > 0 && (
        <div className="sm:col-span-2 lg:col-span-4">
          <Caption className="mb-1 block">{t('fsm.detail.context', "Context snapshot")}</Caption>
          <div className="mt-1 flex flex-wrap gap-2">
            {Object.entries(transition.details).map(([key, val]) => (
              <Text as="span" size="xs" color="secondary" mono key={key} className="rounded bg-[var(--surface-2)] px-2 py-0.5">
                {key}: {String(val)}
              </Text>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
