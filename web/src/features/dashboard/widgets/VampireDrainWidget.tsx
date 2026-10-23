import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BatteryWarning } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { Badge } from '@/components/ui';
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  XAxis,
  type ChartDataRow,
} from '@/components/charts';
import { useVehicles } from '@/api/hooks/useVehicles';
import {
  useVampireDrainStats,
  useVampireDrainEvents,
  useVampireDrainWatch,
} from '@/api/hooks/useEnergy';
import { knownNumber } from '@/api/dataState';
import { safeArray } from '@/lib/safeArray';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDataState } from '@/hooks/useDataState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { STATUS_COLORS } from '@/lib/colors';
import { dashboardTokens } from '../lib/dashboardTokens';
import { fmtNumber as formatNumber } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber } from './shared';
import type { WidgetProps } from './types';

export type DrainStatus = 'normal' | 'elevated' | 'high';

export function getDrainStatus(rate: number | null | undefined): DrainStatus | null {
  if (rate == null || !Number.isFinite(rate)) return null;
  if (rate < 1) return 'normal';
  if (rate < 3) return 'elevated';
  return 'high';
}

export interface DrainBarPoint extends ChartDataRow {
  index: string;
  rate: number;
}

export function buildDrainBarData(
  events: {
    drain_pct_per_day?: number | null;
  }[],
): DrainBarPoint[] {
  return safeArray(events)
    .slice(-14)
    .reduce<DrainBarPoint[]>((points, event) => {
      const rate = knownNumber(event.drain_pct_per_day);
      if (rate != null) {
        points.push({ index: String(points.length + 1), rate });
      }
      return points;
    }, []);
}

export function drainColor(rate: number): string {
  const status = getDrainStatus(rate);
  if (status === 'normal') return STATUS_COLORS.good;
  if (status === 'elevated') return STATUS_COLORS.warning;
  if (status === 'high') return STATUS_COLORS.critical;
  return 'var(--text-muted)';
}

export function formatDuration(
  hours: number,
  t: (key: string, fallback: string) => string,
  format = formatNumber,
): string {
  if (!Number.isFinite(hours) || hours < 0) return '—';
  if (hours < 1) return `${format(hours * 60, 0)}${t('widget.vampireDrain.min', 'm')}`;
  return `${format(hours, 1)}${t('widget.vampireDrain.hr', 'h')}`;
}

export default function VampireDrainWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { fmtNumber } = useNumberFormatting();
  const { formatDate } = useDateFormat();
  const vehiclesQuery = useVehicles();
  const candidate = vehicleId ?? safeArray(vehiclesQuery.data)[0]?.id;
  const id = Number.isSafeInteger(candidate) && Number(candidate) > 0 ? candidate : null;
  const idStr = id == null ? null : String(id);

  const statsQuery = useVampireDrainStats(idStr);
  const eventsQuery = useVampireDrainEvents(idStr, 30);
  const watchQuery = useVampireDrainWatch(idStr);

  const stats = statsQuery.data;
  const events = useMemo(() => safeArray(eventsQuery.data), [eventsQuery.data]);
  const watch = watchQuery.data;
  const isCompact = size.cols <= 1;

  const average = knownNumber(stats?.avg_drain_pct_per_day);
  const measuredAverage =
    average != null && knownNumber(stats?.event_count) != null && (stats?.event_count ?? 0) > 0
      ? average
      : null;
  const bars = useMemo(() => buildDrainBarData(events), [events]);

  const highest = useMemo(() => {
    return events.reduce<{ rate: number; startedAt: string } | null>((best, event) => {
      const rate = knownNumber(event.drain_pct_per_day);
      if (rate == null) return best;
      if (best == null || rate > best.rate) {
        return { rate, startedAt: event.started_at };
      }
      return best;
    }, null);
  }, [events]);

  const discoveryState = useDataState(vehiclesQuery);
  const statsState = useDataState(
    { ...statsQuery, data: stats ?? null },
    { provenance: 'historical', unavailable: stats == null },
  );
  const eventsState = useDataState(
    { ...eventsQuery, data: events.length > 0 ? events : [] },
    { provenance: 'historical', unavailable: events.length === 0 },
  );
  const watchState = useDataState(watchQuery, { provenance: 'inferred', unavailable: !watch });
  const sourceStates =
    !id && vehicleId == null && discoveryState.status !== 'ok'
      ? [discoveryState]
      : [statsState, eventsState, watchState];

  const hasData =
    stats != null || measuredAverage != null || events.length > 0 || watch != null;
  const refresh = () => {
    if (vehicleId == null) void vehiclesQuery.refetch?.();
    if (id != null) {
      void statsQuery.refetch();
      void eventsQuery.refetch();
      void watchQuery.refetch();
    }
  };

  const status = getDrainStatus(measuredAverage);
  const statusText =
    status === null
      ? t('widget.vampireDrain.averageUnavailable', 'Average unavailable')
      : status === 'normal'
        ? t('widget.vampireDrain.normal', 'Normal')
        : status === 'elevated'
          ? t('widget.vampireDrain.elevated', 'Elevated')
          : t('widget.vampireDrain.high', 'High');
  const statusVariant =
    status === 'normal' ? 'success' : status === 'elevated' ? 'warning' : status === 'high' ? 'danger' : 'neutral';

  return (
    <WidgetShell
      title={t('widget.vampireDrain.title', 'Vampire drain')}
      icon={isCompact ? undefined : <BatteryWarning className="h-3.5 w-3.5" />}
      help={isCompact ? undefined : {
        i18nKey: 'help.vampireDrain.body',
        defaultValue:
          'Battery percentage lost per day while the vehicle is parked and not charging, derived from observed parked windows.',
      }}
      dataState={sourceStates.length === 1
        ? sourceStates[0]
        : {
            ...statsState,
            status: hasData && eventsState.status === 'unavailable'
              ? 'partial'
              : statsState.status,
          }}
      updatedAt={Math.max(
        statsQuery.dataUpdatedAt ?? 0,
        eventsQuery.dataUpdatedAt ?? 0,
        watchQuery.dataUpdatedAt ?? 0,
      )}
      isFetching={statsQuery.isFetching || eventsQuery.isFetching || watchQuery.isFetching}
      isStale={statsQuery.isStale || eventsQuery.isStale || watchQuery.isStale}
      isError={statsQuery.isError || eventsQuery.isError || watchQuery.isError}
      onRefresh={refresh}
    >
      {hasData ? (
        <div className="flex h-full min-h-0 flex-col gap-3">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <WidgetBigNumber
              align="start"
              value={measuredAverage == null ? null : fmtNumber(measuredAverage, 1)}
              unit={measuredAverage == null ? undefined : '%/day'}
              subtitle={t('widget.vampireDrain.averageWhileParked', 'Average while parked')}
              nullDisplay="—"
            />
            <Badge
              dot
              variant={statusVariant}
              size="sm"
              aria-label={statusText}
            >
              {statusText}
            </Badge>
          </div>

          {!isCompact && bars.length > 0 && (
            <div className="min-h-16 flex-1">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={bars}
                  margin={{ top: 2, right: 2, bottom: 0, left: 2 }}
                >
                  <XAxis dataKey="index" hide />
                  <Bar
                    dataKey="rate"
                    fill={dashboardBarColor(bars)}
                    radius={[3, 3, 0, 0]}
                    maxBarSize={18}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {!isCompact && highest && (
            <p className="text-xs leading-snug text-[var(--text-secondary)]">
              {t('widget.vampireDrain.highest', 'Highest: {{rate}}%/day on {{date}}', {
                rate: fmtNumber(highest.rate, 1),
                date: formatDate(highest.startedAt),
              })}
            </p>
          )}
        </div>
      ) : (
        <EmptyState
          icon={<BatteryWarning className="h-5 w-5" />}
          message={t('widget.vampireDrain.noData', 'No vampire drain data')}
          description={t(
            'widget.vampireDrain.emptyDescription',
            'Observed parked windows will appear when drain history is available.',
          )}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}

function dashboardBarColor(_points: readonly DrainBarPoint[]): string {
  return dashboardTokens.chart.series[2];
}
