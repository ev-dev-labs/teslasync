import { useTranslation } from 'react-i18next';
import { Navigation2 } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useLocationSnapshotLatest, useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';

import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber } from './shared';
import type { WidgetProps } from './types';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDataState } from '@/hooks/useDataState';
import { dashboardTokens } from '../lib/dashboardTokens';
import { useDateFormat } from '@/hooks/useDateFormat';

export default function DestinationETAWidget({ vehicleId, size }: WidgetProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { formatTime } = useDateFormat();
  const { data: vehicles } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id;
  const { unitPrefs } = useUnits();
  const toDistanceDisplay = (value: number) => convertDistanceFromSI(value, unitPrefs.distance);

  const distanceUnit = unitPrefs.distance;

  const query = useLocationSnapshotLatest(vid ?? 0);
  const {
    data: snapshot,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = query;
  const dataState = useDataState({ ...query, data: (isError || error) && !snapshot ? undefined : !isLoading && !query.isPending ? snapshot ?? null : snapshot });

  const isCompact = size.cols <= 1;

  const isNavigating = snapshot != null &&
    snapshot.destination_name != null &&
    snapshot.destination_name !== '';

  const milesToArrival = snapshot?.miles_to_arrival != null && Number.isFinite(snapshot.miles_to_arrival) && snapshot.miles_to_arrival >= 0 ? snapshot.miles_to_arrival : null;
  const minutesToArrival = snapshot?.minutes_to_arrival != null && Number.isFinite(snapshot.minutes_to_arrival) && snapshot.minutes_to_arrival >= 0 ? snapshot.minutes_to_arrival : null;
  const destinationName = snapshot?.destination_name ?? '—';

  const displayDistance = milesToArrival != null ? toDistanceDisplay(milesToArrival) : null;
  // Only blank the whole widget on an INITIAL load failure — i.e. when there is
  // no cached snapshot to fall back on. This widget refetches on an interval, so
  // once a snapshot is on screen a transient background-refetch error must not
  // wipe otherwise-valid numbers; it is surfaced through the freshness
  // indicator's error state instead (WidgetShell forwards `isError` to
  // <FreshnessDot>).
  const blockingError = !snapshot && error ? String(error) : null;

  const shellProps = {
    title: t('widget.destinationETA.title', 'Destination ETA'),
    loading: isLoading,
    dataState,
    error: blockingError,
    updatedAt: dataUpdatedAt ?? 0,
    isFetching,
    isStale,
    isError,
    onRefresh: () => { refetch(); },
  };

  // ── Compact (1×2) ──
  if (isCompact) {
    if (!snapshot) {
      return (
        <WidgetShell {...shellProps}>
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<Navigation2 className="h-5 w-5" />}
            message={t('widget.destinationETA.noData', 'No location data')}
            className="py-4"
          />
        </WidgetShell>
      );
    }

    if (isNavigating) {
      return (
        <WidgetShell {...shellProps}>
          <WidgetBigNumber
            value={minutesToArrival != null ? fmtNumber(minutesToArrival, 0) : null}
            unit={t('widget.destinationETA.min', 'min')}
            label={t('widget.destinationETA.eta', 'ETA')}
          />
        </WidgetShell>
      );
    }

    return (
      <WidgetShell {...shellProps}>
        <EmptyState
          variant="informational"
          icon={<Navigation2 className="h-5 w-5" />}
          message={t('widget.destinationETA.noNav', 'No active navigation')}
          description={t('widget.destinationETA.noNavDescription', 'Start a route in the car to see distance and arrival time here.')}
          className="py-4"
        />
      </WidgetShell>
    );
  }

  // ── Standard (2×2) ──
  if (!snapshot) {
    return (
      <WidgetShell
        icon={<Navigation2 className="h-3.5 w-3.5 text-cyan-400" />}
        {...shellProps}
      >
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Navigation2 className="h-5 w-5" />}
          message={t('widget.destinationETA.noData', 'No location data')}
          className="py-4"
        />
      </WidgetShell>
    );
  }

  if (!isNavigating) {
    return (
      <WidgetShell
        icon={<Navigation2 className="h-3.5 w-3.5 text-cyan-400" />}
        {...shellProps}
      >
        <EmptyState
          variant="informational"
          icon={<Navigation2 className="h-5 w-5" />}
          message={t('widget.destinationETA.noNav', 'No active navigation')}
          description={t('widget.destinationETA.noNavDescription', 'Start a route in the car to see distance and arrival time here.')}
          className="py-4"
        />
      </WidgetShell>
    );
  }

  // Navigating — full layout
  const arrivalTime = minutesToArrival != null
    ? formatTime(Date.now() + minutesToArrival * 60_000)
    : null;

  return (
    <WidgetShell
      icon={<Navigation2 className="h-3.5 w-3.5 text-cyan-400" />}
      {...shellProps}
    >
      <div className="flex h-full min-h-0 flex-col justify-center gap-3 px-1">
        <div className={`${dashboardTokens.metricLabel} truncate`} title={destinationName}>
          {destinationName}
        </div>

        <div className="flex min-w-0 items-end justify-between gap-3">
          <WidgetBigNumber
            value={minutesToArrival != null ? fmtNumber(minutesToArrival, 0) : null}
            label={t('widget.destinationETA.eta', 'ETA')}
            unit={t('widget.destinationETA.min', 'min')}
            animated={false}
          />
          <div className="min-w-0 text-right">
            {arrivalTime && (
              <div className={dashboardTokens.secondaryMetric}>{arrivalTime}</div>
            )}
          </div>
        </div>

        <div className="flex min-w-0 items-baseline justify-between gap-3 border-t border-[var(--border-subtle)] pt-3">
          <span className={dashboardTokens.metricLabel}>{t('widget.destinationETA.remaining', 'Remaining')}</span>
          <span className={dashboardTokens.secondaryMetric}>
            {displayDistance != null ? `${fmtNumber(displayDistance, 0)} ${distanceUnit}` : '—'}
          </span>
        </div>

      </div>
    </WidgetShell>
  );
}
