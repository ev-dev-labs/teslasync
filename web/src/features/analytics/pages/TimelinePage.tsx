import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  Clock, ArrowRightLeft, Car, BatteryCharging, Moon, RefreshCw, AlertCircle,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, Badge, Button, Select, DataTable, type Column } from '@/components/ui';
import { MetricCard, DataFreshnessAuto } from '@/components/data-display';
import { Skeleton, EmptyState, AlertBanner } from '@/components/feedback';
import { FadeIn } from '@/components/motion';

import { useVehicles } from '@/api/hooks/useVehicles';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useUrlString } from '@/hooks/useUrlState';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtInt } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import { getErrorMessage } from '@/lib/errorMessage';
import { request } from '@/api/client';

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

/** Indexed transition row for the table. */
interface TransitionRow extends TransitionRecord {
  index: number;
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
  const minutes = seconds / 60;
  const hours = minutes / 60;
  const h = Math.floor(hours);
  const m = (hours - h) * 60;
  if (h === 0) return `${fmtInt(m)}m`;
  return m >= 0.5 ? `${h}h ${fmtInt(m)}m` : `${h}h`;
}

function formatDurationFromSeconds(seconds: number): string {
  if (seconds < 60) return `${fmtInt(seconds)}s`;
  return formatHoursFromSeconds(seconds);
}

/* ─── Component ──────────────────────────────────────────── */

export default function TimelinePage() {
  const { t } = useTranslation();
  usePageTitle(t('timeline.title', 'Timeline'));
  // Phase 40 / Prompt 33 — vehicle id is in the URL so deep links work.
  const [vehicleId, setVehicleId] = useUrlString('vehicle_id', '');

  const { data: vehicles, error: vehiclesError } = useVehicles();

  const activeId = vehicleId || String(vehicles?.[0]?.id ?? '');
  const enabled = activeId !== '';

  const timelineQuery = useQuery({
    queryKey: ['vehicle-timeline', activeId],
    queryFn: () =>
      request<{ transitions: TransitionRecord[] }>(
        `/vehicle-states/timeline?vehicle_id=${activeId}`,
      ),
    enabled,
  });
  const { data: timelineData, isLoading: tlLoading, error: timelineError, refetch } = timelineQuery;

  const { data: summaryData, isLoading: sumLoading, error: summaryError } = useQuery({
    queryKey: ['vehicle-summary', activeId],
    queryFn: () =>
      request<SummaryResponse>(
        `/vehicle-states/summary?vehicle_id=${activeId}`,
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

  // Indexed transition rows for the table
  const transitions = useMemo<TransitionRow[]>(
    () => transitionsRaw.map((rec, i) => ({ index: i, ...rec })),
    [transitionsRaw],
  );

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
          <span className="text-sm">{formatDateTime(row.ts)}</span>
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
        key: 'trigger_field',
        header: t('timeline.trigger', 'Trigger'),
        sortable: true,
        render: (row) => (
          <span className="text-xs text-[var(--text-secondary)]">
            {row.trigger_field ?? '—'}
          </span>
        ),
      },
    ],
    [t],
  );

  /* ─── Actions (vehicle selector + refresh) ─── */

  const vehicleOptions = (vehicles ?? []).map((v) => ({
    value: String(v.id),
    label: v.display_name || v.vin,
  }));

  const actions = (
    <div className="flex items-center gap-3">
      <DataFreshnessAuto query={timelineQuery} />
      {vehicleOptions.length > 1 && (
        <Select
          options={vehicleOptions}
          value={activeId}
          onChange={(e) => setVehicleId(e.target.value)}
          placeholder={t('timeline.selectVehicle', 'Select Vehicle')}
        />
      )}
      <Button variant="ghost" onClick={() => refetch()}>
        <RefreshCw className="h-4 w-4" />
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

      {/* Summary metric cards */}
      <FadeIn>
        <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
        </div>
      </FadeIn>

      {/* State timeline bar — proportional state distribution from summary */}
      <FadeIn delay={0.1}>
        <GlassPanel className="mb-6 p-4">
          <p className="mb-3 text-sm font-semibold text-[var(--text-primary)]">
            {t('timeline.stateTimeline', 'State Distribution')}
          </p>
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
                    title={`${row.state}: ${formatDurationFromSeconds(row.total_seconds)} (${row.percentage.toFixed(1)}%)`}
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
                <span className="text-xs capitalize text-[var(--text-secondary)]">
                  {state}
                </span>
              </div>
            ))}
          </div>
        </GlassPanel>
      </FadeIn>

      {/* State transitions table */}
      <FadeIn delay={0.3}>
        <GlassPanel className="p-4">
          <p className="mb-3 text-sm font-semibold text-[var(--text-primary)]">
            {t('timeline.stateTransitions', 'State Transitions')}
          </p>
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
    </PageContainer>
  );
}
