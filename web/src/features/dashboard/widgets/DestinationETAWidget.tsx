import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigation2 } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { CircleMarker, Popup } from '@/components/maps';
import { Text } from '@/components/ui';
import { useLocationSnapshotLatest, useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';

import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetMapView, WidgetStatGrid } from './shared';
import InstrumentPresentation from './designPacks/InstrumentPresentation';
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
  const arrivalTime = !isCompact && isNavigating && minutesToArrival != null
    ? formatTime(Date.now() + minutesToArrival * 60_000)
    : null;
  const destination = useMemo<[number, number]>(() => [
    snapshot?.destination_lat ?? Number.NaN, snapshot?.destination_lon ?? Number.NaN,
  ], [snapshot?.destination_lat, snapshot?.destination_lon]);
  const hasDestination = Number.isFinite(destination[0]) && Number.isFinite(destination[1]) &&
    Math.abs(destination[0]) <= 90 && Math.abs(destination[1]) <= 180 &&
    (destination[0] !== 0 || destination[1] !== 0);
  const noData = (
    <EmptyState /* no-action: location comes from vehicle telemetry; the shared shell owns refresh */
      icon={<Navigation2 className="h-5 w-5" />}
      message={t('widget.destinationETA.noData', 'No location data')} className="py-4" />
  );
  const noNavigation = (
    <EmptyState variant="informational" icon={<Navigation2 className="h-5 w-5" />}
      message={t('widget.destinationETA.noNav', 'No active navigation')}
      description={t('widget.destinationETA.noNavDescription', 'Start a route in the car to see distance and arrival time here.')}
      className="py-4" />
  );
  const present = (classic: ReactNode) => (
    <InstrumentPresentation family="map" compact={isCompact}
      icon={isNavigating ? <Navigation2 /> : undefined}
      context={isNavigating ? <Text as="p" variant="label" className="break-words" title={destinationName}>{destinationName}</Text> : undefined}
      headline={isNavigating ? <WidgetBigNumber
        value={minutesToArrival != null ? fmtNumber(minutesToArrival, 0) : null}
        unit={t('widget.destinationETA.min', 'min')}
        label={t('widget.destinationETA.eta', 'ETA')} animated={false} /> : undefined}
      instrument={!isNavigating ? classic : !isCompact ? (
        <WidgetMapView key={destination.join(',')} center={destination} isEmpty={!hasDestination}
          ariaLabel={t('dashboardWidgets.maps.destinationETA.map', 'Destination map')}
          emptyMessage={t('dashboardWidgets.maps.destinationETA.noCoordinates', 'Destination coordinates unavailable')}>
          {/* Only the reported destination is plotted; the snapshot has no route geometry. */}
          <CircleMarker center={destination} radius={7}>
            <Popup>{destinationName}</Popup>
          </CircleMarker>
        </WidgetMapView>
      ) : undefined}
      details={isNavigating && !isCompact ? <WidgetStatGrid cols={2} stats={[
        { label: t('dashboardWidgets.maps.destinationETA.arrival', 'Arrival'), value: arrivalTime },
        { label: t('widget.destinationETA.remaining', 'Remaining'),
          value: displayDistance != null ? `${fmtNumber(displayDistance, 0)} ${distanceUnit}` : null },
      ]} /> : undefined}>
      {classic}
    </InstrumentPresentation>
  );

  const shellProps = {
    title: t('widget.destinationETA.title', 'Destination ETA'),
    loading: isLoading,
    dataState,
    error: dataState.fatalError ? String(dataState.fatalError) : null,
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
          {present(noData)}
        </WidgetShell>
      );
    }

    if (isNavigating) {
      return (
        <WidgetShell {...shellProps}>
          {present(<WidgetBigNumber
            value={minutesToArrival != null ? fmtNumber(minutesToArrival, 0) : null}
            unit={t('widget.destinationETA.min', 'min')}
            label={t('widget.destinationETA.eta', 'ETA')}
          />)}
        </WidgetShell>
      );
    }

    return (
      <WidgetShell {...shellProps}>
        {present(noNavigation)}
      </WidgetShell>
    );
  }

  // ── Standard (2×2) ──
  if (!snapshot) {
    return (
      <WidgetShell
        icon={<Navigation2 className="h-3.5 w-3.5 text-theme-accent" />}
        {...shellProps}
      >
        {present(noData)}
      </WidgetShell>
    );
  }

  if (!isNavigating) {
    return (
      <WidgetShell
        icon={<Navigation2 className="h-3.5 w-3.5 text-theme-accent" />}
        {...shellProps}
      >
        {present(noNavigation)}
      </WidgetShell>
    );
  }

  // Navigating — full layout
  return (
    <WidgetShell
      icon={<Navigation2 className="h-3.5 w-3.5 text-theme-accent" />}
      {...shellProps}
    >
      {present(<div className="flex h-full min-h-0 flex-col justify-center gap-3 px-1">
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
      </div>)}
    </WidgetShell>
  );
}
