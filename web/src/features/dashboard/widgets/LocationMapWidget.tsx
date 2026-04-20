import { useTranslation } from 'react-i18next';
import { MapPin } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { MapContainer, Marker, MapTileLayer } from '@/components/maps';
import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

export default function LocationMapWidget({ vehicleId }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { data: stateData, isLoading } = useVehicleState(id);
  const state = stateData?.state;

  const hasCoords = state && state.latitude !== 0 && state.longitude !== 0;

  return (
    <WidgetShell
      title={t('widget.location', 'Location')}
      icon={<MapPin className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={isLoading}
      noPadding
    >
      <div className="h-full relative">
        {hasCoords ? (
          <MapContainer
            center={[state.latitude, state.longitude]}
            zoom={14}
            scrollWheelZoom={false}
            className="h-full w-full"
            style={{ background: '#1a1a2e' }}
          >
            <MapTileLayer style="dark" />
            <Marker position={[state.latitude, state.longitude]} />
          </MapContainer>
        ) : (
          <EmptyState
            icon={<MapPin className="h-6 w-6" />}
            message={t('widget.noLocation', 'No location data available')}
            className="py-4"
          />
        )}
      </div>
    </WidgetShell>
  );
}
