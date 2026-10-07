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

/** A session that is known to carry finite, real map coordinates. */
type LocatedSession = TeslaChargingSession & { latitude: number; longitude: number };

/** Default map center (San Francisco) used when no session has coordinates. */
const DEFAULT_CENTER: [number, number] = [37.77, -122.42];

/**
 * True only when the session has finite, real lat/lng. Excludes null,
 * NaN and ±Infinity so bad coordinates can neither skew the centroid nor
 * crash leaflet with a NaN center.
 */
function hasValidCoords(s: TeslaChargingSession): s is LocatedSession {
  return (
    typeof s.latitude === 'number' &&
    typeof s.longitude === 'number' &&
    Number.isFinite(s.latitude) &&
    Number.isFinite(s.longitude)
  );
}

/** Escape user-supplied text before it is interpolated into popup HTML. */
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

  /* Only sessions with finite, real coordinates feed the map. */
  const locatedSessions = useMemo(
    () => (sessions ?? []).filter(hasValidCoords),
    [sessions],
  );

  /*
   * Center on the centroid of the located sessions. Invalid-coordinate
   * sessions are filtered out up front, so a null/NaN coordinate can no
   * longer drag the centroid toward (0,0) or poison it into a NaN center —
   * fall back to a sensible default when nothing is placeable.
   */
  const center = useMemo<[number, number]>(() => {
    if (locatedSessions.length === 0) return DEFAULT_CENTER;
    const avgLat =
      locatedSessions.reduce((sum, s) => sum + s.latitude, 0) / locatedSessions.length;
    const avgLng =
      locatedSessions.reduce((sum, s) => sum + s.longitude, 0) / locatedSessions.length;
    return [avgLat, avgLng];
  }, [locatedSessions]);

  /* Cluster points are derived from sessions with valid coords. */
  const clusterPoints = useMemo(
    () =>
      locatedSessions.map((s) => {
        const displayName =
          s.site_location_name || t('tesla_sessions.unknown', 'Unknown');
        const siteName = escapeHtml(displayName);
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
            <div class="text-xs" style="line-height:1.3">
              <p class="font-semibold" style="margin-bottom:2px">${siteName}</p>
              <p>${escapeHtml(formatDateTime(s.charge_start_datetime))}</p>
              ${energy}${cost}${charger}
            </div>
          `,
          ariaLabel: t('tesla_sessions.markerLabel', '{{name}} charging session', {
            name: displayName,
            defaultValue: '{{name}} charging session',
          }) as string,
        };
      }),
    [locatedSessions, t, formatCurrency],
  );

  return (
    <div
      className="h-[350px] rounded-lg overflow-hidden"
      role="application"
      aria-label={t('tesla_sessions.mapLabel', 'Charging sessions map')}
    >
      <MapContainer
        center={center}
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
