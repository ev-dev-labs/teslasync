import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin, Navigation2 } from 'lucide-react';
import { GlassPanel, Text } from '@/components/ui';
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
import { useDateFormat } from '@/hooks/useDateFormat';

import { hasMeaningfulRoute, firstValidIndex, isGpsFix } from '@/lib/geo';
import type { DriveDetail } from '@/types/driving';
import type { FsdEvidenceInterval } from '@/types/fsd';
import type { RoutePoint, SpeedSegment } from './types';
import { SPEED_SEGMENT_LOW_MPS, SPEED_SEGMENT_MED_MPS, SPEED_SEGMENT_HIGH_MPS } from './constants';
import { convertSpeedFromSI } from '@/lib/unitConversion';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { chartTokens } from '@/lib/tokens';
import { cn } from '@/lib/cn';

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
  routePoints?: RoutePoint[];
  fsdEvidence?: FsdEvidenceInterval[];
  /** Render only the map body, filling its cell inside the Overview hero. */
  embedded?: boolean;
}

export function RouteMapSection({
  drive,
  trail,
  startPos,
  endPos,
  centerPos,
  speedSegments,
  routePoints,
  fsdEvidence,
  embedded = false,
}: RouteMapSectionProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const { formatDateTime } = useDateFormat();
  const { unitPrefs } = useUnits();
  const toSpeedDisplay = (value: number) => convertSpeedFromSI(value, unitPrefs.speed);

  const speedUnit = unitPrefs.speed;
  const [mapStyle, setMapStyle] = useState<MapStyle>('dark');

  // Defensive null-safety: these are typed as required, but the parent derives
  // them from a query hook, so a partial/mid-fetch shape must never crash the
  // panel on `.length` / `.map`.
  const safeTrail = trail ?? [];
  const safeSegments = speedSegments ?? [];
  const fsdSegments = useMemo(() => {
    const safeRoutePoints = routePoints ?? [];
    if (!fsdEvidence?.length || safeRoutePoints.length < 2) return [];
    const windows = fsdEvidence.map((interval) => ({
      start: Date.parse(interval.start_at),
      end: Date.parse(interval.end_at),
    })).filter((interval) => Number.isFinite(interval.start) && Number.isFinite(interval.end));

    const segments: LatLngExpression[][] = [];
    for (let index = 1; index < safeRoutePoints.length; index++) {
      const previous = safeRoutePoints[index - 1];
      const current = safeRoutePoints[index];
      const previousAt = previous.timestamp ? Date.parse(previous.timestamp) : Number.NaN;
      const currentAt = current.timestamp ? Date.parse(current.timestamp) : Number.NaN;
      if (!Number.isFinite(previousAt) || !Number.isFinite(currentAt)) continue;
      const segmentStart = Math.min(previousAt, currentAt);
      const segmentEnd = Math.max(previousAt, currentAt);
      if (windows.some((window) => window.start < segmentEnd && window.end > segmentStart)) {
        segments.push([[previous.lat, previous.lng], [current.lat, current.lng]]);
      }
    }
    return segments;
  }, [fsdEvidence, routePoints]);

  /* Stationary-GPS detection: positions exist but every recorded coord is
   * within ~10 m of the first. Render a single anchor marker + an overlay
   * banner instead of a polyline that collapses to a single dot at maxZoom. */
  const positionLatLngs = useMemo(
    () => (routePoints?.length ? routePoints.map((point) => ({
      latitude: point.lat, longitude: point.lng,
    })) : (drive.positions ?? [])
      // Drop the (0, 0) no-fix placeholder so it neither anchors nor stretches the route.
      .filter((p) => isGpsFix(p.latitude, p.longitude))
      .map((p) => ({
        latitude: p.latitude, longitude: p.longitude,
      }))),
    [drive.positions, routePoints],
  );
  const hasRoute = useMemo(() => hasMeaningfulRoute(positionLatLngs), [positionLatLngs]);
  const anchorIdx = useMemo(() => firstValidIndex(positionLatLngs), [positionLatLngs]);
  const anchorPoint: [number, number] | undefined = useMemo(() => {
    if (anchorIdx < 0) return undefined;
    const p = positionLatLngs[anchorIdx];
    return [p.latitude, p.longitude];
  }, [positionLatLngs, anchorIdx]);

  const endpointPins = useMemo(() => {
    const pins: Array<{ kind: 'start' | 'end'; position: [number, number] }> = [];
    if (isGpsFix(drive.startLat, drive.startLon)) pins.push({ kind: 'start', position: [drive.startLat as number, drive.startLon as number] });
    if (isGpsFix(drive.endLat, drive.endLon)) pins.push({ kind: 'end', position: [drive.endLat as number, drive.endLon as number] });
    return pins;
  }, [drive.startLat, drive.startLon, drive.endLat, drive.endLon]);
  const endpointTrail = useMemo<LatLngExpression[]>(() => endpointPins.map((pin) => pin.position), [endpointPins]);
  const mapHeight = embedded ? 'h-[320px] sm:h-[380px] lg:h-full lg:min-h-[440px]' : 'h-64 sm:h-80 lg:h-96';
  const startMarker = { color: chartTokens.series[1], fillColor: chartTokens.series[1], fillOpacity: 1, weight: 2 };
  const endMarker = { color: chartTokens.series[3], fillColor: chartTokens.series[3], fillOpacity: 1, weight: 2 };

  const body = safeTrail.length > 0 ? (
    <>
      <div className={cn(mapHeight, 'relative')} role="region" aria-label={t('driveDetail.routeMapLabel', 'Route map')} data-route-mode={hasRoute ? 'path' : 'stationary'}>
        <MapLayerSwitcher current={mapStyle} onChange={setMapStyle} />
        <MapContainer center={centerPos} zoom={safeTrail.length > 1 ? 13 : 3} scrollWheelZoom className="h-full w-full">
          <MapTileLayer style={mapStyle} />
          <MapInvalidator />
          <FitBounds trail={hasRoute ? safeTrail : []} fallbackCenter={anchorPoint} />
          {hasRoute && safeSegments.map((seg, i) => (
            <Polyline key={i} positions={seg.positions} pathOptions={{ color: seg.color, weight: 4, opacity: 0.8 }} />
          ))}
          {hasRoute && fsdSegments.map((positions, index) => (
            <Polyline
              key={`fsd-${index}`}
              positions={positions}
              pathOptions={{
                color: chartTokens.series[4],
                weight: 6,
                opacity: 0.9,
                dashArray: '8 10',
              }}
            />
          ))}
          {hasRoute && startPos && (
            <CircleMarker center={startPos} radius={8} pathOptions={{ color: chartTokens.series[1], fillColor: chartTokens.series[1], fillOpacity: 1, weight: 2 }}>
              <Popup><span className="text-xs font-bold">{t('driveDetail.start', 'Start')}</span><br /><time className="text-xs" dateTime={drive.startTs} title={drive.startTs}>{formatDateTime(drive.startTs)}</time></Popup>
            </CircleMarker>
          )}
          {hasRoute && endPos && (
            <CircleMarker center={endPos} radius={8} pathOptions={{ color: chartTokens.series[3], fillColor: chartTokens.series[3], fillOpacity: 1, weight: 2 }}>
              <Popup><span className="text-xs font-bold">{t('driveDetail.end', 'End')}</span><br /><time className="text-xs" dateTime={drive.endTs ?? undefined} title={drive.endTs ?? undefined}>{drive.endTs ? formatDateTime(drive.endTs) : t('driveDetail.inProgress', 'In progress')}</time></Popup>
            </CircleMarker>
          )}
          {!hasRoute && anchorPoint && (
            <CircleMarker center={anchorPoint} radius={8} pathOptions={{ color: chartTokens.series[0], fillColor: chartTokens.series[0], fillOpacity: 0.9, weight: 2 }}>
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
      {fsdSegments.length > 0 && (
        <div className="flex items-center gap-2 border-t border-[var(--border-default)] px-4 py-2 text-xs text-[var(--text-muted)]">
          <svg width="20" height="2" aria-hidden="true"><path d="M0 1H20" stroke={chartTokens.series[4]} strokeWidth={2} strokeDasharray="4 2" /></svg>
          {t(
            'driveDetail.fsd.mapEvidence',
            'Approximate area where the FSD counter increased - not an exact FSD-active segment.',
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs">
        {hasRoute && safeTrail.length > 1 && (
          <div className="flex flex-wrap items-center gap-3 text-[var(--text-muted)]">
            <span className="flex items-center gap-1"><svg width="12" height="4" aria-hidden="true"><rect width="12" height="4" rx="2" fill={chartTokens.series[1]} /></svg> &lt;{fmtNumber(toSpeedDisplay(SPEED_SEGMENT_LOW_MPS))}</span>
            <span className="flex items-center gap-1"><svg width="12" height="4" aria-hidden="true"><rect width="12" height="4" rx="2" fill={chartTokens.series[0]} /></svg> {fmtNumber(toSpeedDisplay(SPEED_SEGMENT_LOW_MPS))}–{fmtNumber(toSpeedDisplay(SPEED_SEGMENT_MED_MPS))}</span>
            <span className="flex items-center gap-1"><svg width="12" height="4" aria-hidden="true"><rect width="12" height="4" rx="2" fill={chartTokens.series[2]} /></svg> {fmtNumber(toSpeedDisplay(SPEED_SEGMENT_MED_MPS))}–{fmtNumber(toSpeedDisplay(SPEED_SEGMENT_HIGH_MPS))}</span>
            <span className="flex items-center gap-1"><svg width="12" height="4" aria-hidden="true"><rect width="12" height="4" rx="2" fill={chartTokens.series[3]} /></svg> ≥{fmtNumber(toSpeedDisplay(SPEED_SEGMENT_HIGH_MPS))}</span>
            <span>{speedUnit}</span>
          </div>
        )}
        {!embedded && <a href="#journey" className="text-[var(--text-secondary)] underline underline-offset-4">{t('driveDetail.journeyDetails', 'Journey details')}</a>}
      </div>
    </>
  ) : endpointPins.length > 0 ? (
    // No recorded route path, but start/end coordinates exist: show both
    // pins joined by a dashed straight line, clearly not a driven path.
    <div className={cn(mapHeight, 'relative')} role="region" aria-label={t('driveDetail.routeMapLabel', 'Route map')} data-route-mode="endpoints">
      <MapLayerSwitcher current={mapStyle} onChange={setMapStyle} />
      <MapContainer center={endpointPins[0].position} zoom={13} scrollWheelZoom className="h-full w-full">
        <MapTileLayer style={mapStyle} />
        <MapInvalidator />
        <FitBounds trail={endpointTrail} />
        {endpointPins.length === 2 && (
          <Polyline positions={endpointTrail} pathOptions={{ color: chartTokens.axisStroke, weight: 3, opacity: 0.8, dashArray: '6 8' }} />
        )}
        {/* marker-cluster:no exactly two semantic Start/End endpoints; clustering would hide route direction */}
        {endpointPins.map((pin) => (
          <CircleMarker key={pin.kind} center={pin.position} radius={8} pathOptions={pin.kind === 'start' ? startMarker : endMarker}>
            <Popup><span className="text-xs font-bold">{pin.kind === 'start' ? t('driveDetail.start', 'Start') : t('driveDetail.end', 'End')}</span></Popup>
          </CircleMarker>
        ))}
      </MapContainer>
      <div className="pointer-events-none absolute end-3 top-3 z-[400] flex items-center gap-2 rounded-full border border-[var(--border-default)] bg-[var(--surface-1)] px-3 py-1 shadow-sm" data-testid="route-not-recorded">
        <svg width="16" height="2" aria-hidden="true"><path d="M0 1H16" stroke={chartTokens.axisStroke} strokeWidth={2} strokeDasharray="4 3" /></svg>
        <Text as="span" variant="caption">{t('driveDetail.routeNotRecorded', 'Route path not recorded')}</Text>
      </div>
    </div>
  ) : (
    <div className={cn(mapHeight, 'flex flex-col items-center justify-center gap-3 text-[var(--text-muted)]')}>
      <MapPin className="h-10 w-10 opacity-30" />
      <p className="text-sm">{t('driveDetail.noRouteData', 'No route data available for this drive')}</p>
    </div>
  );

  if (embedded) {
    // h-full: the stretched hero cell gives the map a definite height to fill.
    return <div className="flex h-full min-w-0 flex-col" data-testid="drive-route-map">{body}</div>;
  }

  return (
    <FadeIn>
      <GlassPanel className="overflow-hidden">
        <div className="p-4 pb-0">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-3">
            <MapPin className="h-4 w-4 text-[var(--text-secondary)]" /> {t('driveDetail.route', 'Route')}
          </h3>
        </div>
        {body}
      </GlassPanel>
    </FadeIn>
  );
}
