import { useTranslation } from 'react-i18next';
import { Navigation, MapPin, Flag } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { DateTime } from '@/components/data-display';
import { fmtNumber } from '@/lib/numberFormat';
import type { DriveDetail } from '@/types/driving';

interface JourneyDetailsPanelProps {
  drive: DriveDetail;
}

export function JourneyDetailsPanel({ drive }: JourneyDetailsPanelProps) {
  const { t } = useTranslation();

  return (
    <FadeIn>
      <GlassPanel className="p-5">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-4">
          <Navigation className="h-4 w-4 text-cyan-400" /> {t('driveDetail.journeyDetails', 'Journey Details')}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <div className="flex items-center gap-2 text-green-400 mb-1">
              <MapPin className="h-4 w-4" /> {t('driveDetail.start', 'Start')}
            </div>
            <p className="font-bold text-[var(--text-primary)] text-sm">
              {drive.startAddress
                ? drive.startAddress
                : drive.startLat && drive.startLon
                  ? <span className="font-mono">{fmtNumber(drive.startLat)}°{drive.startLat >= 0 ? 'N' : 'S'}, {fmtNumber(Math.abs(drive.startLon))}°{drive.startLon >= 0 ? 'E' : 'W'}</span>
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
              <Flag className="h-4 w-4" /> {t('driveDetail.destination', 'Destination')}
            </div>
            <p className="font-bold text-[var(--text-primary)] text-sm">
              {drive.endAddress
                ? drive.endAddress
                : drive.endLat && drive.endLon
                  ? <span className="font-mono">{fmtNumber(drive.endLat)}°{drive.endLat >= 0 ? 'N' : 'S'}, {fmtNumber(Math.abs(drive.endLon))}°{drive.endLon >= 0 ? 'E' : 'W'}</span>
                  : drive.endTs ? t('driveDetail.noAddress', 'No address data') : t('driveDetail.inProgress', 'In progress')}
            </p>
            <p className="text-xs text-[var(--text-muted)]">
              {drive.endTs
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
