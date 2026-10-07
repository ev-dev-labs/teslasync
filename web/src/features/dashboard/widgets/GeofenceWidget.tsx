import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Crosshair } from 'lucide-react';
import { Badge } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { Circle, Marker } from '@/components/maps';
import { useGeofences } from '@/api/hooks/useLocations';
import { useVehicleState, useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber } from '@/lib/numberFormat';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { WidgetShell } from './WidgetShell';
import { WidgetMapView } from './shared';
import type { WidgetProps } from './types';

/** Haversine distance in meters between two lat/lon points */
export function haversineMeters(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

interface FenceStatus {
  id: string;
  name: string;
  radius: number;
  latitude: number;
  longitude: number;
  enabled: boolean;
  inside: boolean;
  distanceM: number;
}

export default function GeofenceWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { unitPrefs } = useUnits();

  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const {
    data: stateData,
    isLoading: stateLoading,
    isFetching: stateFetching,
    isStale: stateStale,
    isError: stateIsError,
    dataUpdatedAt: stateUpdatedAt,
    refetch: stateRefetch,
  } = useVehicleState(id);

  const {
    data: geofences,
    isLoading: fenceLoading,
    isFetching: fenceFetching,
    isStale: fenceStale,
    isError: fenceIsError,
    dataUpdatedAt: fenceUpdatedAt,
    refetch: fenceRefetch,
  } = useGeofences();

  const isLoading = stateLoading || fenceLoading;
  const isFetching = stateFetching || fenceFetching;
  const isStale = stateStale || fenceStale;
  const isError = stateIsError || fenceIsError;
  const updatedAt = Math.max(stateUpdatedAt ?? 0, fenceUpdatedAt ?? 0);
  // Both sources feed every layout (the compact zone badge is derived from the
  // geofence list AND the vehicle position), so a manual refresh must refetch
  // both — refetching state alone left a failed geofence fetch un-retried.
  const onRefresh = useCallback(() => {
    stateRefetch();
    fenceRefetch();
  }, [stateRefetch, fenceRefetch]);

  const state = stateData?.state;
  const vLat = state?.latitude ?? 0;
  const vLon = state?.longitude ?? 0;
  const hasCoords = vLat !== 0 || vLon !== 0;

  const fences: FenceStatus[] = useMemo(() => {
    const raw = geofences ?? [];
    return raw.map((g) => {
      const gLat = g.latitude ?? 0;
      const gLon = g.longitude ?? 0;
      const radius = g.radius ?? 0;
      const dist = hasCoords
        ? haversineMeters(vLat, vLon, gLat, gLon)
        : Infinity;
      return {
        id: g.id,
        name: g.name ?? '—',
        radius,
        latitude: gLat,
        longitude: gLon,
        enabled: g.enabled ?? true,
        inside: dist <= radius,
        distanceM: dist,
      };
    });
  }, [geofences, vLat, vLon, hasCoords]);

  const currentZone = useMemo(
    () => fences.find((f) => f.inside && f.enabled),
    [fences],
  );
  const isCompact = size.cols <= 1;
  const isEmpty = fences.length === 0;

  /** Convert radius (meters) to user-preferred distance and format */
  const fmtRadius = (meters: number): string => {
    return `${fmtNumber(convertDistanceFromSI(meters, unitPrefs.distance), 1)} ${unitPrefs.distance}`;
  };

  const shellProps = {
    loading: isLoading,
    updatedAt,
    isFetching,
    isStale,
    isError,
    onRefresh,
  };

  // ─── Compact layout (1×2) ───
  if (isCompact) {
    return (
      <WidgetShell {...shellProps}>
        <div className="flex h-full flex-col items-center justify-center gap-1 min-h-[44px]">
          <Crosshair aria-hidden="true" className="h-5 w-5 text-neon-cyan" />
          {currentZone ? (
            <Badge variant="success" size="sm">
              {currentZone.name}
            </Badge>
          ) : (
            <Badge variant="neutral" size="sm">
              {t('widget.geofence.noZone', 'No zone')}
            </Badge>
          )}
        </div>
      </WidgetShell>
    );
  }

  // ─── Standard layout (2×4) ───
  const showMap = hasCoords && size.rows >= 3;

  return (
    <WidgetShell
      title={t('widget.geofence.title', 'Geofence Status')}
      icon={<Crosshair aria-hidden="true" className="h-3.5 w-3.5 text-neon-cyan" />}
      noPadding={showMap}
      {...shellProps}
    >
      {isEmpty ? (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Crosshair aria-hidden="true" className="h-5 w-5" />}
          message={t('widget.geofence.noFences', 'No geofences configured')}
          className="py-4"
        />
      ) : (
        <div className="flex h-full flex-col">
          {/* Map section */}
          {showMap && (
            <div className="h-40 min-h-[120px] flex-shrink-0">
              <WidgetMapView
                center={[vLat, vLon]}
                zoom={12}
                compact={false}
              >
                {fences.map((f) => (
                  <Circle
                    key={f.id}
                    center={[f.latitude, f.longitude]}
                    radius={f.radius}
                    pathOptions={{
                      color: f.inside ? '#22c55e' : '#6b7280',
                      fillColor: f.inside ? '#22c55e' : '#6b7280',
                      fillOpacity: 0.15,
                      weight: 2,
                    }}
                  />
                ))}
                <Marker position={[vLat, vLon]} />
              </WidgetMapView>
            </div>
          )}

          {/* Fence list */}
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-2">
            <ul className="space-y-1.5">
              {fences.map((f) => (
                <li
                  key={f.id}
                  className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 min-h-[44px] ${
                    f.inside && f.enabled
                      ? 'bg-green-500/10 ring-1 ring-green-500/30'
                      : 'bg-[var(--surface-2)]'
                  }`}
                >
                  <div className="flex flex-col min-w-0">
                    <span className="truncate text-sm font-medium text-[var(--text-primary)]">
                      {f.name}
                    </span>
                    <span className="text-2xs text-[var(--text-muted)]">
                      {t('widget.geofence.radius', 'Radius')}: {fmtRadius(f.radius)}
                    </span>
                  </div>
                  <div className="flex-shrink-0">
                    {!f.enabled ? (
                      <Badge variant="neutral" size="sm">
                        {t('widget.geofence.disabled', 'Disabled')}
                      </Badge>
                    ) : f.inside ? (
                      <Badge variant="success" size="sm" dot>
                        {t('widget.geofence.inside', 'Inside')}
                      </Badge>
                    ) : (
                      <Badge variant="neutral" size="sm">
                        {t('widget.geofence.outside', 'Outside')}
                      </Badge>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </WidgetShell>
  );
}
