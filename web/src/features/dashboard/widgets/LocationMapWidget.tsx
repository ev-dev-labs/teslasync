import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin, Navigation } from 'lucide-react';
import { AnimatedMarker } from '@/components/maps';
import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { WidgetShell } from './WidgetShell';
import { WidgetMapView } from './shared';
import type { WidgetProps } from './types';

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
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { data: stateData, isLoading, isFetching, isStale, isError, dataUpdatedAt, refetch } = useVehicleState(id);
  const state = stateData?.state;
  const isLive = stateData?.live ?? false;

  const lat = state?.latitude ?? 0;
  const lng = state?.longitude ?? 0;
  const hasCoords = state != null && hasValidCoords(lat, lng);
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
      title={isCompact ? undefined : t('widget.locationMap.title', 'Vehicle Location Map')}
      icon={isCompact ? undefined : <MapPin className="h-3.5 w-3.5 text-neon-cyan" aria-hidden="true" />}
      loading={isLoading}
      noPadding
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      <div className="h-full relative">
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
            className="absolute bottom-2 left-2 z-[1000] flex flex-col gap-1"
            role="group"
            aria-label={t('widget.locationMap.status', 'Vehicle location status')}
          >
            {!isLive && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--surface-overlay)] text-2xs text-amber-400 backdrop-blur-sm">
                <MapPin className="h-2.5 w-2.5" aria-hidden="true" />
                {t('widget.locationMap.lastKnown', 'Last known position')}
              </span>
            )}
            {isExpanded && heading != null && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--surface-overlay)] text-2xs text-[var(--text-secondary)] backdrop-blur-sm">
                <Navigation className="h-2.5 w-2.5" aria-hidden="true" />
                {t('widget.locationMap.heading', 'Heading')}: {Math.round(heading)}°
              </span>
            )}
            {isExpanded && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--surface-overlay)] text-2xs text-[var(--text-secondary)] backdrop-blur-sm">
                {lat.toFixed(4)}, {lng.toFixed(4)}
              </span>
            )}
          </div>
        )}
      </div>
    </WidgetShell>
  );
}
