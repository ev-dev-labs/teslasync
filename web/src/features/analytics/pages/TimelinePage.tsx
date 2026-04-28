import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  Clock, ArrowRightLeft, Car, BatteryCharging, Moon, RefreshCw, AlertCircle,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, Badge, Button, Select, DataTable, type Column } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { Skeleton, EmptyState, AlertBanner } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import {
  ChartTooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from '@/components/charts';

import { useVehicles } from '@/api/hooks/useVehicles';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDateTime, formatDurationSecondsAsMinutes } from '@/lib/dateFormat';
import { fmtInt } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import { getErrorMessage } from '@/lib/errorMessage';
import { request } from '@/api/client';

/* ─── Types matching actual API responses ────────────────── */

/** GET /vehicle-states/timeline → { transitions: StateRecord[] } */
interface StateRecord {
  state: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number;
}

/** Derived row for the transitions table (computed from consecutive StateRecords) */
interface TransitionRow {
  index: number;
  from_state: string;
  to_state: string;
  timestamp: string;
  duration_seconds: number;
}

/** GET /vehicle-states/summary → StateSummaryRow[] */
interface StateSummaryRow {
  state: string;
  count: number;
  total_min: number;
}

/** GET /vehicle-states/daily → DailyRow[] (one row per state per day) */
interface DailyRow {
  day: string;
  state: string;
  total_min: number;
}

/** Pivoted daily breakdown for stacked chart */
interface DailyPivoted {
  date: string;
  driving_hours: number;
  charging_hours: number;
  idle_hours: number;
  sleeping_hours: number;
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

function formatHours(minutes: number): string {
  const hours = minutes / 60;
  const h = Math.floor(hours);
  const m = (hours - h) * 60;
  if (h === 0) return `${fmtInt(m)}m`;
  return m >= 0.5 ? `${h}h ${fmtInt(m)}m` : `${h}h`;
}

/** Pivot per-state-per-day rows into one row per day with columns per state */
function pivotDaily(rows: DailyRow[]): DailyPivoted[] {
  const byDay = new Map<string, DailyPivoted>();
  for (const r of rows) {
    let entry = byDay.get(r.day);
    if (!entry) {
      entry = { date: r.day, driving_hours: 0, charging_hours: 0, idle_hours: 0, sleeping_hours: 0 };
      byDay.set(r.day, entry);
    }
    const hours = r.total_min / 60;
    switch (r.state) {
      case 'driving': entry.driving_hours += hours; break;
      case 'charging': entry.charging_hours += hours; break;
      case 'online': case 'parked': case 'idle': entry.idle_hours += hours; break;
      case 'asleep': case 'sleeping': case 'offline': entry.sleeping_hours += hours; break;
    }
  }
  return Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date));
}

/* ─── Component ──────────────────────────────────────────── */

export default function TimelinePage() {
  const { t } = useTranslation();
  usePageTitle(t('timeline.title', 'Timeline'));
  const [vehicleId, setVehicleId] = useState('');

  const { data: vehicles, error: vehiclesError } = useVehicles();

  const activeId = vehicleId || String(vehicles?.[0]?.id ?? '');
  const enabled = activeId !== '';

  const { data: timelineData, isLoading: tlLoading, error: timelineError, refetch } = useQuery({
    queryKey: ['vehicle-timeline', activeId],
    queryFn: () =>
      request<{ transitions: StateRecord[] }>(
        `/vehicle-states/timeline?vehicle_id=${activeId}`,
      ),
    enabled,
  });

  const { data: summaryData, isLoading: sumLoading, error: summaryError } = useQuery({
    queryKey: ['vehicle-summary', activeId],
    queryFn: () =>
      request<StateSummaryRow[]>(
        `/vehicle-states/summary?vehicle_id=${activeId}`,
      ),
    enabled,
  });

  const { data: dailyData, isLoading: dayLoading, error: dailyError } = useQuery({
    queryKey: ['vehicle-daily', activeId],
    queryFn: () => request<DailyRow[]>(`/vehicle-states/daily?vehicle_id=${activeId}`),
    enabled,
  });

  const stateRecords = timelineData?.transitions ?? [];
  const summaryRows = summaryData ?? [];
  const daily = useMemo(() => pivotDaily(dailyData ?? []), [dailyData]);
  const anyError = [vehiclesError, timelineError, summaryError, dailyError].find(Boolean);
  const isLoading = tlLoading || sumLoading || dayLoading;

  // Derive transition rows from consecutive state records
  const transitions = useMemo<TransitionRow[]>(
    () =>
      stateRecords.map((rec, i, arr) => ({
        index: i,
        from_state: i > 0 ? arr[i - 1].state : '—',
        to_state: rec.state,
        timestamp: rec.started_at,
        duration_seconds: rec.duration_seconds,
      })),
    [stateRecords],
  );

  const totalDuration = useMemo(
    () => stateRecords.reduce((s, rec) => s + rec.duration_seconds, 0),
    [stateRecords],
  );

  // Derive summary metrics from the raw summary rows
  const summaryByState = useMemo(() => {
    const m: Record<string, { count: number; totalMin: number }> = {};
    for (const row of summaryRows) {
      m[row.state] = { count: row.count, totalMin: row.total_min };
    }
    return m;
  }, [summaryRows]);

  const totalTransitions = summaryRows.reduce((s, r) => s + r.count, 0);
  const drivingMin = summaryByState.driving?.totalMin ?? 0;
  const chargingMin = summaryByState.charging?.totalMin ?? 0;
  const idleMin = (summaryByState.online?.totalMin ?? 0) +
    (summaryByState.parked?.totalMin ?? 0) +
    (summaryByState.idle?.totalMin ?? 0);
  const sleepingMin = (summaryByState.asleep?.totalMin ?? 0) +
    (summaryByState.sleeping?.totalMin ?? 0) +
    (summaryByState.offline?.totalMin ?? 0);

  /* ─── Table columns ─── */

  const columns = useMemo<Column<TransitionRow>[]>(
    () => [
      {
        key: 'timestamp',
        header: t('timeline.time', 'Time'),
        sortable: true,
        render: (row) => (
          <span className="text-sm">{formatDateTime(row.timestamp)}</span>
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
        sortable: true,
        render: (row) => (
          <span className="text-sm font-medium">
            {formatDurationSecondsAsMinutes(row.duration_seconds)}
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
      loading={isLoading && stateRecords.length === 0}
    >
      {anyError && (
        <AlertBanner variant="danger" icon={<AlertCircle className="h-5 w-5" />}>
          {t('error.loadFailed', 'Failed to load data')}: {getErrorMessage(anyError)}
        </AlertBanner>
      )}

      {/* Summary metric cards */}
      <FadeIn>
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <MetricCard
            label={t('timeline.totalTransitions', 'Total Transitions')}
            value={totalTransitions}
            icon={<ArrowRightLeft className="h-5 w-5" />}
          />
          <MetricCard
            label={t('timeline.drivingTime', 'Driving Time')}
            value={formatHours(drivingMin)}
            icon={<Car className="h-5 w-5" />}
            color="green"
          />
          <MetricCard
            label={t('timeline.chargingTime', 'Charging Time')}
            value={formatHours(chargingMin)}
            icon={<BatteryCharging className="h-5 w-5" />}
            color="cyan"
          />
          <MetricCard
            label={t('timeline.idleSleepTime', 'Idle / Sleep Time')}
            value={formatHours(idleMin + sleepingMin)}
            icon={<Moon className="h-5 w-5" />}
          />
        </div>
      </FadeIn>

      {/* State timeline bar */}
      <FadeIn delay={0.1}>
        <GlassPanel className="mb-6 p-4">
          <p className="mb-3 text-sm font-semibold text-white/90">
            {t('timeline.stateTimeline', 'State Timeline')}
          </p>
          {stateRecords.length === 0 ? (
            <Skeleton height={32} />
          ) : (
            <div className="flex h-8 overflow-hidden rounded-full">
              {stateRecords.map((rec, i) => {
                const pct = totalDuration > 0
                  ? (rec.duration_seconds / totalDuration) * 100
                  : 0;
                if (pct < 0.3) return null;
                return (
                  <div
                    key={`${rec.started_at}-${i}`}
                    className={cn('relative transition-all')}
                    style={{
                      width: `${pct}%`,
                      backgroundColor:
                        STATE_COLORS[rec.state] ?? STATE_COLORS.offline,
                    }}
                    title={`${rec.state}: ${formatDurationSecondsAsMinutes(rec.duration_seconds)}`}
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
                <span className="text-xs capitalize text-white/50">
                  {state}
                </span>
              </div>
            ))}
          </div>
        </GlassPanel>
      </FadeIn>

      {/* Daily breakdown stacked chart */}
      <FadeIn delay={0.2}>
        <GlassPanel className="mb-6 p-4">
          <p className="mb-3 text-sm font-semibold text-white/90">
            {t('timeline.dailyBreakdown', 'Daily Breakdown')}
          </p>
          {dayLoading ? (
            <Skeleton height={280} />
          ) : daily.length === 0 ? (
            <EmptyState
              icon={<Clock className="h-8 w-8" />}
              message={t('timeline.noDailyData', 'No daily data available yet')}
            />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={daily}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(255,255,255,0.06)"
                  strokeOpacity={0.5}
                />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: 'rgba(255,255,255,0.5)' }}
                />
                <YAxis tick={{ fontSize: 11, fill: 'rgba(255,255,255,0.5)' }} />
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="driving_hours" stackId="s" fill={STATE_COLORS.driving} name={t('timeline.driving', 'Driving')} />
                <Bar dataKey="charging_hours" stackId="s" fill={STATE_COLORS.charging} name={t('timeline.charging', 'Charging')} />
                <Bar dataKey="idle_hours" stackId="s" fill={STATE_COLORS.idle ?? '#f59e0b'} name={t('timeline.idle', 'Idle')} />
                <Bar dataKey="sleeping_hours" stackId="s" fill={STATE_COLORS.sleeping ?? '#64748b'} name={t('timeline.sleeping', 'Sleeping')} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </GlassPanel>
      </FadeIn>

      {/* State transitions table */}
      <FadeIn delay={0.3}>
        <GlassPanel className="p-4">
          <p className="mb-3 text-sm font-semibold text-white/90">
            {t('timeline.stateTransitions', 'State Transitions')}
          </p>
          <DataTable
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
