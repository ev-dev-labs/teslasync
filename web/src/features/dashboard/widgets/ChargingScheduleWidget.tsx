import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Calendar, Clock, BatteryFull, Zap } from 'lucide-react';
import { Badge } from '@/components/ui';
import { Timeline } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { request } from '@/api/client';
import { useDateFormat } from '@/hooks/useDateFormat';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

export interface ScheduleSignals {
  mode: string | null;
  pending: boolean;
  startTime: string | null;
  departureTime: string | null;
  chargeLimit: number | null;
}

/**
 * Coerce a raw signal value into a trimmed, non-empty string — otherwise
 * `null`. Guards the widget against blank / whitespace-only mode & time
 * strings that would otherwise flip `hasScheduleData` to true and render an
 * empty badge or an unparseable time.
 */
function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export function parseScheduleSignals(
  signals: Record<string, { value: unknown; timestamp: string }>,
): ScheduleSignals {
  const raw = (key: string) => signals[key]?.value ?? null;
  const pending = raw('ScheduledChargingPending');
  const chargeLimit = raw('ChargeLimitSoc');

  return {
    mode: asNonEmptyString(raw('ScheduledChargingMode')),
    pending: pending === true || pending === 'true',
    startTime: asNonEmptyString(raw('ScheduledChargingStartTime')),
    departureTime: asNonEmptyString(raw('ScheduledDepartureTime')),
    chargeLimit:
      typeof chargeLimit === 'number' && Number.isFinite(chargeLimit) ? chargeLimit : null,
  };
}

export function modeLabel(mode: string | null, t: (k: string, f: string) => string): string {
  switch (mode) {
    case 'StartAt':
      return t('widget.chargingSchedule.modeStartAt', 'Start At');
    case 'DepartBy':
      return t('widget.chargingSchedule.modeDepartBy', 'Depart By');
    case 'Off':
      return t('widget.chargingSchedule.modeOff', 'Off');
    default:
      return mode ?? t('widget.chargingSchedule.modeUnknown', 'Unknown');
  }
}

export function modeBadgeVariant(mode: string | null): 'success' | 'warning' | 'neutral' {
  switch (mode) {
    case 'StartAt':
    case 'DepartBy':
      return 'success';
    case 'Off':
      return 'neutral';
    default:
      return 'warning';
  }
}

export default function ChargingScheduleWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { formatTime: formatScheduleTime } = useDateFormat();
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const { data: stateData, isLoading: stateLoading } = useVehicleState(id);

  const { data: liveSignals, isLoading: signalsLoading, isFetching: signalsFetching, isStale: signalsStale, isError: signalsError, dataUpdatedAt: signalsUpdatedAt, refetch: refetchSignals } = useQuery({
    queryKey: ['signals', id, 'live-schedule'],
    queryFn: async () => {
      const res = await request<{
        signals?: Record<string, { value: unknown; timestamp: string }>;
      }>(`/signals/${id}/live`);
      return res.signals ?? {};
    },
    enabled: id > 0,
    staleTime: 30_000,
  });

  const schedule = useMemo(
    () => parseScheduleSignals(liveSignals ?? {}),
    [liveSignals],
  );

  const state = stateData?.state;
  const isLoading = stateLoading || signalsLoading;
  const isCompact = size.cols <= 1 && size.rows <= 1;
  const isTall = size.rows >= 2;

  const hasScheduleData =
    schedule.mode != null || schedule.startTime != null || schedule.chargeLimit != null;

  const handleRefresh = useCallback(() => {
    void refetchSignals();
  }, [refetchSignals]);

  const emptyState = (
    <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
      icon={<Calendar className="h-5 w-5" aria-hidden="true" />}
      message={t('widget.chargingSchedule.noData', 'No schedule data')}
      className="py-4"
    />
  );

  const timelineItems = useMemo(() => {
    const items: { icon?: React.ReactNode; title: string; subtitle?: string; time: string; color?: string }[] = [];

    if (schedule.startTime) {
      items.push({
        icon: <Zap className="h-3 w-3" aria-hidden="true" />,
        title: t('widget.chargingSchedule.startCharging', 'Start Charging'),
        subtitle: schedule.pending
          ? t('widget.chargingSchedule.pending', 'Pending')
          : undefined,
        time: formatScheduleTime(schedule.startTime),
        color: '#22c55e',
      });
    }

    if (schedule.departureTime) {
      items.push({
        icon: <Clock className="h-3 w-3" aria-hidden="true" />,
        title: t('widget.chargingSchedule.departure', 'Departure'),
        time: formatScheduleTime(schedule.departureTime),
        color: '#3b82f6',
      });
    }

    if (schedule.chargeLimit != null) {
      items.push({
        icon: <BatteryFull className="h-3 w-3" aria-hidden="true" />,
        title: t('widget.chargingSchedule.targetLimit', 'Target Limit'),
        time: `${schedule.chargeLimit}%`,
        color: '#f59e0b',
      });
    }

    return items;
  }, [schedule, t, formatScheduleTime]);

  if (isCompact) {
    return (
      <WidgetShell
        loading={isLoading}
        updatedAt={signalsUpdatedAt}
        isFetching={signalsFetching}
        isStale={signalsStale}
        isError={signalsError}
        onRefresh={handleRefresh}
      >
        {hasScheduleData ? (
          <div className="h-full flex flex-col items-center justify-center gap-1">
            <span className="text-2xl font-bold text-[var(--text-primary)]">
              {schedule.chargeLimit != null ? `${schedule.chargeLimit}%` : '—'}
            </span>
            <span className="text-2xs text-[var(--text-muted)] uppercase tracking-wider">
              {t('widget.chargingSchedule.limit', 'Charge Limit')}
            </span>
          </div>
        ) : (
          emptyState
        )}
      </WidgetShell>
    );
  }

  return (
    <WidgetShell
      title={t('widget.chargingSchedule.title', 'Charging Schedule')}
      icon={<Calendar className="h-3.5 w-3.5 text-cyan-400" aria-hidden="true" />}
      loading={isLoading}
      updatedAt={signalsUpdatedAt}
      isFetching={signalsFetching}
      isStale={signalsStale}
      isError={signalsError}
      onRefresh={handleRefresh}
    >
      {hasScheduleData ? (
        <div className="h-full flex flex-col gap-3">
          {/* Mode badge */}
          <div className="flex items-center gap-2">
            <Badge variant={modeBadgeVariant(schedule.mode)} size="sm" dot>
              {modeLabel(schedule.mode, t)}
            </Badge>
            {schedule.pending && (
              <Badge variant="warning" size="sm">
                {t('widget.chargingSchedule.pending', 'Pending')}
              </Badge>
            )}
          </div>

          {/* Visual timeline */}
          {timelineItems.length > 0 ? (
            <Timeline items={timelineItems} className="text-sm" />
          ) : (
            <div className="text-xs text-[var(--text-muted)]">
              {t('widget.chargingSchedule.noTimes', 'No scheduled times set')}
            </div>
          )}

          {/* Extra detail row when tall */}
          {isTall && state && (
            <div className="mt-auto pt-2 border-t border-white/[0.06] grid grid-cols-2 gap-2">
              <div>
                <p className="text-2xs text-[var(--text-muted)]">
                  {t('widget.chargingSchedule.currentLevel', 'Current Level')}
                </p>
                <p className="text-sm font-semibold text-[var(--text-primary)]">
                  {state.battery_level ?? 0}%
                </p>
              </div>
              <div>
                <p className="text-2xs text-[var(--text-muted)]">
                  {t('widget.chargingSchedule.status', 'Status')}
                </p>
                <p className="text-sm font-semibold text-[var(--text-primary)]">
                  {state.is_charging
                    ? t('widget.charging', 'Charging')
                    : t('widget.notCharging', 'Not Charging')}
                </p>
              </div>
            </div>
          )}
        </div>
      ) : (
        emptyState
      )}
    </WidgetShell>
  );
}
