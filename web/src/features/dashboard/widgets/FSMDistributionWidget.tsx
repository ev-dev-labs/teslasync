import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { GitBranch } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, EmbeddedChart, type ChartDataRow } from '@/components/charts';
import { Badge } from '@/components/ui';
import { TimeStamp } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { useFSMStats, useFSMTransitions } from '@/api/hooks/useFSM';
import { useVehicles } from '@/api/hooks/useVehicles';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

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
  const totalMin = ms / 60_000;
  const hrs = Math.floor(totalMin / 60);
  const mins = Math.round(totalMin % 60);
  if (hrs === 0) return `${mins}${t('widget.fsmDistribution.min', 'm')}`;
  return `${hrs}${t('widget.fsmDistribution.hr', 'h')} ${mins}${t('widget.fsmDistribution.min', 'm')}`;
}

/* ── Donut segment data ────────────────────────────────────────── */
interface DonutSegment extends ChartDataRow {
  state: string;
  value: number;
  pct: number;
}

function buildDonutData(stats: Record<string, number> | undefined): DonutSegment[] {
  const entries = Object.entries(stats ?? {}).filter(([, v]) => (v ?? 0) > 0);
  const total = entries.reduce((sum, [, v]) => sum + (v ?? 0), 0);
  if (total === 0) return [];
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
  if (!active || !payload?.[0]) return null;
  const seg = payload[0].payload;
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] backdrop-blur-xl px-3 py-2 text-xs shadow-lg">
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-2.5 w-2.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: stateColor(seg.state) }}
        />
        <span className="text-[var(--text-primary)] capitalize">
          {t(`widget.fsmDistribution.state.${seg.state}`, seg.state)}
        </span>
      </div>
      <div className="mt-1 text-[var(--text-secondary)]">
        {fmtDuration(seg.value, t)} · {fmtNumber(seg.pct, 1)}%
      </div>
    </div>
  );
}

/* ── Transition feed row ───────────────────────────────────────── */
function TransitionRow({
  from,
  to,
  timestamp,
  t,
}: {
  from: string;
  to: string;
  timestamp: string;
  t: (k: string, d: string) => string;
}) {
  return (
    <div className="flex items-center justify-between min-h-[44px] gap-2">
      <div className="flex items-center gap-1.5 min-w-0">
        <Badge variant="neutral" className="text-2xs capitalize truncate max-w-[72px]">
          {t(`widget.fsmDistribution.state.${from}`, from)}
        </Badge>
        <span className="text-2xs text-[var(--text-muted)]">→</span>
        <Badge variant="neutral" className="text-2xs capitalize truncate max-w-[72px]">
          {t(`widget.fsmDistribution.state.${to}`, to)}
        </Badge>
      </div>
      <span className="flex-shrink-0">
        <TimeStamp value={timestamp} className="text-2xs text-[var(--text-muted)] tabular-nums" />
      </span>
    </div>
  );
}

/* ── Main widget ───────────────────────────────────────────────── */
export default function FSMDistributionWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles, isLoading: vehiclesLoading } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? null;
  const idStr = id != null ? String(id) : '';

  const {
    data: statsData,
    error: statsError,
    isLoading: statsLoading,
    isFetching: statsFetching,
    isStale: statsStale,
    isError: statsIsError,
    dataUpdatedAt: statsUpdatedAt,
    refetch: refetchStats,
  } = useFSMStats(idStr);

  const {
    data: transitionsData,
    isLoading: transitionsLoading,
    isFetching: transitionsFetching,
    isStale: transitionsStale,
    isError: transitionsIsError,
    dataUpdatedAt: transitionsUpdatedAt,
    refetch: refetchTransitions,
  } = useFSMTransitions(idStr, 'vehicle', 24, 1, 5);

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

  /* Freshness: merge from both queries */
  const updatedAt = Math.max(statsUpdatedAt ?? 0, transitionsUpdatedAt ?? 0);
  const isFetching = statsFetching || transitionsFetching;
  const isStale = statsStale || transitionsStale;
  const isError = statsIsError || transitionsIsError;
  // Keep the skeleton up while the default vehicle is still resolving from
  // useVehicles: the FSM queries are disabled for an empty id and would report
  // "not loading", so without this gate the widget flashes its empty state
  // before the first fetch can even start.
  const isLoading =
    statsLoading || transitionsLoading || (vehicleId == null && vehiclesLoading);
  // Surface the primary (stats) fetch failure through the shell so a genuine
  // error is distinguishable from a legitimately-empty distribution instead of
  // both collapsing into the same "no data" placeholder.
  const shellError = statsError ? String(statsError) : null;

  const handleRefresh = useCallback(() => {
    refetchStats();
    refetchTransitions();
  }, [refetchStats, refetchTransitions]);

  /* Compact view: current state badge + time in current state */
  if (isCompact) {
    const currentState = segments[0]?.state ?? '—';
    const currentMs = segments[0]?.value ?? 0;

    return (
      <WidgetShell
        loading={isLoading}
        error={shellError}
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
            <span className="text-sm font-semibold text-[var(--text-primary)] capitalize">
              {t(`widget.fsmDistribution.state.${currentState}`, currentState)}
            </span>
            <span className="text-xs text-[var(--text-secondary)]">
              {fmtDuration(currentMs, t)}
            </span>
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
      title={t('widget.fsmDistribution.title', 'State Distribution')}
      icon={<GitBranch className="h-3.5 w-3.5 text-cyan-400" />}
      loading={isLoading}
      error={shellError}
      updatedAt={updatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      {hasData ? (
        <div className="flex flex-col gap-3 h-full">
          {/* Donut chart */}
          <EmbeddedChart
            title={t('widget.fsmDistribution.title', 'State Distribution')}
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
                format: (value) => `${fmtNumber(Number(value ?? 0), 1)}%`,
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
                <span className="text-2xs text-[var(--text-secondary)] capitalize">
                  {t(`widget.fsmDistribution.state.${seg.state}`, seg.state)}
                </span>
                <span className="text-2xs text-[var(--text-muted)] tabular-nums">
                  {fmtInt(seg.pct)}%
                </span>
              </div>
            ))}
          </div>

          {/* Transitions feed */}
          {transitions.length > 0 && (
            <div className="flex flex-col gap-0.5 overflow-y-auto">
              <span className="text-2xs uppercase tracking-wider text-[var(--text-muted)]">
                {t('widget.fsmDistribution.recentTransitions', 'Recent Transitions')}
              </span>
              {transitions.map((tr) => (
                <TransitionRow
                  key={tr.id}
                  from={tr.from_state ?? '—'}
                  to={tr.to_state ?? '—'}
                  timestamp={tr.ts ?? ''}
                  t={t}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<GitBranch className="h-5 w-5" />}
          message={t('widget.fsmDistribution.noData', 'No state data available')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
