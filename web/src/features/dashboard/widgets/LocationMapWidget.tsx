import { useTranslation } from 'react-i18next';
import { MapPin, Navigation } from 'lucide-react';
import { AnimatedMarker } from '@/components/maps';
import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { WidgetShell } from './WidgetShell';
import { WidgetMapView } from './shared';
import type { WidgetProps } from './types';

export default function LocationMapWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { data: stateData, isLoading, isFetching, isStale, isError, dataUpdatedAt, refetch } = useVehicleState(id);
  const state = stateData?.state;
  const isLive = stateData?.live ?? false;

  const hasCoords = state != null && state.latitude !== 0 && state.longitude !== 0;
  const heading = state?.heading ?? undefined;
  const isCompact = size.cols <= 1;
  const isExpanded = size.cols >= 3 || size.rows >= 3;

  const lat = state?.latitude ?? 0;
  const lng = state?.longitude ?? 0;

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.locationMap.title', 'Vehicle Location Map')}
      icon={isCompact ? undefined : <MapPin className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={isLoading}
      noPadding
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      <div className="h-full relative">
        <WidgetMapView
          center={[lat, lng]}
          zoom={isCompact ? 13 : 14}
          compact={isCompact}
          isEmpty={!hasCoords}
          emptyMessage={t('widget.locationMap.noData', 'No location data available')}
        >
          <AnimatedMarker
            position={[lat, lng]}
            heading={heading}
          />
        </WidgetMapView>

        {/* Status overlay */}
        {hasCoords && !isCompact && (
          <div className="absolute bottom-2 left-2 z-[1000] flex flex-col gap-1">
            {!isLive && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/70 text-[10px] text-amber-400 backdrop-blur-sm">
                <MapPin className="h-2.5 w-2.5" />
                {t('widget.locationMap.lastKnown', 'Last known position')}
              </span>
            )}
            {isExpanded && heading != null && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/70 text-[10px] text-white/70 backdrop-blur-sm">
                <Navigation className="h-2.5 w-2.5" />
                {t('widget.locationMap.heading', 'Heading')}: {Math.round(heading)}°
              </span>
            )}
            {isExpanded && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/70 text-[10px] text-white/50 backdrop-blur-sm">
                {lat.toFixed(4)}, {lng.toFixed(4)}
              </span>
            )}
          </div>
        )}
      </div>
    </WidgetShell>
  );
}
