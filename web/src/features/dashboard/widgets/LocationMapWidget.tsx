import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin, Navigation } from 'lucide-react';
import { AnimatedMarker } from '@/components/maps';
import { Text } from '@/components/ui';
import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { WidgetShell } from './WidgetShell';
import { WidgetMapView } from './shared';
import type { WidgetProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDataState } from '@/hooks/useDataState';

/**
 * True only when `(lat, lng)` is a usable GPS fix: both finite, inside the
 * valid WGS-84 ranges, and not the `(0, 0)` "null island" sentinel the backend
 * emits for a vehicle that has never reported a position. A single zero axis is
 * legal — a car can genuinely sit on the equator or the prime meridian — so a
 * naive `lat !== 0 && lng !== 0` check wrongly hides real fixes such as
 * `(51.48, 0)` (Greenwich). This also rejects `NaN`/`Infinity` coordinates that
 * would otherwise be handed to Leaflet and break the map.
 */
export function hasValidCoords(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat === 0 && lng === 0) return false;
  if (lat < -90 || lat > 90) return false;
  if (lng < -180 || lng > 180) return false;
  return true;
}

/**
 * Normalize a raw heading into a finite bearing in `[0, 360)`, or `undefined`
 * when the source is missing or non-finite — so the marker never rotates by
 * `NaNdeg` and the overlay never reads "NaN°".
 */
export function normalizeHeading(
  heading: number | null | undefined,
): number | undefined {
  if (heading == null || !Number.isFinite(heading)) return undefined;
  return ((heading % 360) + 360) % 360;
}

export default function LocationMapWidget({ vehicleId, size }: WidgetProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const query = useVehicleState(id);
  const { data: stateData, isLoading, isFetching, isStale, isError, dataUpdatedAt, refetch } = query;
  const dataState = useDataState({
    ...query,
    data: (query.error || query.isError) && !stateData?.state ? undefined :
      !query.isLoading && !query.isPending && !query.error && !query.isError ? query.data ?? null : query.data,
  });
  const state = stateData?.state;
  const isLive = stateData?.live ?? false;

  const lat = state?.latitude ?? 0;
  const lng = state?.longitude ?? 0;
  const hasCoords = state?.latitude != null && state.longitude != null && hasValidCoords(lat, lng);
  const heading = normalizeHeading(state?.heading);
  const isCompact = size.cols <= 1;
  const isExpanded = size.cols >= 3 || size.rows >= 3;

  // Stable [lat, lng] tuple: a fresh array literal each render would re-trigger
  // <AnimatedMarker>'s position effect (setLatLng + re-center) even when the
  // vehicle hasn't moved.
  const center = useMemo<[number, number]>(() => [lat, lng], [lat, lng]);
  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  return (
    <WidgetShell
      title={t('widget.locationMap.title', 'Vehicle location map')}
      icon={isCompact ? undefined : <MapPin className="h-3.5 w-3.5 text-cyan-300" aria-hidden="true" />}
      loading={isLoading}
      dataState={dataState}
      noPadding
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      <div className="relative flex min-h-0 flex-1 flex-col">
        <WidgetMapView
          center={center}
          zoom={isCompact ? 13 : 14}
          compact={isCompact}
          isEmpty={!hasCoords}
          emptyMessage={t('widget.locationMap.noData', 'No location data available')}
        >
          <AnimatedMarker
            position={center}
            heading={heading}
          />
        </WidgetMapView>

        {/* Status overlay */}
        {hasCoords && !isCompact && (
          <div
            className="absolute bottom-2 start-2 end-2 z-[1000] flex min-w-0 flex-col items-start gap-1"
            role="group"
            aria-label={t('widget.locationMap.status', 'Vehicle location status')}
          >
            {!isLive && (
              <Text variant="caption" className="inline-flex max-w-full items-start gap-1 px-2 py-0.5 rounded-full bg-[var(--surface-overlay)] text-amber-300 backdrop-blur-sm [overflow-wrap:anywhere]">
                <MapPin className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
                {t('widget.locationMap.lastKnown', 'Last known position')}
              </Text>
            )}
            {isExpanded && heading != null && (
              <Text variant="caption" className="inline-flex max-w-full items-start gap-1 px-2 py-0.5 rounded-full bg-[var(--surface-overlay)] backdrop-blur-sm [overflow-wrap:anywhere]">
                <Navigation className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
                {t('widget.locationMap.heading', 'Heading')}: {fmtNumber(heading)}°
              </Text>
            )}
            {isExpanded && (
              <Text variant="caption" className="inline-flex max-w-full items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--surface-overlay)] backdrop-blur-sm [overflow-wrap:anywhere]">
                {fmtNumber(lat)}, {fmtNumber(lng)}
              </Text>
            )}
          </div>
        )}
      </div>
    </WidgetShell>
  );
}
