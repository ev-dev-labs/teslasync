import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin, Flag, Navigation2 } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { AlertBanner } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import {
  MapContainer, Polyline, CircleMarker, Popup, useMap,
  MapTileLayer, MapInvalidator, MapLayerSwitcher,
  latLngBounds,
  type LatLngExpression,
  type MapStyle,
} from '@/components/maps';
import { useUnits } from '@/hooks/useUnits';
import { formatTime, formatDateTime } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import { hasMeaningfulRoute, firstValidIndex } from '@/lib/geo';
import type { DriveDetail } from '@/types/driving';
import type { SpeedSegment } from './types';
import { SPEED_SEGMENT_LOW_MPS, SPEED_SEGMENT_MED_MPS, SPEED_SEGMENT_HIGH_MPS } from './constants';
import { convertSpeedFromSI } from '@/lib/unitConversion';

/* Auto-fit map bounds to trail. Special-cases two cluster degeneracies that
 * leaflet otherwise zooms past the maxZoom for: (1) trail with N identical
 * coords (zero-extent bbox passes isValid()) and (2) trail with cluster
 * smaller than the spread floor. Falls back to a hand-set view at the
 * anchor coord at zoom 15 so the user sees recognisable streets. */
function FitBounds({ trail, fallbackCenter }: { trail: LatLngExpression[]; fallbackCenter?: [number, number] }) {
  const map = useMap();
  // Fitting the map viewport is a side effect on the leaflet instance, so it
  // belongs in an effect — never `useMemo`, whose result React is free to
  // discard or double-invoke under StrictMode / concurrent rendering, which
  // would either skip the fit or fit a render that never commits.
  useEffect(() => {
    if (trail.length > 1) {
      const bounds = latLngBounds(
        trail.map((p) => (Array.isArray(p) ? [p[0] as number, p[1] as number] as [number, number] : [0, 0] as [number, number])),
      );
      const sw = bounds.getSouthWest();
      const ne = bounds.getNorthEast();
      const spread = sw && ne ? Math.abs(ne.lat - sw.lat) + Math.abs(ne.lng - sw.lng) : 0;
      if (bounds.isValid() && spread > 1e-5) {
        map.fitBounds(bounds, { padding: [30, 30] });
      } else if (fallbackCenter) {
        map.setView(fallbackCenter, 15);
      }
    } else if (trail.length === 1) {
      map.setView(trail[0] as [number, number], 15);
    } else if (fallbackCenter) {
      map.setView(fallbackCenter, 15);
    }
  }, [map, trail.length, fallbackCenter?.[0], fallbackCenter?.[1]]);
  return null;
}

interface RouteMapSectionProps {
  drive: DriveDetail;
  trail: LatLngExpression[];
  startPos: [number, number] | undefined;
  endPos: [number, number] | undefined;
  centerPos: [number, number];
  speedSegments: SpeedSegment[];
}

export function RouteMapSection({ drive, trail, startPos, endPos, centerPos, speedSegments }: RouteMapSectionProps) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const toSpeedDisplay = (value: number) => convertSpeedFromSI(value, unitPrefs.speed);

  const speedUnit = unitPrefs.speed;
  const [mapStyle, setMapStyle] = useState<MapStyle>('dark');

  // Defensive null-safety: these are typed as required, but the parent derives
  // them from a query hook, so a partial/mid-fetch shape must never crash the
  // panel on `.length` / `.map`.
  const safeTrail = trail ?? [];
  const safeSegments = speedSegments ?? [];

  /* Stationary-GPS detection: positions exist but every recorded coord is
   * within ~10 m of the first. Render a single anchor marker + an overlay
   * banner instead of a polyline that collapses to a single dot at maxZoom. */
  const positionLatLngs = useMemo(
    () => (drive.positions ?? []).map((p) => ({
      latitude: typeof p.latitude === 'number' ? p.latitude : Number(p.latitude),
      longitude: typeof p.longitude === 'number' ? p.longitude : Number(p.longitude),
    })),
    [drive.positions],
  );
  const hasRoute = useMemo(() => hasMeaningfulRoute(positionLatLngs), [positionLatLngs]);
  const anchorIdx = useMemo(() => firstValidIndex(positionLatLngs), [positionLatLngs]);
  const anchorPoint: [number, number] | undefined = useMemo(() => {
    if (anchorIdx < 0) return undefined;
    const p = positionLatLngs[anchorIdx];
    return [p.latitude, p.longitude];
  }, [positionLatLngs, anchorIdx]);

  return (
    <FadeIn>
      <GlassPanel className="overflow-hidden">
        <div className="p-4 pb-0">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-3">
            <MapPin className="h-4 w-4 text-cyan-400" /> {t('driveDetail.route', 'Route')}
          </h3>
        </div>
        {safeTrail.length > 0 ? (
          <>
            <div className="h-64 sm:h-80 lg:h-96 relative" role="region" aria-label={t('driveDetail.routeMapLabel', 'Route map')}>
              <MapLayerSwitcher current={mapStyle} onChange={setMapStyle} />
              <MapContainer center={centerPos} zoom={safeTrail.length > 1 ? 13 : 3} scrollWheelZoom className="h-full w-full">
                <MapTileLayer style={mapStyle} />
                <MapInvalidator />
                <FitBounds trail={hasRoute ? safeTrail : []} fallbackCenter={anchorPoint} />
                {hasRoute && safeSegments.map((seg, i) => (
                  <Polyline key={i} positions={seg.positions} pathOptions={{ color: seg.color, weight: 4, opacity: 0.8 }} />
                ))}
                {hasRoute && startPos && (
                  <CircleMarker center={startPos} radius={8} pathOptions={{ color: '#10b981', fillColor: '#10b981', fillOpacity: 1, weight: 2 }}>
                    <Popup><span className="text-xs font-bold">{t('driveDetail.start', 'Start')}</span><br /><span className="text-xs">{formatDateTime(drive.startTs)}</span></Popup>
                  </CircleMarker>
                )}
                {hasRoute && endPos && (
                  <CircleMarker center={endPos} radius={8} pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 1, weight: 2 }}>
                    <Popup><span className="text-xs font-bold">{t('driveDetail.end', 'End')}</span><br /><span className="text-xs">{drive.endTs ? formatDateTime(drive.endTs) : t('driveDetail.inProgress', 'In progress')}</span></Popup>
                  </CircleMarker>
                )}
                {!hasRoute && anchorPoint && (
                  <CircleMarker center={anchorPoint} radius={8} pathOptions={{ color: '#22d3ee', fillColor: '#22d3ee', fillOpacity: 0.9, weight: 2 }}>
                    <Popup><span className="text-xs font-bold">{t('driveDetail.lastKnown', 'Last known location')}</span></Popup>
                  </CircleMarker>
                )}
              </MapContainer>
              {!hasRoute && (
                <div className="pointer-events-none absolute inset-x-3 top-3 z-[400]">
                  <AlertBanner
                    variant="info"
                    icon={<Navigation2 className="h-4 w-4" />}
                    title={t('driveDetail.stationaryRouteTitle', 'Route can\'t be plotted')}
                    className="pointer-events-auto"
                  >
                    {t(
                      'driveDetail.stationaryRouteBody',
                      'Only one GPS coordinate was recorded for this drive, so the route can\'t be drawn. The drive\'s distance, duration, and other stats below are unaffected.',
                    )}
                  </AlertBanner>
                </div>
              )}
            </div>
            <div className="flex items-center justify-between px-4 py-3 text-xs">
              <span className="flex items-center gap-1.5 text-green-400"><Flag className="h-3 w-3" /> {t('driveDetail.start', 'Start')}: {formatTime(drive.startTs)}</span>
              {hasRoute && safeTrail.length > 1 && (
                <div className="flex items-center gap-3 text-[var(--text-muted)]">
                  <span className="flex items-center gap-1"><span className="inline-block w-3 h-1 rounded bg-emerald-500" /> &lt;{fmtNumber(toSpeedDisplay(SPEED_SEGMENT_LOW_MPS))}</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-3 h-1 rounded bg-cyan-400" /> {fmtNumber(toSpeedDisplay(SPEED_SEGMENT_LOW_MPS))}–{fmtNumber(toSpeedDisplay(SPEED_SEGMENT_MED_MPS))}</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-3 h-1 rounded bg-amber-500" /> {fmtNumber(toSpeedDisplay(SPEED_SEGMENT_MED_MPS))}–{fmtNumber(toSpeedDisplay(SPEED_SEGMENT_HIGH_MPS))}</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-3 h-1 rounded bg-red-500" /> &gt;{fmtNumber(toSpeedDisplay(SPEED_SEGMENT_HIGH_MPS))}</span>
                  <span>{speedUnit}</span>
                </div>
              )}
              {drive.endTs && (
                <span className="flex items-center gap-1.5 text-red-400"><Flag className="h-3 w-3" /> {t('driveDetail.end', 'End')}: {formatTime(drive.endTs)}</span>
              )}
            </div>
          </>
        ) : (
          <div className="h-64 sm:h-80 flex flex-col items-center justify-center gap-3 text-[var(--text-muted)]">
            <MapPin className="h-10 w-10 opacity-30" />
            <p className="text-sm">{t('driveDetail.noRouteData', 'No route data available for this drive')}</p>
          </div>
        )}
      </GlassPanel>
    </FadeIn>
  );
}
