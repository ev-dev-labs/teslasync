import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { GitBranch } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, EmbeddedChart, type ChartDataRow } from '@/components/charts';
import { Caption, Subhead, Text } from '@/components/ui';
import { SourceContent } from '@/components/layout';
import { EmptyState } from '@/components/feedback';
import { useFSMStats, useFSMTransitions } from '@/api/hooks/useFSM';
import { useVehicles } from '@/api/hooks/useVehicles';

import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDataState } from '@/hooks/useDataState';
import { combineDataStates } from '@/api/dataState';
import { WidgetBigNumber } from './shared';
import { fmtNumber as formatDurationNumber } from '@/lib/numberFormat';
import { FSMTransitionRow } from '../components/continuation-dashboard-2/FSMTransitionRow';

/* ── State colors for donut chart ──────────────────────────────── */
const STATE_COLORS: Record<string, string> = {
  driving: '#22d3ee',   // cyan-400
  charging: '#22c55e',  // green-500
  asleep: '#a855f7',    // purple-500
  idle: '#f59e0b',      // amber-500
  offline: '#6b7280',   // gray-500
};

function stateColor(state: string): string {
  return STATE_COLORS[state.toLowerCase()] ?? '#6b7280';
}

/* ── Duration formatter (ms → human readable) ──────────────────── */
function fmtDuration(ms: number, t: (k: string, d: string) => string): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const totalMin = Math.round(ms / 60_000);
  const hrs = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hrs === 0) return `${formatDurationNumber(mins, 0)}${t('widget.fsmDistribution.min', 'm')}`;
  return `${formatDurationNumber(hrs, 0)}${t('widget.fsmDistribution.hr', 'h')} ${formatDurationNumber(mins, 0)}${t('widget.fsmDistribution.min', 'm')}`;
}

/* ── Donut segment data ────────────────────────────────────────── */
interface DonutSegment extends ChartDataRow {
  state: string;
  value: number;
  pct: number;
}

function buildDonutData(stats: Record<string, number> | undefined): DonutSegment[] {
  if (stats != null && (typeof stats !== 'object' || Array.isArray(stats))) return [];
  const entries = Object.entries(stats ?? {}).filter(([, v]) => typeof v === 'number' && Number.isFinite(v) && v > 0);
  const total = entries.reduce((sum, [, v]) => sum + (v ?? 0), 0);
  if (total === 0 || !Number.isFinite(total)) return [];
  return entries
    .map(([state, value]) => ({
      state,
      value: value ?? 0,
      pct: ((value ?? 0) / total) * 100,
    }))
    .sort((a, b) => b.value - a.value);
}

/* ── Custom tooltip ────────────────────────────────────────────── */
function DonutTooltip({
  active,
  payload,
  t,
}: {
  active?: boolean;
  payload?: Array<{ payload: DonutSegment }>;
  t: (k: string, d: string) => string;
}) {
  const { fmtNumber } = useNumberFormatting();
  if (!active || !payload?.[0]) return null;
  const seg = payload[0].payload;
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-2 shadow-lg">
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-2.5 w-2.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: stateColor(seg.state) }}
        />
        <Text variant="bodySm" className="break-words">
          {t(`widget.fsmDistribution.state.${seg.state}`, seg.state)}
        </Text>
      </div>
      <Caption className="mt-1 block break-words">
        {fmtDuration(seg.value, t)} · {fmtNumber(seg.pct)}%
      </Caption>
    </div>
  );
}

/* ── Main widget ───────────────────────────────────────────────── */
export default function FSMDistributionWidget({ vehicleId, size }: WidgetProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const vehiclesQuery = useVehicles();
  const { data: vehicles, isLoading: vehiclesLoading } = vehiclesQuery;
  const id = vehicleId ?? vehicles?.[0]?.id;
  const idStr = typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? String(id) : '';

  const statsQuery = useFSMStats(idStr);
  const {
    data: statsData,
    isLoading: statsLoading,
    isFetching: statsFetching,
    isStale: statsStale,
    isError: statsIsError,
    dataUpdatedAt: statsUpdatedAt,
    refetch: refetchStats,
  } = statsQuery;

  const transitionsQuery = useFSMTransitions(idStr, 'vehicle', 24, 1, 5);
  const {
    data: transitionsData,
    isLoading: transitionsLoading,
    isFetching: transitionsFetching,
    isStale: transitionsStale,
    isError: transitionsIsError,
    dataUpdatedAt: transitionsUpdatedAt,
    refetch: refetchTransitions,
  } = transitionsQuery;
  const rawStats = statsData?.stats;
  const invalidStats = rawStats != null && (
    typeof rawStats !== 'object' || Array.isArray(rawStats) ||
    Object.values(rawStats).some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0)
  );
  const statsState = useDataState(statsQuery, { partial: invalidStats });
  const transitionsState = useDataState(transitionsQuery, {
    partial: transitionsData?.data != null && !Array.isArray(transitionsData.data),
  });
  const vehiclesState = useDataState(vehiclesQuery);

  const isCompact = size.cols <= 1;

  const segments = useMemo(
    () => buildDonutData(statsData?.stats),
    [statsData],
  );

  const transitions = useMemo(() => {
    const rows = transitionsData?.data;
    const list = Array.isArray(rows) ? rows : [];
    return list.slice(0, isCompact ? 3 : 5);
  }, [transitionsData, isCompact]);

  const hasData = segments.length > 0;

  // Keep the skeleton up while the default vehicle is still resolving from
  // useVehicles: the FSM queries are disabled for an empty id and would report
  // "not loading", so without this gate the widget flashes its empty state
  // before the first fetch can even start.
  const isLoading =
    statsLoading || transitionsLoading || (vehicleId == null && vehiclesLoading);
  const handleRefresh = useCallback(() => {
    if (!idStr) {
      void vehiclesQuery.refetch();
      return;
    }
    void refetchStats();
    void refetchTransitions();
  }, [idStr, vehiclesQuery.refetch, refetchStats, refetchTransitions]);
  const hasPayload = statsState.hasData || transitionsState.hasData;
  const sourceError = statsState.fatalError ?? transitionsState.fatalError;
  const combined = combineDataStates([statsState, transitionsState]);
  const mergedState = {
    ...combined,
    data: statsData ?? transitionsData,
    hasData: hasPayload,
    fatalError: hasPayload ? null : sourceError,
    refreshError: hasPayload ? combined.refreshError ?? sourceError : null,
    status: !hasPayload && sourceError ? 'initialFailure' as const : combined.status,
    retry: handleRefresh,
  };
  const resolvingVehicle = !idStr && !hasPayload;
  const state = resolvingVehicle ? vehiclesState : isCompact ? { ...statsState, retry: handleRefresh } : mergedState;
  const sourceTimes = [
    statsState.hasData ? statsUpdatedAt : 0,
    transitionsState.hasData ? transitionsUpdatedAt : 0,
  ].filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
  const updatedAt = resolvingVehicle
    ? vehiclesQuery.dataUpdatedAt
    : sourceTimes.length > 0 ? Math.min(...sourceTimes) : 0;
  const isFetching = resolvingVehicle ? vehiclesQuery.isFetching : statsFetching || transitionsFetching;
  const isStale = resolvingVehicle ? vehiclesQuery.isStale : statsStale || transitionsStale;
  const isError = resolvingVehicle ? vehiclesQuery.isError : statsIsError || transitionsIsError;

  /* Compact view: state with the largest share of recorded time */
  if (isCompact) {
    const currentState = segments[0]?.state ?? '—';
    const currentMs = segments[0]?.value ?? 0;

    return (
      <WidgetShell
        title={t('widget.fsmDistribution.title', 'State distribution')}
        loading={isLoading}
        dataState={state}
        updatedAt={updatedAt}
        isFetching={isFetching}
        isStale={isStale}
        isError={isError}
        onRefresh={handleRefresh}
      >
        {hasData ? (
          <div className="flex flex-col items-center justify-center gap-2 h-full py-2">
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{ backgroundColor: stateColor(currentState) }}
            />
            <WidgetBigNumber
              value={t(`widget.fsmDistribution.state.${currentState}`, currentState)}
              subtitle={fmtDuration(currentMs, t)}
              align="center"
              size="secondary"
            />
          </div>
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<GitBranch className="h-5 w-5" />}
            message={t('widget.fsmDistribution.noData', 'No state data')}
            className="py-4"
          />
        )}
      </WidgetShell>
    );
  }

  /* Standard (2×4) view: donut chart + transitions feed */
  return (
    <WidgetShell
      title={t('widget.fsmDistribution.title', 'State distribution')}
      icon={<GitBranch className="h-3.5 w-3.5 text-cyan-400" />}
      loading={isLoading}
      dataState={state}
      updatedAt={updatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      <div className="flex flex-col gap-3 h-full">
        <SourceContent
          state={statsState.fatalError ? 'error' : !statsState.hasData && statsLoading ? 'loading' : !hasData ? 'empty' : statsState.refreshError ? 'retained' : 'ready'}
          label={t('widget.fsmDistribution.title', 'State distribution')}
          emptyMessage={t('widget.fsmDistribution.noData', 'No state data available')}
          errorMessage={t('widget.fsmDistribution.statsError', 'State distribution could not be loaded.')}
          error={statsState.fatalError}
          errorRecovery={{ onRetry: () => { void refetchStats(); } }}
          retainedMessage={t('widget.fsmDistribution.statsRetained', 'Previously loaded state distribution remains visible while it refreshes.')}
          emptyContent={<EmptyState /* no-action: the widget header already exposes refresh for this source */
            icon={<GitBranch className="h-5 w-5" />} message={t('widget.fsmDistribution.noData', 'No state data available')} className="py-4" />}
        >
          {/* Donut chart */}
          <EmbeddedChart
            title={t('widget.fsmDistribution.title', 'State distribution')}
            ariaLabel={t(
              'widget.fsmDistribution.chartAria',
              'Time spent in each vehicle state',
            )}
            data={segments}
            dataColumns={[
              { key: 'state', label: t('widget.fsmDistribution.stateLabel', 'State') },
              {
                key: 'value',
                label: t('widget.fsmDistribution.duration', 'Duration'),
                format: (value) => fmtDuration(Number(value ?? 0), t),
              },
              {
                key: 'pct',
                label: t('widget.fsmDistribution.share', 'Share'),
                format: (value) => `${fmtNumber(Number(value ?? 0))}%`,
              },
            ]}
            className="flex-1 min-h-0"
          >
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={segments}
                  dataKey="value"
                  nameKey="state"
                  cx="50%"
                  cy="50%"
                  innerRadius="55%"
                  outerRadius="80%"
                  paddingAngle={2}
                  strokeWidth={0}
                >
                  {segments.map((seg) => (
                    <Cell key={seg.state} fill={stateColor(seg.state)} />
                  ))}
                </Pie>
                <Tooltip
                  content={<DonutTooltip t={t} />}
                  wrapperStyle={{ outline: 'none' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </EmbeddedChart>

          {/* Legend */}
          <div className="flex flex-wrap gap-x-3 gap-y-1 justify-center">
            {segments.map((seg) => (
              <div key={seg.state} className="flex items-center gap-1">
                <span
                  className="inline-block h-2 w-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: stateColor(seg.state) }}
                />
                <Caption className="break-words">
                  {t(`widget.fsmDistribution.state.${seg.state}`, seg.state)}
                </Caption>
                <Caption className="tabular-nums">
                  {fmtNumber(seg.pct)}%
                </Caption>
              </div>
            ))}
          </div>

        </SourceContent>

          {/* Transitions feed */}
            <div className="flex min-w-0 flex-col gap-0.5 overflow-y-auto">
              <Subhead className="break-words">
                {t('widget.fsmDistribution.recentTransitions', 'Recent transitions')}
              </Subhead>
              <SourceContent
                state={transitionsState.fatalError ? 'error' : !transitionsState.hasData && transitionsLoading ? 'loading' : transitions.length === 0 ? 'empty' : transitionsState.refreshError ? 'retained' : 'ready'}
                label={t('widget.fsmDistribution.recentTransitions', 'Recent transitions')}
                emptyMessage={t('widget.fsmDistribution.noTransitions', 'No recent transitions')}
                errorMessage={t('widget.fsmDistribution.transitionsError', 'Recent transitions could not be loaded.')}
                error={transitionsState.fatalError}
                errorRecovery={{ onRetry: () => { void refetchTransitions(); } }}
                retainedMessage={t('widget.fsmDistribution.transitionsRetained', 'Previously loaded transitions remain visible while they refresh.')}
              >
              {transitions.map((tr) => (
                <FSMTransitionRow
                  key={tr.id}
                  from={tr.from_state ?? '—'}
                  to={tr.to_state ?? '—'}
                  timestamp={tr.ts ?? ''}
                />
              ))}
              </SourceContent>
            </div>
      </div>
    </WidgetShell>
  );
}
