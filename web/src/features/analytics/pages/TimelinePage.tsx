import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  Clock, ArrowRightLeft, Car, BatteryCharging, Moon, RefreshCw, AlertCircle,
  Activity, BarChart3, Bell, MapPin, Route, Wrench,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, Badge, Button, Select, DataTable, PanelTitle, Text, Caption, type Column } from '@/components/ui';
import { RangePicker } from '@/components/forms';
import { useRangeState } from '@/hooks/useRangeState';
import {
  DataFreshnessAuto,
  EntityPreviewDrawer,
  MetricBar,
  MetricCard,
} from '@/components/data-display';
import { Skeleton, EmptyState, AlertBanner } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ChartTooltip,
} from '@/components/charts';

import { useVehicles } from '@/api/hooks/useVehicles';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtPercent } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import { getErrorMessage } from '@/lib/errorMessage';
import { request } from '@/api/client';
import { buildContextHref } from '@/lib/contextNavigation';
import { localDayKey } from '@/lib/drivesAggregation';

/* ─── Types matching actual API responses ────────────────── */

/** GET /vehicle-states/timeline → { vehicle_id, days, transitions: TransitionRecord[] }.
 *  Each record is a single FSM transition event — point-in-time, NOT a state with
 *  duration. To compute "time spent in state X" we use the summary endpoint instead. */
interface TransitionRecord {
  ts: string;
  from_state: string;
  to_state: string;
  trigger_field: string | null;
  trigger_value: string | null;
}

/** Indexed transition row for the table. Adds the timestamp of the
 *  *next* transition so the table can compute "duration spent in
 *  to_state" without extra hooks. The newest row has no successor —
 *  its duration is computed from `now` so the user sees how long the
 *  vehicle has been in the current state. */
interface TransitionRow extends TransitionRecord {
  index: number;
  next_ts: string | null;
}

/** GET /vehicle-states/summary → { vehicle_id, days, total_seconds, by_state: ByStateRow[] }. */
interface ByStateRow {
  state: string;
  total_seconds: number;
  percentage: number;
  transition_count: number;
}

interface SummaryResponse {
  vehicle_id: number;
  days: number;
  total_seconds: number;
  by_state: ByStateRow[];
}

/* ─── Constants ──────────────────────────────────────────── */

const STATE_COLORS: Record<string, string> = {
  driving: '#10b981',
  charging: '#00f0ff',
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
  const { t } = useTranslation();
  usePageTitle(t('timeline.title', 'Timeline'));

  // Vehicle selection is global, persistent, URL-aware, and bookmarkable.
  const { vehicleId, vehicles, setVehicleId } = useSelectedVehicle();
  const activeId = vehicleId != null ? String(vehicleId) : '';
  const enabled = activeId !== '';

  const onPickVehicle = (id: string) => {
    const n = Number(id);
    if (Number.isFinite(n) && n > 0) {
      setVehicleId(n);
    }
  };

  const { start, end, setRange } = useRangeState({
    persistKey: 'timeline.range',
    defaultPresetId: '7d',
  });
  const [previewTransition, setPreviewTransition] = useState<TransitionRow | null>(null);
  const previewDay = localDayKey(previewTransition?.ts);

  // Backend accepts `?days=N` (trailing window). Compute inclusive day
  // count from the picker's range. Custom historical windows that don't
  // end today still degrade to a trailing window — `presetsOnly` mode
  // hides the calendar to keep the UX honest.
  const days = useMemo(() => {
    const startMs = new Date(`${start}T00:00:00`).getTime();
    const endMs = new Date(`${end}T00:00:00`).getTime();
    // useRangeState always yields valid ISO dates, but guard anyway so a
    // malformed range never sends `days=NaN` to the API.
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) return 7;
    return Math.max(1, Math.round((endMs - startMs) / 86_400_000) + 1);
  }, [start, end]);

  const { error: vehiclesError } = useVehicles();

  const timelineQuery = useQuery({
    queryKey: ['vehicle-timeline', activeId, days],
    queryFn: () =>
      request<{ transitions: TransitionRecord[] }>(
        `/vehicle-states/timeline?vehicle_id=${activeId}&days=${days}`,
      ),
    enabled,
  });
  const { data: timelineData, isLoading: tlLoading, error: timelineError, refetch } = timelineQuery;

  const { data: summaryData, isLoading: sumLoading, error: summaryError } = useQuery({
    queryKey: ['vehicle-summary', activeId, days],
    queryFn: () =>
      request<SummaryResponse>(
        `/vehicle-states/summary?vehicle_id=${activeId}&days=${days}`,
      ),
    enabled,
  });

  /* Defensive coercion — even with TanStack handling network errors, an
   * unexpected response shape (e.g. backend returns an array, or an error
   * envelope object) would otherwise crash with "X is not iterable" inside
   * the for/of loops below. */
  const transitionsRaw = Array.isArray(timelineData?.transitions)
    ? (timelineData!.transitions as TransitionRecord[])
    : [];
  const summaryRows: ByStateRow[] = Array.isArray(summaryData?.by_state)
    ? (summaryData!.by_state as ByStateRow[])
    : [];
  const totalSeconds = summaryData?.total_seconds ?? 0;

  const anyError = [vehiclesError, timelineError, summaryError].find(Boolean);
  const isLoading = tlLoading || sumLoading;

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
        header: t('timeline.fromState', 'From State'),
        sortable: true,
        render: (row) => (
          <Badge variant={STATE_BADGE[row.from_state] ?? 'neutral'} size="sm">
            {row.from_state}
          </Badge>
        ),
      },
      {
        key: 'to_state',
        header: t('timeline.toState', 'To State'),
        sortable: true,
        render: (row) => (
          <Badge variant={STATE_BADGE[row.to_state] ?? 'neutral'} size="sm">
            {row.to_state}
          </Badge>
        ),
      },
      {
        key: 'duration',
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
            aria-label={t(
              'timeline.inspectTransition',
              'Inspect transition {{from}} to {{to}}',
              { from: row.from_state, to: row.to_state },
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

  /* ─── Actions (vehicle selector + refresh) ─── */

  const vehicleOptions = useMemo(
    () =>
      vehicles.map((v) => ({
        value: String(v.id),
        label: v.display_name || v.vin,
      })),
    [vehicles],
  );

  const actions = (
    <div className="flex items-center gap-3">
      {vehicles.length > 0 && (
        <Select
          options={vehicleOptions}
          value={activeId}
          onChange={(e) => onPickVehicle(e.target.value)}
          placeholder={t('timeline.selectVehicle', 'Select Vehicle')}
          aria-label={t('timeline.selectVehicle', 'Select Vehicle')}
        />
      )}
      <RangePicker
        value={{ start, end }}
        onChange={(r) => setRange(r)}
        presetIds={['today', 'yesterday', '7d', '30d', '90d', 'mtd', 'ytd']}
        presetsOnly
        align="end"
        triggerTestId="timeline-range"
      />
      <DataFreshnessAuto query={timelineQuery} />
      <Button
        variant="ghost"
        onClick={() => refetch()}
        aria-label={t('timeline.refresh', 'Refresh timeline')}
      >
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );

  return (
    <PageContainer
      title={t('timeline.title', 'Timeline')}
      subtitle={t('timeline.subtitle', 'Vehicle state history and transitions')}
      actions={actions}
      loading={isLoading && transitions.length === 0}
    >
      {anyError && (
        <AlertBanner variant="danger" icon={<AlertCircle className="h-5 w-5" />}>
          {t('error.loadFailed', 'Failed to load data')}: {getErrorMessage(anyError)}
        </AlertBanner>
      )}

      {/* Summary metric cards — full-width KPI band */}
      <FadeIn>
        <section aria-label={t('timeline.kpis', 'Summary metrics')} className="mb-4 grid grid-cols-2 gap-4 sm:mb-6 lg:grid-cols-4">
          <MetricCard
            label={t('timeline.totalTransitions', 'Total Transitions')}
            value={totalTransitions}
            icon={<ArrowRightLeft className="h-5 w-5" />}
          />
          <MetricCard
            label={t('timeline.drivingTime', 'Driving Time')}
            value={formatHoursFromSeconds(drivingSec)}
            icon={<Car className="h-5 w-5" />}
            color="green"
          />
          <MetricCard
            label={t('timeline.chargingTime', 'Charging Time')}
            value={formatHoursFromSeconds(chargingSec)}
            icon={<BatteryCharging className="h-5 w-5" />}
            color="cyan"
          />
          <MetricCard
            label={t('timeline.idleSleepTime', 'Idle / Sleep Time')}
            value={formatHoursFromSeconds(idleSec + sleepingSec)}
            icon={<Moon className="h-5 w-5" />}
          />
        </section>
      </FadeIn>

      {/* State timeline bar — proportional state distribution from summary */}
      <FadeIn delay={0.1}>
        <GlassPanel className="mb-4 p-4 sm:mb-6 sm:p-5">
          <PanelTitle className="mb-3">
            {t('timeline.stateTimeline', 'State Distribution')}
          </PanelTitle>
          {summaryRows.length === 0 || totalSeconds === 0 ? (
            sumLoading ? (
              <Skeleton height={32} />
            ) : (
              <EmptyState /* no-action: transient empty state — surfaces when no recent state activity exists for the vehicle */
                icon={<Clock className="h-8 w-8" />}
                message={t('timeline.noStateData', 'No state distribution available yet')}
              />
            )
          ) : (
            <div className="flex h-8 overflow-hidden rounded-full">
              {summaryRows.map((row) => {
                const pct = totalSeconds > 0
                  ? (row.total_seconds / totalSeconds) * 100
                  : 0;
                if (pct < 0.3) return null;
                return (
                  <div
                    key={row.state}
                    className={cn('relative transition-all')}
                    style={{
                      width: `${pct}%`,
                      backgroundColor:
                        STATE_COLORS[row.state] ?? STATE_COLORS.offline,
                    }}
                    title={`${row.state}: ${formatDurationFromSeconds(row.total_seconds)} (${fmtPercent(row.percentage, 1)})`}
                  />
                );
              })}
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-3">
            {Object.entries(STATE_COLORS).map(([state, color]) => (
              <div key={state} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <Text variant="bodySm" className="capitalize">
                  {state}
                </Text>
              </div>
            ))}
          </div>
        </GlassPanel>
      </FadeIn>

      {/* Daily breakdown — stacked transition counts per day, grouped
          into the four high-level state buckets shown in the legend. */}
      <FadeIn delay={0.2}>
        <section className="mb-4 grid grid-cols-1 gap-4 sm:mb-6 xl:grid-cols-3">
        <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('timeline.dailyBreakdown', 'Daily Breakdown')}
          </PanelTitle>
          {dailyBreakdown.length === 0 ? (
            tlLoading ? (
              <Skeleton height={220} />
            ) : (
              <EmptyState /* no-action: transient empty state — surfaces when no transitions exist in the lookback window */
                icon={<BarChart3 className="h-8 w-8" />}
                message={t('timeline.noDailyData', 'No daily transition activity yet')}
              />
            )
          ) : (
            <div className="h-56 sm:h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dailyBreakdown}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                  <XAxis dataKey="day" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                  <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="driving" name={t('timeline.driving', 'Driving')} stackId="a" fill={STATE_COLORS.driving} fillOpacity={0.85} />
                  <Bar dataKey="charging" name={t('timeline.charging', 'Charging')} stackId="a" fill={STATE_COLORS.charging} fillOpacity={0.85} />
                  <Bar dataKey="idle" name={t('timeline.idle', 'Idle')} stackId="a" fill={STATE_COLORS.idle} fillOpacity={0.85} />
                  <Bar dataKey="sleeping" name={t('timeline.sleeping', 'Sleeping')} stackId="a" fill={STATE_COLORS.sleeping} fillOpacity={0.85} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </GlassPanel>

        {/* Time-by-state — dwell time per FSM state, derived from the same
            summary payload; fills the width beside the daily chart on wide screens. */}
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <Clock className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('timeline.timeByState', 'Time by State')}
          </PanelTitle>
          {timeByState.length === 0 ? (
            sumLoading ? (
              <Skeleton height={220} />
            ) : (
              <EmptyState /* no-action: transient — no dwell data in the window */
                icon={<Clock className="h-8 w-8" />}
                message={t('timeline.noStateData', 'No state distribution available yet')}
              />
            )
          ) : (
            <div className="space-y-3">
              {timeByState.map((row) => (
                <MetricBar
                  key={row.state}
                  label={row.state.charAt(0).toUpperCase() + row.state.slice(1)}
                  value={row.total_seconds}
                  max={totalSeconds || row.total_seconds}
                  color={row.color}
                  sublabel={`${formatDurationFromSeconds(row.total_seconds)} · ${fmtPercent(row.percentage, 1)}`}
                />
              ))}
            </div>
          )}
        </GlassPanel>
        </section>
      </FadeIn>

      {/* State transitions table — full-width detail band */}
      <FadeIn delay={0.3}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3">
            {t('timeline.stateTransitions', 'State Transitions')}
          </PanelTitle>
          <DataTable
            tableId="analytics:timeline-transitions"
            columns={columns}
            data={transitions}
            keyExtractor={(row) => row.index}
            emptyMessage={t('timeline.noTransitions', 'No state transitions recorded')}
            pagination
          />
        </GlassPanel>
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
                  from: previewTransition.from_state,
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
                  label: t('timeline.fromState', 'From State'),
                  value: previewTransition.from_state,
                },
                {
                  key: 'to-state',
                  label: t('timeline.toState', 'To State'),
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
                  to: buildContextHref('/notifications/alerts', {
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
    </PageContainer>
  );
}
