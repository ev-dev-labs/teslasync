import { useTranslation } from 'react-i18next';
import { Navigation, MapPin, Flag } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { useSettings } from '@/hooks/useSettings';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import type { DriveDetail } from '@/types/driving';

interface JourneyDetailsPanelProps {
  drive: DriveDetail;
}

export function JourneyDetailsPanel({ drive }: JourneyDetailsPanelProps) {
  const { t } = useTranslation();
  const { convertDistance, distanceUnit } = useSettings();

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
                : drive.startLatitude && drive.startLongitude
                  ? <span className="font-mono">{fmtNumber(drive.startLatitude)}°{drive.startLatitude >= 0 ? 'N' : 'S'}, {fmtNumber(Math.abs(drive.startLongitude))}°{drive.startLongitude >= 0 ? 'E' : 'W'}</span>
                  : t('driveDetail.noAddress', 'No address data')}
            </p>
            <p className="text-xs text-[var(--text-muted)]">{formatDateTime(drive.startDate)}</p>
            <p className="text-xs text-[var(--text-secondary)]">
              {t('driveDetail.battery', 'Battery')}: {drive.startBatteryLevel ?? '?'}%
              {drive.startRangeKm != null && (
                <> · {t('driveDetail.range', 'Range')}: {fmtNumber(convertDistance(drive.startRangeKm))} {distanceUnit}</>
              )}
            </p>
          </div>
          <div>
            <div className="flex items-center gap-2 text-red-400 mb-1">
              <Flag className="h-4 w-4" /> {t('driveDetail.destination', 'Destination')}
            </div>
            <p className="font-bold text-[var(--text-primary)] text-sm">
              {drive.endAddress
                ? drive.endAddress
                : drive.endLatitude && drive.endLongitude
                  ? <span className="font-mono">{fmtNumber(drive.endLatitude)}°{drive.endLatitude >= 0 ? 'N' : 'S'}, {fmtNumber(Math.abs(drive.endLongitude))}°{drive.endLongitude >= 0 ? 'E' : 'W'}</span>
                  : drive.endDate ? t('driveDetail.noAddress', 'No address data') : t('driveDetail.inProgress', 'In progress')}
            </p>
            <p className="text-xs text-[var(--text-muted)]">{drive.endDate ? formatDateTime(drive.endDate) : t('driveDetail.inProgress', 'In progress')}</p>
            <p className="text-xs text-[var(--text-secondary)]">
              {t('driveDetail.battery', 'Battery')}: {drive.endBatteryLevel ?? '?'}%
              {drive.endRangeKm != null && (
                <> · {t('driveDetail.range', 'Range')}: {fmtNumber(convertDistance(drive.endRangeKm))} {distanceUnit}</>
              )}
            </p>
          </div>
        </div>
      </GlassPanel>
    </FadeIn>
  );
}
