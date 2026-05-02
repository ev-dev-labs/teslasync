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

  return (
    <FadeIn>
      <div className="flex items-center gap-4">
        <Link to="/drives" className="rounded-xl p-2.5 text-[var(--text-muted)] hover:bg-white/5 hover:text-[var(--text-primary)] transition-all">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)] flex items-center gap-3">
            <Route className="h-6 w-6 text-cyan-400" />
            {drive.startAddress && drive.endAddress
              ? <>{drive.startAddress} → {drive.endAddress}</>
              : t('driveDetail.title', 'Drive Details')}
          </h1>
          <p className="text-sm text-[var(--text-muted)] mt-0.5">
            {vehicleName} · <DateTime value={drive.startTs} variant="date" in="vehicle" />
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
          <Button variant="ghost" size="sm" icon={<Play className="h-4 w-4" />}>
            {t('driveDetail.replay', 'Replay')}
          </Button>
        </Link>
        <Button variant="ghost" size="sm" onClick={onShare} icon={<Share2 className="h-4 w-4" />}>
          {t('driveDetail.share', 'Share')}
        </Button>
      </div>
    </FadeIn>
  );
}
