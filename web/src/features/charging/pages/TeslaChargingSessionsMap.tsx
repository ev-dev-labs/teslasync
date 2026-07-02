import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useFormatting } from '@/hooks/useFormatting';
import { MapContainer, MarkerCluster } from '@/components/maps';
import { MapTileLayer } from '@/components/maps';
import type { TeslaChargingSession } from '@/api/hooks/useCharging';
import { fmtNumber } from '@/lib/numberFormat';
import { convertEnergyFromSI } from '@/lib/unitConversion';
import { formatDateTime } from '@/lib/dateFormat';

interface Props {
  sessions: TeslaChargingSession[];
}

type MappableSession = TeslaChargingSession & { latitude: number; longitude: number };

/* A session is mappable only when both coordinates are finite numbers. */
function hasValidCoords(s: TeslaChargingSession): s is MappableSession {
  return (
    typeof s.latitude === 'number' &&
    typeof s.longitude === 'number' &&
    Number.isFinite(s.latitude) &&
    Number.isFinite(s.longitude)
  );
}

function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return c;
    }
  });
}

export default function TeslaChargingSessionsMap({ sessions }: Props) {
  const { t } = useTranslation();
  const { formatCurrency } = useFormatting();

  /* Both the centering math and the cluster layer derive from this same
     validated set so a NaN / missing coordinate can never skew the initial
     view or reach the MapLibre cluster source. */
  const mappable = useMemo<MappableSession[]>(
    () => (sessions ?? []).filter(hasValidCoords),
    [sessions],
  );

  const center = useMemo(() => {
    if (mappable.length === 0) return { lat: 37.77, lng: -122.42 };
    const avgLat = mappable.reduce((sum, s) => sum + s.latitude, 0) / mappable.length;
    const avgLng = mappable.reduce((sum, s) => sum + s.longitude, 0) / mappable.length;
    return { lat: avgLat, lng: avgLng };
  }, [mappable]);

  /* Cluster points are derived from sessions with valid coords. */
  const clusterPoints = useMemo(
    () =>
      mappable.map((s) => {
        const siteName = escapeHtml(
          s.site_location_name || t('tesla_sessions.unknown', 'Unknown'),
        );
        const energy =
          s.total_energy_added_wh != null
            ? `<p>${fmtNumber(convertEnergyFromSI(s.total_energy_added_wh, 'kWh'), 1)} kWh</p>`
            : '';
        const cost =
          s.total_cost != null ? `<p>${formatCurrency(s.total_cost, 2)}</p>` : '';
        const charger = s.charger_type
          ? `<p style="text-transform:uppercase">${escapeHtml(String(s.charger_type))}</p>`
          : '';
        return {
          id: s.session_id,
          lat: s.latitude,
          lng: s.longitude,
          popupHtml: `
            <div style="font-size:12px;line-height:1.3">
              <p style="font-weight:600;margin-bottom:2px">${siteName}</p>
              <p>${escapeHtml(formatDateTime(s.charge_start_datetime))}</p>
              ${energy}${cost}${charger}
            </div>
          `,
          ariaLabel: t('tesla_sessions.markerLabel', '{{name}} charging session', {
            name: s.site_location_name || t('tesla_sessions.unknown', 'Unknown'),
            defaultValue: '{{name}} charging session',
          }) as string,
        };
      }),
    [mappable, t, formatCurrency],
  );

  return (
    <div
      className="h-[350px] rounded-lg overflow-hidden"
      role="application"
      aria-label={t('tesla_sessions.mapLabel', 'Charging sessions map')}
    >
      <MapContainer
        center={[center.lat, center.lng]}
        zoom={5}
        scrollWheelZoom
        className="h-full w-full"
      >
        <MapTileLayer />
        <MarkerCluster
          points={clusterPoints}
          defaultColor="#22d3ee"
          maxClusterRadius={60}
        />
      </MapContainer>
    </div>
  );
}
