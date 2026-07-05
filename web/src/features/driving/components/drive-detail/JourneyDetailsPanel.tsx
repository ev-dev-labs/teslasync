import { useTranslation } from 'react-i18next';
import { Navigation, MapPin, Flag } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { DateTime } from '@/components/data-display';
import { fmtNumber, isFiniteNumber } from '@/lib/numberFormat';
import type { DriveDetail } from '@/types/driving';

interface JourneyDetailsPanelProps {
  drive: DriveDetail;
}

/**
 * Format a latitude/longitude pair as a hemisphere-suffixed decimal string,
 * e.g. `37.77°N, 122.42°W`. Returns `null` when either component is missing or
 * non-finite so the caller can fall back to an address / empty label.
 *
 * Two correctness guards live here:
 *  - a finite-number check (not a truthy test) so a legitimate `0°` coordinate
 *    — the equator or the prime meridian — renders instead of being silently
 *    dropped as "no data";
 *  - `Math.abs` on BOTH components so the hemisphere letter is never
 *    contradicted by a redundant leading minus sign (e.g. `-37.77°S`).
 */
export function formatCoordinates(
  lat: number | null | undefined,
  lon: number | null | undefined,
): string | null {
  if (!isFiniteNumber(lat) || !isFiniteNumber(lon)) return null;
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${fmtNumber(Math.abs(lat))}°${ns}, ${fmtNumber(Math.abs(lon))}°${ew}`;
}

export function JourneyDetailsPanel({ drive }: JourneyDetailsPanelProps) {
  const { t } = useTranslation();

  const startCoords = formatCoordinates(drive.startLat, drive.startLon);
  const endCoords = formatCoordinates(drive.endLat, drive.endLon);
  const hasEnded = Boolean(drive.endTs);

  return (
    <FadeIn>
      <GlassPanel className="p-5">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-4">
          <Navigation className="h-4 w-4 text-cyan-400" aria-hidden="true" /> {t('driveDetail.journeyDetails', 'Journey Details')}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <div className="flex items-center gap-2 text-green-400 mb-1">
              <MapPin className="h-4 w-4" aria-hidden="true" /> {t('driveDetail.start', 'Start')}
            </div>
            <p className="font-bold text-[var(--text-primary)] text-sm">
              {drive.startAddress
                ? drive.startAddress
                : startCoords
                  ? <span className="font-mono">{startCoords}</span>
                  : t('driveDetail.noAddress', 'No address data')}
            </p>
            <p className="text-xs text-[var(--text-muted)]">
              <DateTime value={drive.startTs} in="vehicle" />
            </p>
            <p className="text-xs text-[var(--text-secondary)]">
              {t('driveDetail.battery', 'Battery')}: {drive.startBatteryPct ?? '?'}%
            </p>
          </div>
          <div>
            <div className="flex items-center gap-2 text-red-400 mb-1">
              <Flag className="h-4 w-4" aria-hidden="true" /> {t('driveDetail.destination', 'Destination')}
            </div>
            <p className="font-bold text-[var(--text-primary)] text-sm">
              {drive.endAddress
                ? drive.endAddress
                : endCoords
                  ? <span className="font-mono">{endCoords}</span>
                  : hasEnded ? t('driveDetail.noAddress', 'No address data') : t('driveDetail.inProgress', 'In progress')}
            </p>
            <p className="text-xs text-[var(--text-muted)]">
              {hasEnded
                ? <DateTime value={drive.endTs} in="vehicle" />
                : t('driveDetail.inProgress', 'In progress')}
            </p>
            <p className="text-xs text-[var(--text-secondary)]">
              {t('driveDetail.battery', 'Battery')}: {drive.endBatteryPct ?? '?'}%
            </p>
          </div>
        </div>
      </GlassPanel>
    </FadeIn>
  );
}
