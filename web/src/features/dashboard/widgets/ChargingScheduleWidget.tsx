import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Calendar, Clock, BatteryFull, Zap } from 'lucide-react';
import { Badge } from '@/components/ui';
import { Timeline } from '@/components/data-display';
import { SourceContent } from '@/components/layout';
import { EmptyState } from '@/components/feedback';
import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { request } from '@/api/client';
import { combineDataStates, deriveDataState, knownNumber } from '@/api/dataState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetStatGrid } from './shared';
import { dashboardTokens } from '../lib/dashboardTokens';
import type { WidgetProps } from './types';
import { sourceBoundaryState } from '../components/continuation-dashboard-1/sourceBoundary';

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
      return t('widget.chargingSchedule.modeStartAt', 'Start at');
    case 'DepartBy':
      return t('widget.chargingSchedule.modeDepartBy', 'Depart by');
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

  const stateQuery = useVehicleState(id);
  const { data: stateData, isLoading: stateLoading } = stateQuery;

  const signalsQuery = useQuery({
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
  const { data: liveSignals, isLoading: signalsLoading, isFetching: signalsFetching, isStale: signalsStale, isError: signalsError, dataUpdatedAt: signalsUpdatedAt, refetch: refetchSignals } = signalsQuery;

  const schedule = useMemo(
    () => parseScheduleSignals(liveSignals ?? {}),
    [liveSignals],
  );

  const state = stateData?.state;
  const isLoading = !liveSignals && (stateLoading || signalsLoading);
  const isCompact = size.cols <= 1 && size.rows <= 1;
  const isTall = size.rows >= 2;

  const hasScheduleData =
    schedule.mode != null || schedule.startTime != null || schedule.departureTime != null || schedule.chargeLimit != null || schedule.pending;
  const scheduleState = deriveDataState({
    ...signalsQuery,
    data: liveSignals ?? (!id || (!signalsLoading && !signalsError && !signalsQuery.error) ? null : undefined),
  }, { provenance: 'live' });
  const vehicleState = deriveDataState({
    ...stateQuery,
    data: stateData ?? (!id || (!stateLoading && !stateQuery.isError && !stateQuery.error) ? null : undefined),
  }, { provenance: stateData?.live ? 'live' : 'cached' });
  const handleRefresh = useCallback(() => {
    void refetchSignals();
    void stateQuery.refetch?.();
  }, [refetchSignals, stateQuery]);

  const hasData = scheduleState.hasData || vehicleState.hasData;
  const dataState = !isCompact && isTall
    ? {
        ...combineDataStates([scheduleState, vehicleState]),
        data: hasData ? { schedule: scheduleState.data, vehicle: vehicleState.data } : undefined,
        hasData,
        retry: handleRefresh,
      }
    : scheduleState;
  const blockingError = dataState.fatalError?.message ?? null;

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
        title: t('widget.chargingSchedule.startCharging', 'Start charging'),
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
        title: t('widget.chargingSchedule.targetLimit', 'Target limit'),
        time: `${schedule.chargeLimit}%`,
        color: '#f59e0b',
      });
    }

    return items;
  }, [schedule, t, formatScheduleTime]);

  const vehicleDetails = (
    <WidgetStatGrid cols={2} stats={[
      { label: t('widget.chargingSchedule.currentLevel', 'Current level'), value: knownNumber(state?.battery_level) == null ? null : `${state?.battery_level}%` },
      { label: t('widget.chargingSchedule.status', 'Status'), value: state?.is_charging === true ? t('widget.charging', 'Charging') : state?.is_charging === false ? t('widget.notCharging', 'Not charging') : null },
    ]} />
  );

  if (isCompact) {
    return (
      <WidgetShell
        title={t('widget.chargingSchedule.title', 'Charging schedule')}
        loading={isLoading}
        error={blockingError}
        dataState={dataState}
        updatedAt={signalsUpdatedAt}
        isFetching={signalsFetching}
        isStale={signalsStale}
        isError={signalsError}
        onRefresh={handleRefresh}
      >
        {hasScheduleData ? (
          <WidgetBigNumber
            value={schedule.chargeLimit != null ? `${schedule.chargeLimit}%` : null}
            label={t('widget.chargingSchedule.limit', 'Charge limit')}
            align="center"
            animated={false}
          />
        ) : (
          emptyState
        )}
      </WidgetShell>
    );
  }

  return (
    <WidgetShell
      title={t('widget.chargingSchedule.title', 'Charging schedule')}
      icon={<Calendar className="h-3.5 w-3.5 text-cyan-400" aria-hidden="true" />}
      loading={isLoading}
      error={blockingError}
      dataState={dataState}
      updatedAt={signalsUpdatedAt}
      isFetching={signalsFetching}
      isStale={signalsStale}
      isError={signalsError}
      onRefresh={handleRefresh}
    >
        <div className="h-full flex flex-col gap-3">
          <SourceContent
            state={sourceBoundaryState(scheduleState, hasScheduleData)}
            label={t('widget.chargingSchedule.title', 'Charging schedule')}
            emptyMessage={t('widget.chargingSchedule.noData', 'No schedule data')}
            emptyContent={emptyState}
            errorMessage={t('widget.chargingSchedule.scheduleUnavailable', 'Charging schedule unavailable')}
            error={scheduleState.fatalError}
            retainedMessage={t('widget.chargingSchedule.scheduleRetained', 'Previously loaded charging schedule remains visible while this source recovers.')}
            errorRecovery={{ onRetry: () => { void refetchSignals(); } }}
          >
          {/* Mode badge */}
          <div className="flex min-w-0 flex-wrap items-center gap-2">
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
            <div className={dashboardTokens.metricLabel}>
              {t('widget.chargingSchedule.noTimes', 'No scheduled times set')}
            </div>
          )}
          </SourceContent>

          {/* Extra detail row when tall */}
          {isTall && (
            <div className="mt-auto border-t border-[var(--border-subtle)] pt-2">
              <SourceContent
                state={sourceBoundaryState(vehicleState, state != null)}
                label={t('widget.chargingSchedule.currentLevel', 'Current level')}
                emptyMessage={t('widget.chargingSchedule.vehicleUnavailable', 'Vehicle charging state unavailable')}
                emptyContent={vehicleDetails}
                errorMessage={t('widget.chargingSchedule.vehicleUnavailable', 'Vehicle charging state unavailable')}
                error={vehicleState.fatalError}
                retainedMessage={t('widget.chargingSchedule.vehicleRetained', 'Previously loaded vehicle charging state remains visible while this source recovers.')}
                errorRecovery={{ onRetry: () => { void stateQuery.refetch(); } }}
              >
              {vehicleDetails}
              </SourceContent>
            </div>
          )}
        </div>
    </WidgetShell>
  );
}
