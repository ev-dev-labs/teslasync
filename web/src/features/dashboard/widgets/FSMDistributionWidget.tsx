import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { GitBranch } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ChartTooltip, ResponsiveContainer, EmbeddedChart, type ChartDataRow } from '@/components/charts';
import { Caption, MetricValue, Subhead, Text } from '@/components/ui';
import { SourceContent } from '@/components/layout';
import { EmptyState } from '@/components/feedback';
import { useFSMStats, useFSMTransitions } from '@/api/hooks/useFSM';
import { useVehicles } from '@/api/hooks/useVehicles';

import { WidgetShell } from './WidgetShell';
import InstrumentPresentation from './designPacks/InstrumentPresentation';
import type { WidgetProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDataState } from '@/hooks/useDataState';
import { combineDataStates } from '@/api/dataState';
import { WidgetBigNumber } from './shared';
import { fmtNumber as formatDurationNumber } from '@/lib/numberFormat';
import { useDateFormat } from '@/hooks/useDateFormat';
import { CHART_SEMANTIC, CHART_NEUTRAL } from '@/lib/colors';

/* ── State colors for donut chart ──────────────────────────────── */
const STATE_COLORS: Record<string, string> = {
  driving: CHART_SEMANTIC.vehicle.driving,
  charging: CHART_SEMANTIC.vehicle.charging,
  online: CHART_SEMANTIC.vehicle.online,
  parked: CHART_SEMANTIC.vehicle.parked,
  asleep: CHART_SEMANTIC.vehicle.asleep,
  idle: CHART_SEMANTIC.vehicle.charging,
  offline: CHART_SEMANTIC.vehicle.offline,
};

function stateColor(state: string): string {
  return STATE_COLORS[state.toLowerCase()] ?? CHART_NEUTRAL;
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
    <ChartTooltip
      active={active}
      payload={[{
        name: t(`widget.fsmDistribution.state.${seg.state}`, seg.state),
        value: seg.value,
        color: stateColor(seg.state),
      }]}
      valueFormatter={() => `${fmtDuration(seg.value, t)} · ${fmtNumber(seg.pct)}%`}
    />
  );
}

/* ── Main widget ───────────────────────────────────────────────── */
export default function FSMDistributionWidget({ vehicleId, size }: WidgetProps) {
  const { fmtNumber } = useNumberFormatting();
  const { formatTime, formatDateTime } = useDateFormat();
  const { t } = useTranslation('dashboard');
  const vehiclesQuery = useVehicles();
  const { data: vehicles, isLoading: vehiclesLoading } = vehiclesQuery;
  const id = vehicleId ?? vehicles?.[0]?.id;
  const idStr = typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? String(id) : '';

  const statsQuery = useFSMStats(idStr);
  const transitionsQuery = useFSMTransitions(idStr, 'vehicle', 24, 1, 5);
  const transitionsData = Array.isArray(transitionsQuery.data?.data) ? transitionsQuery.data.data : [];
  const transitionState = useDataState(transitionsQuery);
  const {
    data: statsData,
    isLoading: statsLoading,
    isFetching: statsFetching,
    isStale: statsStale,
    isError: statsIsError,
    dataUpdatedAt: statsUpdatedAt,
    refetch: refetchStats,
  } = statsQuery;

  const rawStats = statsData?.stats;
  const invalidStats = rawStats != null && (
    typeof rawStats !== 'object' || Array.isArray(rawStats) ||
    Object.values(rawStats).some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0)
  );
  const isCompact = size.cols <= 1;

  const segments = useMemo(
    () => buildDonutData(statsData?.stats),
    [statsData],
  );

  const hasData = segments.length > 0;
  const statsState = useDataState(statsQuery, {
    partial: invalidStats,
    unavailable: statsData != null && !invalidStats && !hasData,
  });
  const vehiclesState = useDataState(vehiclesQuery);
  const leading = segments[0];
  const leadingPct = leading ? fmtNumber(leading.pct, 0) : null;
  const reading = leading ? {
    value: leading.pct,
    max: 100,
    label: t('widget.fsmDistribution.share', 'Share'),
    unit: '%',
    color: stateColor(leading.state),
  } : undefined;
  const context = <Caption>{t('dashboardWidgets.analytics.fsmDistribution.shareNote', 'Percentages are based on the returned states.')}</Caption>;

  // Keep the skeleton up while the default vehicle is still resolving from
  // useVehicles: the FSM queries are disabled for an empty id and would report
  // "not loading", so without this gate the widget flashes its empty state
  // before the first fetch can even start.
  const isLoading =
    statsLoading || (vehicleId == null && vehiclesLoading);
  const handleRefresh = useCallback(() => {
    if (!idStr) {
      void vehiclesQuery.refetch();
      return;
    }
    void refetchStats();
    if (!isCompact) void transitionsQuery.refetch();
  }, [idStr, isCompact, vehiclesQuery.refetch, refetchStats, transitionsQuery.refetch]);
  const hasPayload = statsState.hasData || transitionState.hasData;
  const sourceError = statsState.fatalError;
  const combined = combineDataStates([statsState, transitionState]);
  const mergedState = {
    ...combined,
    data: statsData,
    hasData: hasPayload,
    fatalError: hasPayload ? null : sourceError,
    refreshError: hasPayload ? combined.refreshError ?? sourceError : null,
    status: !statsState.hasData && !transitionState.hasData && sourceError ? 'initialFailure' as const : combined.status,
    retry: handleRefresh,
  };
  const resolvingVehicle = !idStr && !hasPayload;
  const state = resolvingVehicle ? vehiclesState : isCompact ? { ...statsState, retry: handleRefresh } : mergedState;
  const sourceTimes = [
    statsState.hasData ? statsUpdatedAt : 0,
    !isCompact && transitionState.hasData ? transitionsQuery.dataUpdatedAt : 0,
  ].filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
  const updatedAt = resolvingVehicle
    ? vehiclesQuery.dataUpdatedAt
    : sourceTimes.length > 0 ? Math.min(...sourceTimes) : 0;
  const isFetching = resolvingVehicle ? vehiclesQuery.isFetching : statsFetching || (!isCompact && transitionsQuery.isFetching);
  const isStale = resolvingVehicle ? vehiclesQuery.isStale : statsStale || (!isCompact && transitionsQuery.isStale);
  const isError = resolvingVehicle ? vehiclesQuery.isError : statsIsError || (!isCompact && transitionsQuery.isError);

  /* Compact view: state with the largest share of recorded time */
  if (isCompact) {
    const currentState = leading?.state ?? '—';
    const compactBody = hasData ? (
          <div className="flex flex-col items-center justify-center gap-2 h-full py-2">
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{ backgroundColor: stateColor(currentState) }}
            />
            <MetricValue className="leading-none tabular-nums">{`${leadingPct}%`}</MetricValue>
            <WidgetBigNumber
              value={t(`widget.fsmDistribution.state.${currentState}`, currentState)}
              subtitle={leading ? fmtDuration(leading.value, t) : '—'}
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
        );

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
        <InstrumentPresentation family="segments" compact headline={compactBody}
          icon={<GitBranch />} context={context} reading={reading}>
          {compactBody}
        </InstrumentPresentation>
      </WidgetShell>
    );
  }

  /* Standard (2×4) view: donut chart + transitions feed */
  const chart = (
        <SourceContent
            state={statsState.fatalError ? 'error' : !statsState.hasData && statsLoading ? 'loading' : !hasData ? 'empty' : statsState.refreshError ? 'retained' : 'ready'}
            label={t('widget.fsmDistribution.title', 'State distribution')}
            emptyMessage={t('widget.fsmDistribution.noData', 'No state data')}
            errorMessage={t('widget.fsmDistribution.statsError', 'State distribution could not be loaded.')}
            error={statsState.fatalError}
            errorRecovery={{ onRetry: () => { void refetchStats(); } }}
            retainedMessage={t('widget.fsmDistribution.statsRetained', 'Previously loaded state distribution remains visible while it refreshes.')}
            emptyContent={<EmptyState /* no-action: the widget header already exposes refresh for this source */
              icon={<GitBranch className="h-5 w-5" />} message={t('widget.fsmDistribution.noData', 'No state data')} className="py-4" />}
          >
          <EmbeddedChart
            title={t('widget.fsmDistribution.title', 'State distribution')}
            ariaLabel={t('widget.fsmDistribution.chartAria', 'Time spent in each vehicle state')}
            data={segments}
            dataColumns={[
              { key: 'state', label: t('widget.fsmDistribution.stateLabel', 'State') },
              { key: 'value', label: t('widget.fsmDistribution.duration', 'Duration'), format: (value) => fmtDuration(Number(value ?? 0), t) },
              { key: 'pct', label: t('widget.fsmDistribution.share', 'Share'), format: (value) => `${fmtNumber(Number(value ?? 0))}%` },
            ]}
            className="min-h-0 h-full min-w-0"
          >
            <div className="relative h-full min-h-[120px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={segments}
                    dataKey="value"
                    nameKey="state"
                    cx="50%"
                    cy="50%"
                    innerRadius="58%"
                    outerRadius="82%"
                    paddingAngle={2}
                    strokeWidth={0}
                  >
                    {segments.map((seg) => (
                      <Cell key={seg.state} fill={stateColor(seg.state)} />
                    ))}
                  </Pie>
                  <Tooltip content={<DonutTooltip t={t} />} wrapperStyle={{ outline: 'none' }} />
                </PieChart>
              </ResponsiveContainer>
              {leading && (
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                  <MetricValue className="leading-none tabular-nums">{leadingPct}%</MetricValue>
                  <Caption className="mt-1 max-w-[90px] break-words">
                    {t(`widget.fsmDistribution.state.${leading.state}`, leading.state)}
                  </Caption>
                </div>
              )}
            </div>
          </EmbeddedChart>
        </SourceContent>
  );
  const details = (
        <div className="min-w-0">
            <ol data-app-part="list" aria-label={t('widget.fsmDistribution.rankedStates', 'State shares')} className="min-w-0 divide-y divide-[var(--border-subtle)]">
              {segments.map((seg) => (
                <li key={seg.state} className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-1.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: stateColor(seg.state) }} />
                    <Text variant="bodySm" className="min-w-0 break-words">{t(`widget.fsmDistribution.state.${seg.state}`, seg.state)}</Text>
                  </div>
                  <Text variant="bodySm" className="text-right tabular-nums text-[var(--text-primary)]">{fmtNumber(seg.pct, 0)}%</Text>
                </li>
              ))}
            </ol>
            <Subhead className="mt-2">{t('widget.fsmDistribution.recentTransitions', 'Recent transitions')}</Subhead>
            <SourceContent
              state={transitionState.fatalError ? 'error' : !transitionState.hasData && transitionsQuery.isLoading ? 'loading' : transitionState.refreshError ? 'retained' : transitionsData.length === 0 ? 'empty' : 'ready'}
              label={t('widget.fsmDistribution.recentTransitions', 'Recent transitions')}
              emptyMessage={t('widget.fsmDistribution.noTransitions', 'No recent transitions')}
              emptyContent={<Text variant="bodySm" className="text-[var(--text-muted)]">{t('widget.fsmDistribution.noTransitions', 'No recent transitions')}</Text>}
              errorMessage={t('widget.fsmDistribution.transitionsError', 'Recent transitions could not be loaded.')}
              error={transitionState.fatalError}
              errorRecovery={{ onRetry: () => { void transitionsQuery.refetch(); } }}
              retainedMessage={t('widget.fsmDistribution.transitionsRetained', 'Previously loaded transitions remain visible while they refresh.')}
            >
              <ol data-app-part="list" aria-label={t('widget.fsmDistribution.recentTransitions', 'Recent transitions')} className="m-0 mt-1 list-none p-0">
                {transitionsData.slice(0, 5).map((row: { id?: number|string; from_state?: string; to_state?: string; ts?: string }, index: number) => (
                  <li key={row.id ?? index} className="min-w-0 py-1">
                    <Caption className="block break-words">{row.from_state ?? '—'}</Caption>
                    <Caption className="block break-words">{row.to_state ?? '—'}</Caption>
                    <time dateTime={row.ts}><Caption>{row.ts ? formatDateTime?.(row.ts) ?? formatTime(row.ts) : '—'}</Caption></time>
                  </li>
                ))}
              </ol>
            </SourceContent>
        </div>
  );

  return (
    <WidgetShell
      title={t('widget.fsmDistribution.title', 'State distribution')}
      icon={<GitBranch className="h-3.5 w-3.5 text-theme-accent" />}
      loading={isLoading}
      dataState={state}
      updatedAt={updatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      <InstrumentPresentation family="segments" compact={false} icon={<GitBranch />}
        headline={<WidgetBigNumber value={leadingPct} unit="%" label={t('widget.fsmDistribution.share', 'Share')}
          subtitle={leading ? t(`widget.fsmDistribution.state.${leading.state}`, leading.state) : undefined} />}
        context={context} reading={reading}
        instrument={<div className="min-h-[160px]">{chart}</div>} details={details}>
      <div className="grid h-full min-h-0 grid-cols-[minmax(120px,0.9fr)_minmax(150px,1.1fr)] items-center gap-4">
        {chart}
        {details}
      </div>
      </InstrumentPresentation>
    </WidgetShell>
  );
}
