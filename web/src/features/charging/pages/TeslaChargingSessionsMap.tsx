import { useMemo } from 'react';
import { MapContainer, CircleMarker, Popup } from '@/components/maps';
import { MapTileLayer } from '@/components/maps';
import type { TeslaChargingSession } from '@/api/hooks/useCharging';
import { fmtNumber } from '@/lib/numberFormat';
import { formatDateTime } from '@/lib/dateFormat';

interface Props {
  sessions: TeslaChargingSession[];
}

export default function TeslaChargingSessionsMap({ sessions }: Props) {
  const center = useMemo(() => {
    if (sessions.length === 0) return { lat: 37.77, lng: -122.42 };
    const avgLat = sessions.reduce((sum, s) => sum + (s.latitude ?? 0), 0) / sessions.length;
    const avgLng = sessions.reduce((sum, s) => sum + (s.longitude ?? 0), 0) / sessions.length;
    return { lat: avgLat, lng: avgLng };
  }, [sessions]);

  return (
    <div className="h-[350px] rounded-lg overflow-hidden">
      <MapContainer
        center={[center.lat, center.lng]}
        zoom={5}
        scrollWheelZoom
        className="h-full w-full"
      >
        <MapTileLayer />
        {sessions.map((s) => (
          <CircleMarker
            key={s.session_id}
            center={[s.latitude!, s.longitude!]}
            radius={6}
            pathOptions={{ color: '#22d3ee', fillColor: '#22d3ee', fillOpacity: 0.7 }}
          >
            <Popup>
              <div className="text-xs space-y-1">
                <p className="font-semibold">{s.site_location_name || 'Unknown'}</p>
                <p>{formatDateTime(s.charge_start_datetime)}</p>
                {s.energy_added_kwh != null && <p>{fmtNumber(s.energy_added_kwh, 1)} kWh</p>}
                {s.total_cost != null && <p>${fmtNumber(s.total_cost, 2)}</p>}
                {s.charger_type && <p className="uppercase">{s.charger_type}</p>}
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
