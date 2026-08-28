import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Route, Play, Share2 } from 'lucide-react';
import { Button } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { DateTime } from '@/components/data-display';
import type { DriveDetail } from '@/types/driving';

interface DriveDetailHeaderProps {
  drive: DriveDetail;
  driveId: string;
  vehicleName: string;
  onShare: () => void;
}

export function DriveDetailHeader({ drive, driveId, vehicleName, onShare }: DriveDetailHeaderProps) {
  const { t } = useTranslation();

  const hasRoute = Boolean(drive.startAddress && drive.endAddress);
  // Guard against an empty / whitespace-only vehicle name so the meta line
  // never renders a dangling leading separator ("· 4 Jul …").
  const displayVehicle = vehicleName.trim() ? vehicleName : t('driveDetail.vehicle', 'Vehicle');

  return (
    <FadeIn>
      <div className="flex items-center gap-4">
        <Link
          to="/drives"
          aria-label={t('driveDetail.backToDrives', 'Back to drives')}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl p-2.5 text-[var(--text-muted)] transition-all hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1
            className="text-2xl font-bold tracking-tight text-[var(--text-primary)] flex items-center gap-3 outline-none"
            tabIndex={-1}
            data-route-focus-target="true"
          >
            <Route className="h-6 w-6 shrink-0 text-cyan-400" aria-hidden="true" />
            {hasRoute
              ? <>{drive.startAddress} → {drive.endAddress}</>
              : t('driveDetail.title', 'Drive Details')}
          </h1>
          <p className="text-sm text-[var(--text-muted)] mt-0.5">
            {displayVehicle} · <DateTime value={drive.startTs} variant="date" in="vehicle" />
            {' · '}
            <DateTime value={drive.startTs} variant="time" in="vehicle" showTz />
            {drive.endTs && (
              <>
                {' → '}
                <DateTime value={drive.endTs} variant="time" in="vehicle" />
              </>
            )}
          </p>
        </div>
        <Link to={`/drives/${driveId}/replay`}>
          <Button variant="ghost" size="sm" icon={<Play className="h-4 w-4" aria-hidden="true" />}>
            {t('driveDetail.replay', 'Replay')}
          </Button>
        </Link>
        <Button variant="ghost" size="sm" onClick={onShare} icon={<Share2 className="h-4 w-4" aria-hidden="true" />}>
          {t('driveDetail.share', 'Share')}
        </Button>
      </div>
    </FadeIn>
  );
}
