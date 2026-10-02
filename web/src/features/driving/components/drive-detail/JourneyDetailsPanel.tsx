import { useTranslation } from 'react-i18next';
import { Navigation, MapPin, Flag } from 'lucide-react';
import { GlassPanel, PanelTitle, Table } from '@/components/ui';
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
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="flex items-center gap-2 mb-4">
          <Navigation className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" /> {t('driveDetail.journeyDetails', 'Journey details')}
        </PanelTitle>
        <Table className="table-fixed [&_td]:break-words [&_td]:[overflow-wrap:anywhere]" aria-label={t('driveDetail.timeline.label', 'Drive timeline')}>
          <thead><tr>
            <th scope="col"><span className="inline-flex items-center gap-2"><MapPin className="h-4 w-4" aria-hidden="true" />{t('driveDetail.start', 'Start')}</span></th>
            <th scope="col"><span className="inline-flex items-center gap-2"><Flag className="h-4 w-4" aria-hidden="true" />{t('driveDetail.destination', 'Destination')}</span></th>
          </tr></thead>
          <tbody><tr><td className="align-top">
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
            {drive.startAddress && startCoords ? <p className="mt-1 font-mono text-xs text-[var(--text-muted)]">{startCoords}</p> : null}
            <p className="mt-2 text-xs text-[var(--text-secondary)]">{t('driveDetail.battery', 'Battery')}: {drive.startBatteryPct != null ? `${fmtNumber(drive.startBatteryPct)}%` : '—'}</p>
          </td><td className="align-top">
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
              {t('driveDetail.battery', 'Battery')}: {drive.endBatteryPct != null ? `${fmtNumber(drive.endBatteryPct)}%` : '—'}
            </p>
            {drive.endAddress && endCoords ? <p className="mt-1 font-mono text-xs text-[var(--text-muted)]">{endCoords}</p> : null}
          </td></tr></tbody>
        </Table>
      </GlassPanel>
    </FadeIn>
  );
}
