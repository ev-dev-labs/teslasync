import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin } from 'lucide-react';
import { useCardPlacement } from '@/components/layout/layout-reference';
import { LayoutCard } from '@/components/layout';
import { Text } from '@/components/ui';
import { EmptyState, QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import {
  MapContainer, Marker, Circle, Popup, Polyline, vehicleIcon,
  MapTileLayer, MapInvalidator, type MapStyle,
} from '@/components/maps';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { cn } from '@/lib/cn';
import type { GuardEvent } from '@/api/hooks/useGuard';
import type { GuardPageModel } from './useGuardPageModel';

export function GuardLiveMap({ model: m }: { model: GuardPageModel }) {
  const { t } = useTranslation();
  const placement = useCardPlacement();
  return (
    <div data-guard-section="map" className={cn('min-w-0', placement?.className)}>
      <LayoutCard title={t('guard.liveMap', 'Live vehicle location')}>
      <StaleRefreshWarning state={m.vehicleState} label={t('guard.liveMap', 'Live vehicle location')} />
      <div className="mt-3 h-80 min-w-0 sm:h-96">
        {m.vehicleState.fatalError ? (
          <div className="flex h-full items-center justify-center p-4">
            <QueryError error={m.vehicleState.fatalError} onRetry={m.vehicleState.retry ?? undefined} />
          </div>
        ) : m.vehicleStateQuery.isLoading && !m.stateResponse?.state ? (
          <div className="h-full p-4"><Skeleton height="100%" className="rounded-xl" /></div>
        ) : m.hasLocation && m.vehicleLat != null && m.vehicleLng != null ? (
          <LiveMap vehicleLat={m.vehicleLat} vehicleLng={m.vehicleLng}
            vehicleName={m.activeVehicle?.display_name ?? ''}
            homeGeofence={m.homeGeofence} events={m.events} />
        ) : (
          <div className="flex h-full items-center justify-center">
            <EmptyState icon={<MapPin className="h-8 w-8" aria-hidden="true" />}
              message={t('guard.noCurrentLocation', 'Current vehicle location unavailable')}
              action={!m.noVehicle && m.vehicleState.retry
                ? { label: t('common.refresh', 'Refresh'), onClick: m.vehicleState.retry }
                : undefined}
              actionTo={m.noVehicle ? { label: t('nav.manageVehicles', 'Manage vehicles'), to: '/vehicles' } : undefined} />
          </div>
        )}
      </div>
      </LayoutCard>
    </div>
  );
}

function LiveMap({
  vehicleLat, vehicleLng, vehicleName, homeGeofence, events,
}: {
  vehicleLat: number;
  vehicleLng: number;
  vehicleName: string;
  homeGeofence: { latitude: number; longitude: number; radius: number; name: string } | null;
  events: GuardEvent[];
}) {
  const [mapStyle] = useState<MapStyle>('dark');
  // security_events rows have no coordinates. Never fabricate an event trail.
  const eventPositions: [number, number][] = useMemo(() => [], [events]);
  return (
    <MapContainer center={[vehicleLat, vehicleLng]} zoom={15} scrollWheelZoom className="z-0 h-full w-full">
      <MapTileLayer style={mapStyle} />
      <MapInvalidator />
      <Marker position={[vehicleLat, vehicleLng]} icon={vehicleIcon()}>
        <MapPopup vehicleName={vehicleName} lat={vehicleLat} lng={vehicleLng} />
      </Marker>
      {homeGeofence && (
        <Circle center={[homeGeofence.latitude, homeGeofence.longitude]} radius={homeGeofence.radius}
          pathOptions={{
            color: 'rgba(59, 130, 246, 0.6)',
            fillColor: 'rgba(59, 130, 246, 0.1)',
            fillOpacity: 0.2,
            weight: 2,
          }} />
      )}
      {eventPositions.length > 1 && <EventTrail positions={eventPositions} />}
    </MapContainer>
  );
}

function MapPopup({ vehicleName, lat, lng }: { vehicleName: string; lat: number; lng: number }) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  return (
    <Popup>
      <Text as="p" variant="body">{vehicleName || t('guard.vehicle', 'Vehicle')}</Text>
      <Text as="span" variant="caption">{fmtNumber(lat)}, {fmtNumber(lng)}</Text>
    </Popup>
  );
}

function EventTrail({ positions }: { positions: [number, number][] }) {
  return <Polyline positions={positions} pathOptions={{ color: '#ef4444', weight: 3, dashArray: '8 4' }} />;
}
