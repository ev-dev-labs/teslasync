import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin, Flag } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import {
  MapContainer, Polyline, CircleMarker, Popup, useMap,
  MapTileLayer, MapInvalidator, MapLayerSwitcher,
  type MapStyle,
} from '@/components/maps';
import { useSettings } from '@/hooks/useSettings';
import { formatTime, formatDateTime } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import { latLngBounds } from 'leaflet';
import type { LatLngExpression } from 'leaflet';
import type { DriveDetail } from '@/types/driving';
import type { SpeedSegment } from './types';

/* Auto-fit map bounds to trail */
function FitBounds({ trail }: { trail: LatLngExpression[] }) {
  const map = useMap();
  if (trail.length > 1) {
    const bounds = latLngBounds(
      trail.map((p) => (Array.isArray(p) ? [p[0] as number, p[1] as number] as [number, number] : [0, 0] as [number, number])),
    );
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [30, 30] });
  } else if (trail.length === 1) {
    map.setView(trail[0] as [number, number], 15);
  }
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
  const { convertSpeed, speedUnit } = useSettings();
  const [mapStyle, setMapStyle] = useState<MapStyle>('dark');

  return (
    <FadeIn>
      <GlassPanel className="overflow-hidden">
        <div className="p-4 pb-0">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-3">
            <MapPin className="h-4 w-4 text-cyan-400" /> {t('driveDetail.route', 'Route')}
          </h3>
        </div>
        {trail.length > 0 ? (
          <>
            <div className="h-64 sm:h-80 lg:h-96 relative">
              <MapLayerSwitcher current={mapStyle} onChange={setMapStyle} />
              <MapContainer center={centerPos} zoom={trail.length > 1 ? 13 : 3} scrollWheelZoom className="h-full w-full">
                <MapTileLayer style={mapStyle} />
                <MapInvalidator />
                <FitBounds trail={trail} />
                {speedSegments.map((seg, i) => (
                  <Polyline key={i} positions={seg.positions} pathOptions={{ color: seg.color, weight: 4, opacity: 0.8 }} />
                ))}
                {startPos && (
                  <CircleMarker center={startPos} radius={8} pathOptions={{ color: '#10b981', fillColor: '#10b981', fillOpacity: 1, weight: 2 }}>
                    <Popup><span className="text-xs font-bold">{t('driveDetail.start', 'Start')}</span><br /><span className="text-xs">{formatDateTime(drive.startDate)}</span></Popup>
                  </CircleMarker>
                )}
                {endPos && (
                  <CircleMarker center={endPos} radius={8} pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 1, weight: 2 }}>
                    <Popup><span className="text-xs font-bold">{t('driveDetail.end', 'End')}</span><br /><span className="text-xs">{drive.endDate ? formatDateTime(drive.endDate) : t('driveDetail.inProgress', 'In progress')}</span></Popup>
                  </CircleMarker>
                )}
              </MapContainer>
            </div>
            <div className="flex items-center justify-between px-4 py-3 text-xs">
              <span className="flex items-center gap-1.5 text-green-400"><Flag className="h-3 w-3" /> {t('driveDetail.start', 'Start')}: {formatTime(drive.startDate)}</span>
              {trail.length > 1 && (
                <div className="flex items-center gap-3 text-[var(--text-muted)]">
                  <span className="flex items-center gap-1"><span className="inline-block w-3 h-1 rounded bg-emerald-500" /> &lt;{fmtNumber(convertSpeed(30))}</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-3 h-1 rounded bg-cyan-400" /> {fmtNumber(convertSpeed(30))}–{fmtNumber(convertSpeed(60))}</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-3 h-1 rounded bg-amber-500" /> {fmtNumber(convertSpeed(60))}–{fmtNumber(convertSpeed(100))}</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-3 h-1 rounded bg-red-500" /> &gt;{fmtNumber(convertSpeed(100))}</span>
                  <span>{speedUnit}</span>
                </div>
              )}
              {drive.endDate && (
                <span className="flex items-center gap-1.5 text-red-400"><Flag className="h-3 w-3" /> {t('driveDetail.end', 'End')}: {formatTime(drive.endDate)}</span>
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
