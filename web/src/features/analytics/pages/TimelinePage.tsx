import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Clock, Car, BatteryCharging, RefreshCw, AlertCircle,
  Activity, BarChart3, Bell, MapPin, Route, Wrench,
} from 'lucide-react';

import { PageLayout, CardGrid, LayoutCard, ChartCard } from '@/components/layout';
import { Badge, Button, DataTable, Text, Caption, type Column } from '@/components/ui';

import { useRangeState } from '@/hooks/useRangeState';
import { useTimezone } from '@/lib/timezone';
import {
  DataFreshnessAuto,
  EntityPreviewDrawer,
  MetricBar,
  CompositionRail,
} from '@/components/data-display';
import { EmptyState, AlertBanner } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ChartLegend, ChartTooltip,
} from '@/components/charts';

import { useVehicles } from '@/api/hooks/useVehicles';
import {
  useTimelinePageTimeline, useTimelinePageSummary,
  type TransitionRecord, type ByStateRow,
} from '@/api/hooks/useTimelinePage';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDateTime } from '@/lib/dateFormat';

import { getErrorMessage } from '@/lib/errorMessage';
import { buildContextHref } from '@/lib/contextNavigation';
import { localDayKey } from '@/lib/drivesAggregation';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { StatPeriod } from '@/lib/metric-reference';
import { TimelineSource, type TimelineSourceFacts } from '../components/timeline-modernization';
import { OperationalBrief, type StatMetric } from '@/components/data-display';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';

/* ─── Types matching actual API responses ────────────────── */

/** The API hook returns point-in-time FSM transitions, not state durations.
 * Dwell-time metrics continue to use the independent summary endpoint. */

/** Indexed transition row for the table. Adds the timestamp of the
 *  *next* transition so the table can compute "duration spent in
 *  to_state" without extra hooks. The newest row has no successor —
 *  its duration is computed from `now` so the user sees how long the
 *  vehicle has been in the current state. */
interface TransitionRow extends TransitionRecord {
  index: number;
  next_ts: string | null;
}

/* ─── Constants ──────────────────────────────────────────── */

const STATE_COLORS: Record<string, string> = {
  driving: '#10b981',
  charging: '#0891b2',
  idle: '#f59e0b',
  sleeping: '#64748b',
  online: '#3b82f6',
  offline: '#374151',
  parked: '#8b5cf6',
  asleep: '#64748b',
};

const STATE_BADGE: Record<string, 'success' | 'info' | 'warning' | 'neutral' | 'danger'> = {
  driving: 'success',
  charging: 'info',
  idle: 'warning',
  sleeping: 'neutral',
  online: 'info',
  offline: 'danger',
  parked: 'warning',
  asleep: 'neutral',
};

function formatHoursFromSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0m';
  // Round to whole minutes ONCE, then split into h/m. Flooring the hours and
  // rounding the leftover minutes independently used to emit "60m" (e.g.
  // 3599s) or "1h 60m" (e.g. 7199s) at the boundary where the residual
  // minutes rounded up to a full hour.
  const totalMinutes = Math.round(seconds / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatDurationFromSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s';
  const rounded = Math.round(seconds);
  // Only sub-minute durations render in seconds; once rounding tips the value
  // to a full minute defer to the h/m formatter so we never emit "60s".
  if (rounded < 60) return `${rounded}s`;
  return formatHoursFromSeconds(seconds);
}

function transitionDuration(row: TransitionRow): string {
  const start = new Date(row.ts).getTime();
  const end = row.next_ts ? new Date(row.next_ts).getTime() : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return '—';
  return formatDurationFromSeconds((end - start) / 1000);
}

/* ─── Component ──────────────────────────────────────────── */

export default function TimelinePage() {
  const { fmtPercent } = useNumberFormatting();
  const { t } = useTranslation();
  usePageTitle(t('timeline.title', 'Timeline'));

  // Vehicle selection is global, persistent, URL-aware, and bookmarkable.
  const { vehicleId } = useSelectedVehicle();
  const activeId = vehicleId != null ? String(vehicleId) : '';
  const enabled = activeId !== '';

  const timezone = useTimezone('vehicle');
  const { startInstant, endInstantExclusive } = useRangeState({
    persistKey: 'timeline.range',
    defaultPresetId: '7d',
    timezone,
  });
  const [previewTransition, setPreviewTransition] = useState<TransitionRow | null>(null);
  const previewDay = localDayKey(previewTransition?.ts);

  const { error: vehiclesError } = useVehicles();

  // API integrator's exact extracted contract: string ID, both range operands,
  // original cache keys/enabled/default policies and unforwarded cancellation.
  const timelineQuery = useTimelinePageTimeline(activeId, startInstant, endInstantExclusive);
  const { data: timelineData, isLoading: tlLoading, error: timelineError, refetch } = timelineQuery;

  const summaryQuery = useTimelinePageSummary(activeId, startInstant, endInstantExclusive);
  const { data: summaryData, isLoading: sumLoading, error: summaryError } = summaryQuery;

  /* Defensive coercion — even with TanStack handling network errors, an
   * unexpected response shape (e.g. backend returns an array, or an error
   * envelope object) would otherwise crash with "X is not iterable" inside
   * the for/of loops below. */
  const transitionsRaw = Array.isArray(timelineData?.transitions)
    ? timelineData.transitions
    : [];
  const summaryRows: ByStateRow[] = Array.isArray(summaryData?.by_state)
    ? summaryData.by_state
    : [];
  const totalSeconds = summaryData?.total_seconds ?? 0;

  const timelineSource: TimelineSourceFacts = {
    enabled,
    available: Array.isArray(timelineData?.transitions),
    loading: tlLoading,
    paused: timelineQuery.isPaused,
    error: timelineError,
  };
  const summarySource: TimelineSourceFacts = {
    enabled,
    available: Array.isArray(summaryData?.by_state),
    loading: sumLoading,
    paused: summaryQuery.isPaused,
    error: summaryError,
  };
  const distributionSource: TimelineSourceFacts = {
    ...summarySource,
    available: summarySource.available && Number.isFinite(summaryData?.total_seconds),
  };
  const summaryPeriod: StatPeriod = {
    kind: 'analysis',
    label: t('timeline.summary.period', '{{start}} – {{end}} (exclusive) · {{timezone}}', {
      start: formatDateTime(startInstant, { tz: timezone }),
      end: formatDateTime(endInstantExclusive, { tz: timezone }),
      timezone,
    }),
    start: startInstant,
    endExclusive: endInstantExclusive,
    timezone,
    // A requested analysis window is not proof of complete vehicle observation.
    completeness: 'unknown',
    provenance: t('timeline.summary.provenance', 'Vehicle FSM summary for the requested window; continuous observation coverage is unknown'),
  };

  // Indexed transition rows for the table — sorted ASC by ts so duration
  // computations point to the correct neighbour. The DataTable's own
  // "Time" column is sortable so the user can still flip the display
  // order without affecting duration math.
  const transitions = useMemo<TransitionRow[]>(() => {
    if (transitionsRaw.length === 0) return [];
    const ordered = [...transitionsRaw].sort(
      (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
    );
    return ordered.map((rec, i) => ({
      ...rec,
      index: i,
      next_ts: i + 1 < ordered.length ? ordered[i + 1].ts : null,
    }));
  }, [transitionsRaw]);

  /* Daily breakdown — bin transitions by YYYY-MM-DD of `ts`, count by
   * the *destination* state (to_state) since that is what the original
   * pre-refactor chart visualised. We collapse the 8 raw FSM states
   * into the 4 user-facing buckets shown in the legend (driving /
   * charging / idle / sleeping) so the chart stays readable. */
  const dailyBreakdown = useMemo(() => {
    if (transitions.length === 0) return [];
    const buckets = new Map<
      string,
      { day: string; driving: number; charging: number; idle: number; sleeping: number }
    >();
    for (const row of transitions) {
      const date = new Date(row.ts);
      if (Number.isNaN(date.getTime())) continue;
      const day = date.toISOString().slice(0, 10);
      const bucket = buckets.get(day) ?? {
        day,
        driving: 0,
        charging: 0,
        idle: 0,
        sleeping: 0,
      };
      const target = row.to_state;
      if (target === 'driving') bucket.driving += 1;
      else if (target === 'charging') bucket.charging += 1;
      else if (target === 'idle' || target === 'online' || target === 'parked') bucket.idle += 1;
      else if (target === 'sleeping' || target === 'asleep' || target === 'offline') bucket.sleeping += 1;
      buckets.set(day, bucket);
    }
    return Array.from(buckets.values()).sort((a, b) => a.day.localeCompare(b.day));
  }, [transitions]);

  // Derive summary metrics from the raw summary rows
  const summaryByState = useMemo(() => {
    const m: Record<string, { transitionCount: number; totalSeconds: number; percentage: number }> = {};
    for (const row of summaryRows) {
      m[row.state] = {
        transitionCount: row.transition_count,
        totalSeconds: row.total_seconds,
        percentage: row.percentage,
      };
    }
    return m;
  }, [summaryRows]);

  // Per-state dwell time for the bento side panel — same summary payload as the
  // KPIs, sorted so dominant states surface first, with a display color.
  const timeByState = useMemo(
    () =>
      [...summaryRows]
        .filter((r) => (r.total_seconds ?? 0) > 0)
        .sort((a, b) => b.total_seconds - a.total_seconds)
        .map((r) => ({ ...r, color: STATE_COLORS[r.state] ?? STATE_COLORS.offline })),
    [summaryRows],
  );

  const totalTransitions = summaryRows.reduce((s, r) => s + (r.transition_count ?? 0), 0);
  const drivingSec = summaryByState.driving?.totalSeconds ?? 0;
  const chargingSec = summaryByState.charging?.totalSeconds ?? 0;
  const idleSec = (summaryByState.online?.totalSeconds ?? 0) +
    (summaryByState.parked?.totalSeconds ?? 0) +
    (summaryByState.idle?.totalSeconds ?? 0);
  const sleepingSec = (summaryByState.asleep?.totalSeconds ?? 0) +
    (summaryByState.sleeping?.totalSeconds ?? 0) +
    (summaryByState.offline?.totalSeconds ?? 0);
  const summaryMetrics: StatMetric[] = [
    { metricId: 'count', occurrenceId: 'timeline-total-transitions',
      label: t('timeline.totalTransitions', 'Total transitions'),
      description: t('timeline.summary.transitionDescription', 'Sum of transition counts returned by the state summary for this window'),
      rawValue: summarySource.available ? totalTransitions : null },
    { metricId: 'duration', occurrenceId: 'timeline-driving-time',
      label: t('timeline.drivingTime', 'Driving time'),
      description: t('timeline.summary.drivingDescription', 'Time in the driving state, rounded to whole minutes'),
      rawValue: summarySource.available ? drivingSec : null,
      display: { formatter: raw => ({ value: formatHoursFromSeconds(raw), unit: '' }) } },
    { metricId: 'duration', occurrenceId: 'timeline-charging-time',
      label: t('timeline.chargingTime', 'Charging time'),
      description: t('timeline.summary.chargingDescription', 'Time in the charging state, rounded to whole minutes'),
      rawValue: summarySource.available ? chargingSec : null,
      display: { formatter: raw => ({ value: formatHoursFromSeconds(raw), unit: '' }) } },
    { metricId: 'duration', occurrenceId: 'timeline-idle-sleep-time',
      label: t('timeline.idleSleepTime', 'Idle / sleep time'),
      description: t('timeline.summary.idleSleepDescription', 'Combined online, parked, idle, asleep, sleeping and offline time, rounded to whole minutes'),
      rawValue: summarySource.available ? idleSec + sleepingSec : null,
      display: { formatter: raw => ({ value: formatHoursFromSeconds(raw), unit: '' }) } },
  ];
  const summaryOperationalMetrics = useOperationalMetrics(summaryMetrics.map(metric => ({
    ...metric, missingReason: t('timeline.summary.missing', 'No state summary is available for this window'),
  })));

  /* ─── Table columns ─── */

  const columns = useMemo<Column<TransitionRow>[]>(
    () => [
      {
        key: 'ts',
        header: t('timeline.time', 'Time'),
        sortable: true,
        render: (row) => (
          <Text variant="body">{formatDateTime(row.ts)}</Text>
        ),
      },
      {
        key: 'from_state',
        filterValue: (row) => row.from_state,
        header: t('timeline.fromState', 'From state'),
        sortable: true,
        render: (row) => {
          const fromState = row.from_state;
          if (fromState == null) {
            return <Badge variant="neutral" size="sm">—</Badge>;
          }
          return (
            <Badge variant={STATE_BADGE[fromState] ?? 'neutral'} size="sm">
              {fromState}
            </Badge>
          );
        },
      },
      {
        key: 'to_state',
        filterValue: (row) => row.to_state,
        header: t('timeline.toState', 'To state'),
        sortable: true,
        render: (row) => (
          <Badge variant={STATE_BADGE[row.to_state] ?? 'neutral'} size="sm">
            {row.to_state}
          </Badge>
        ),
      },
      {
        key: 'duration',
        align: 'right',
        header: t('timeline.duration', 'Duration'),
        sortable: false,
        render: (row) => {
          const duration = transitionDuration(row);
          if (duration === '—') return <Caption>—</Caption>;
          return (
            <Text variant="body" className="tabular-nums">
              {duration}
            </Text>
          );
        },
      },
      {
        key: 'trigger_field',
        filterValue: (row) => row.trigger_field ?? null,
        header: t('timeline.trigger', 'Trigger'),
        sortable: true,
        render: (row) => (
          <Text variant="bodySm">
            {row.trigger_field ?? '—'}
          </Text>
        ),
      },
      {
        key: 'actions',
        header: t('timeline.actions', 'Actions'),
        sortable: false,
        render: (row) => (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-11"
            aria-label={t(
              'timeline.inspectTransition',
              'Inspect transition {{from}} to {{to}}',
              { from: row.from_state ?? '—', to: row.to_state },
            )}
            onClick={() => setPreviewTransition(row)}
          >
            {t('timeline.inspect', 'Inspect')}
          </Button>
        ),
      },
    ],
    [t],
  );

  /* ─── Refresh action ─── */

  const actions = (
      <Button
        variant="ghost"
        className="min-h-11 min-w-11"
        onClick={() => refetch()}
        aria-label={t('timeline.refresh', 'Refresh timeline')}
      >
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
      </Button>
  );

  return (
    <PageLayout
      title={t('timeline.title', 'Timeline')}
      subtitle={t('timeline.subtitle', 'Vehicle state history and transitions')}
      metadataActions={<DataFreshnessAuto query={timelineQuery} />}
      secondaryActions={actions}
    >
      {vehiclesError && (
        <AlertBanner variant="danger" icon={<AlertCircle className="h-5 w-5" aria-hidden="true" />}>
          {t('error.loadFailed', 'Failed to load data')}: {getErrorMessage(vehiclesError)}
        </AlertBanner>
      )}
      {/* Independent summary source: unknown never masquerades as a zero. */}
      <FadeIn>
        <OperationalBrief compact testId="timeline-summary"
          eyebrow={t('timeline.title', 'Timeline')}
          title={t('timeline.kpis', 'Summary metrics')}
          description={t('timeline.summary.provenance', 'Vehicle FSM summary for the requested window; continuous observation coverage is unknown')}
          statusLabel={summarySource.available
            ? summarySource.error ? t('timeline.brief.retained', 'Retained state summary')
              : summarySource.paused ? t('timeline.brief.pausedRetained', 'State summary refresh paused')
                : t('timeline.brief.available', 'Returned state summary')
            : summarySource.paused ? t('timeline.brief.paused', 'State summary paused')
              : summarySource.loading ? t('timeline.brief.loading', 'Loading state summary')
                : t('timeline.brief.unavailable', 'State summary unavailable')}
          statusTone={summarySource.error || summarySource.paused ? 'warning' : 'neutral'}
          metrics={summaryOperationalMetrics}
          scope={summaryPeriod.label}
          provenance={summaryPeriod.provenance}
          loading={summarySource.enabled && summarySource.loading && !summarySource.paused && !summarySource.available}
        />
        {(!summarySource.available && (!summarySource.loading || summarySource.paused)
          || summarySource.available && (summarySource.error || summarySource.paused)) && (
          <TimelineSource source={summarySource} label={t('timeline.kpis', 'Summary metrics')}>{null}</TimelineSource>
        )}
      </FadeIn>

      {/* State timeline bar — proportional state distribution from summary */}
      <FadeIn delay={0.1}>
        <CardGrid label={t('timeline.stateTimeline', 'State distribution')} items={[{
          id: 'timeline-state-distribution',
          size: 'full',
          content: <LayoutCard title={t('timeline.stateTimeline', 'State distribution')}>
            <TimelineSource source={distributionSource} label={t('timeline.stateTimeline', 'State distribution')}>
          {summaryRows.length === 0 || totalSeconds === 0 ? (
              <EmptyState /* no-action: transient empty state — surfaces when no recent state activity exists for the vehicle */
                icon={<Clock className="h-8 w-8" />}
                message={t('timeline.noStateData', 'No state distribution available yet')}
              />
          ) : summaryRows.some((row) =>
            !Number.isFinite(row.total_seconds)
            || (totalSeconds > 0 && (row.total_seconds < 0 || row.total_seconds > totalSeconds))
          ) ? (
            <div className="space-y-3">
              <Text variant="bodySm">
                {t('timeline.invalidComposition', 'Proportional track unavailable for the returned dwell totals; individual state evidence remains visible.')}
              </Text>
              <ul className="flex list-none flex-wrap gap-x-5 gap-y-2 p-0">
                {summaryRows.map((row, index) => (
                  <li key={`${row.state}:${index}`} className="min-w-0 break-words">
                    <Text variant="bodySm" className="block">{row.state}</Text>
                    <Text variant="caption" className="block">
                      {Number.isFinite(row.total_seconds) && row.total_seconds >= 0
                        ? formatDurationFromSeconds(row.total_seconds)
                        : '—'} ({fmtPercent(row.percentage)})
                    </Text>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <CompositionRail
              size="lg"
              summary={t('timeline.stateTimeline', 'State distribution')}
              segments={summaryRows.map((row, index) => {
                const pct = totalSeconds > 0
                  ? (row.total_seconds / totalSeconds) * 100
                  : 0;
                return {
                  id: `${row.state}:${index}`,
                  label: row.state,
                  widthPercent: pct,
                  hideFromTrack: pct < 0.3,
                  color: STATE_COLORS[row.state] ?? STATE_COLORS.offline,
                  detail: `${formatDurationFromSeconds(row.total_seconds)} (${fmtPercent(row.percentage)})`,
                };
              })}
            />
          )}
            </TimelineSource>
          <div className="mt-3 flex flex-wrap gap-3">
            {Object.entries(STATE_COLORS).map(([state, color]) => (
              <div key={state} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <Text variant="bodySm">
                  {state}
                </Text>
              </div>
            ))}
          </div>
          </LayoutCard>,
        }]} />
      </FadeIn>

      {/* Daily breakdown — stacked transition counts per day, grouped
          into the four high-level state buckets shown in the legend. */}
      <FadeIn delay={0.2}>
        <CardGrid label={t('timeline.dailyBreakdown', 'Daily breakdown')} items={[{
          id: 'timeline-daily-breakdown',
          size: 'full',
          content: <ChartCard
              title={t('timeline.dailyBreakdown', 'Daily breakdown')}
              subtitle={t('timeline.daily.utcNote', 'Transition counts grouped by UTC day; state durations come from the summary')}
              ariaLabel={t('timeline.dailyBreakdownAria', 'Daily transition counts by vehicle state')}
              loading={enabled && tlLoading && !timelineSource.available && !timelineSource.paused}
              error={!timelineSource.available ? timelineError : undefined}
              empty={dailyBreakdown.length === 0}
              emptyIcon={<BarChart3 className="h-8 w-8" aria-hidden="true" />}
              emptyMessage={!enabled
                ? t('timeline.source.selectVehicle', 'Select a vehicle to view its state history')
                : !timelineSource.available && timelineSource.paused
                  ? t('timeline.source.paused', '{{section}} is paused while the connection is unavailable', { section: t('timeline.dailyBreakdown', 'Daily breakdown') })
                  : !timelineSource.available && !tlLoading && !timelineError
                    ? t('timeline.source.unknown', '{{section}} is unavailable because the response did not contain the expected records', { section: t('timeline.dailyBreakdown', 'Daily breakdown') })
                    : t('timeline.noDailyData', 'No daily transition activity yet')}
              footer={timelineSource.available && (timelineSource.error || timelineSource.paused)
                ? <TimelineSource source={timelineSource} label={t('timeline.dailyBreakdown', 'Daily breakdown')}>{null}</TimelineSource>
                : timelineError
                  ? <Text as="p" variant="bodySm">{getErrorMessage(timelineError)}</Text>
                : undefined}
              data={dailyBreakdown}
              dataColumns={[
                { key: 'day', label: t('timeline.day', 'Day') },
                { key: 'driving', label: t('timeline.driving', 'Driving') },
                { key: 'charging', label: t('timeline.charging', 'Charging') },
                { key: 'idle', label: t('timeline.idle', 'Idle') },
                { key: 'sleeping', label: t('timeline.sleeping', 'Sleeping') },
              ]}
              chartKey="timeline-daily-breakdown"
            >
              {({ hiddenSeries }) => (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dailyBreakdown}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                    <XAxis dataKey="day" minTickGap={64} interval="preserveStartEnd" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                    <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} allowDecimals={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <ChartLegend />
                    <Bar dataKey="driving" name={t('timeline.driving', 'Driving')} stackId="a" fill={STATE_COLORS.driving} fillOpacity={0.85} hide={hiddenSeries?.isHidden('driving')} />
                    <Bar dataKey="charging" name={t('timeline.charging', 'Charging')} stackId="a" fill={STATE_COLORS.charging} fillOpacity={0.85} hide={hiddenSeries?.isHidden('charging')} />
                    <Bar dataKey="idle" name={t('timeline.idle', 'Idle')} stackId="a" fill={STATE_COLORS.idle} fillOpacity={0.85} hide={hiddenSeries?.isHidden('idle')} />
                    <Bar dataKey="sleeping" name={t('timeline.sleeping', 'Sleeping')} stackId="a" fill={STATE_COLORS.sleeping} fillOpacity={0.85} radius={[4, 4, 0, 0]} hide={hiddenSeries?.isHidden('sleeping')} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>,
        }]} />
      </FadeIn>

        {/* Keep the independent dwell-time source full-width rather than pairing
            a variable-length list with the bounded chart plot. */}
      <FadeIn delay={0.25}>
        <CardGrid label={t('timeline.timeByState', 'Time by state')} items={[{
          id: 'timeline-time-by-state',
          size: 'full',
          content: <LayoutCard title={t('timeline.timeByState', 'Time by state')}>
            <TimelineSource source={summarySource} label={t('timeline.timeByState', 'Time by state')}>
          {timeByState.length === 0 ? (
              <EmptyState /* no-action: transient — no dwell data in the window */
                icon={<Clock className="h-8 w-8" />}
                message={t('timeline.noStateData', 'No state distribution available yet')}
              />
          ) : (
            <div className="space-y-3">
              {timeByState.map((row) => (
                <MetricBar
                  key={row.state}
                  label={row.state.charAt(0).toUpperCase() + row.state.slice(1)}
                  value={row.total_seconds}
                  max={totalSeconds || row.total_seconds}
                  color={row.color}
                  sublabel={`${formatDurationFromSeconds(row.total_seconds)} · ${fmtPercent(row.percentage)}`}
                />
              ))}
            </div>
          )}
            </TimelineSource>
          </LayoutCard>,
        }]} />
      </FadeIn>

      {/* State transitions table — full-width detail band */}
      <FadeIn delay={0.3}>
        <CardGrid label={t('timeline.stateTransitions', 'State transitions')} items={[{
          id: 'timeline-state-transitions',
          size: 'full',
          content: <LayoutCard title={t('timeline.stateTransitions', 'State transitions')}>
            <TimelineSource source={timelineSource} label={t('timeline.stateTransitions', 'State transitions')}>
          <DataTable
            variant="embedded"
            name={t('timeline.stateTransitions', 'State transitions')}
            enableValueFilters
            tableId="analytics:timeline-transitions"
            columns={columns}
            mobileColumns={['ts', 'from_state', 'to_state']}
            data={transitions}
            keyExtractor={(row) => row.index}
            emptyMessage={t('timeline.noTransitions', 'No state transitions recorded')}
            pagination
            mobilePresentation={{
              roles: {
                ts: 'title', to_state: 'badge', from_state: 'meta',
                duration: 'primary', trigger_field: 'meta', actions: 'hidden',
              },
              displayValue: (row, key) => {
                if (key === 'ts') return formatDateTime(row.ts);
                if (key === 'from_state') return row.from_state ?? '—';
                if (key === 'to_state') return row.to_state;
                if (key === 'duration') return transitionDuration(row);
                if (key === 'trigger_field') return row.trigger_field ?? '—';
                return null;
              },
              onOpenRow: (row) => setPreviewTransition(row),
              inlineActions: (row) => <Button
                type="button" variant="ghost" size="sm" className="min-h-11"
                aria-label={t('timeline.inspectTransition', 'Inspect transition {{from}} to {{to}}', { from: row.from_state ?? '—', to: row.to_state })}
                onClick={() => setPreviewTransition(row)}
              >{t('timeline.inspect', 'Inspect')}</Button>,
              allDetails: (row) => [
                // Existing columns supply every other field in shared Quick view.
                { key: 'trigger_value', label: t('timeline.preview.triggerValue', 'Trigger value'), value: row.trigger_value ?? '—' },
              ],
            }}
          />
            </TimelineSource>
          </LayoutCard>,
        }]} />
      </FadeIn>

      <EntityPreviewDrawer
        open={previewTransition !== null}
        onClose={() => setPreviewTransition(null)}
        eyebrow={t('timeline.preview.eyebrow', 'State transition')}
        title={
          previewTransition
            ? t(
                'timeline.preview.title',
                '{{from}} → {{to}}',
                {
                  from: previewTransition.from_state ?? '—',
                  to: previewTransition.to_state,
                },
              )
            : t('timeline.preview.fallbackTitle', 'Transition details')
        }
        description={
          previewTransition
            ? t(
                'timeline.preview.description',
                'Recorded {{time}}',
                { time: formatDateTime(previewTransition.ts) },
              )
            : undefined
        }
        statusLabel={previewTransition?.to_state}
        statusTone={
          previewTransition
            ? STATE_BADGE[previewTransition.to_state] ?? 'neutral'
            : 'neutral'
        }
        fields={
          previewTransition
            ? [
                {
                  key: 'from-state',
                  label: t('timeline.fromState', 'From state'),
                  value: previewTransition.from_state ?? '—',
                },
                {
                  key: 'to-state',
                  label: t('timeline.toState', 'To state'),
                  value: previewTransition.to_state,
                },
                {
                  key: 'duration',
                  label: t('timeline.duration', 'Duration'),
                  value: transitionDuration(previewTransition),
                },
                {
                  key: 'trigger-field',
                  label: t('timeline.preview.triggerField', 'Trigger field'),
                  value: previewTransition.trigger_field ?? '—',
                },
                {
                  key: 'trigger-value',
                  label: t('timeline.preview.triggerValue', 'Trigger value'),
                  value: previewTransition.trigger_value ?? '—',
                },
              ]
            : []
        }
        relatedActions={
          previewTransition && vehicleId != null
            ? [
                {
                  key: 'vehicle',
                  label: t('entityContext.vehicle', 'Vehicle'),
                  to: `/vehicles/${vehicleId}`,
                  icon: <Car className="h-4 w-4" aria-hidden="true" />,
                },
                {
                  key: 'drives',
                  label: t('entityContext.drives', 'Drive history'),
                  to: buildContextHref('/drives', {
                    from: previewDay,
                    to: previewDay,
                  }),
                  icon: <Route className="h-4 w-4" aria-hidden="true" />,
                },
                {
                  key: 'charging',
                  label: t('entityContext.charging', 'Charging sessions'),
                  to: buildContextHref('/charging', {
                    from: previewDay,
                    to: previewDay,
                  }),
                  icon: <BatteryCharging className="h-4 w-4" aria-hidden="true" />,
                },
                {
                  key: 'locations',
                  label: t('entityContext.locations', 'Visited locations'),
                  to: buildContextHref('/locations', {
                    from: previewDay,
                    to: previewDay,
                  }),
                  icon: <MapPin className="h-4 w-4" aria-hidden="true" />,
                },
                {
                  key: 'alerts',
                  label: t('entityContext.alerts', 'Alerts'),
                  to: buildContextHref('/notifications/inbox', {
                    from: previewDay,
                    to: previewDay,
                  }),
                  icon: <Bell className="h-4 w-4" aria-hidden="true" />,
                },
                {
                  key: 'service',
                  label: t('entityContext.service', 'Service history'),
                  to: '/maintenance',
                  icon: <Wrench className="h-4 w-4" aria-hidden="true" />,
                },
                {
                  key: 'telemetry',
                  label: t('entityContext.telemetry', 'Telemetry evidence'),
                  to: buildContextHref('/signals', {
                    from: previewDay,
                    to: previewDay,
                    signals: previewTransition.trigger_field
                      ? [previewTransition.trigger_field]
                      : [],
                  }),
                  icon: <Activity className="h-4 w-4" aria-hidden="true" />,
                },
              ]
            : []
        }
      />
    </PageLayout>
  );
}
