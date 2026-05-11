import { useTranslation } from 'react-i18next';
import { Flag } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { formatTime } from '@/lib/dateFormat';
import { formatDuration } from './helpers';
import type { DriveDetail } from '@/types/driving';

interface DriveTimelineProps {
  drive: DriveDetail;
}

export function DriveTimeline({ drive }: DriveTimelineProps) {
  const { t } = useTranslation();

  return (
    <FadeIn>
      <GlassPanel className="p-4">
        <div className="flex items-center justify-between text-xs text-[var(--text-secondary)] mb-2">
          <span className="flex items-center gap-1 text-green-400">
            <Flag className="h-3 w-3" />{formatTime(drive.startTs)}
          </span>
          <span className="text-[var(--text-muted)]">{formatDuration((drive.durationS) / 60)}</span>
          <span className="flex items-center gap-1 text-red-400">
            <Flag className="h-3 w-3" />{drive.endTs ? formatTime(drive.endTs) : t('driveDetail.inProgress', 'In progress')}
          </span>
        </div>
        <div className="h-3 rounded-full overflow-hidden bg-[var(--surface-2)]">
          <div className="h-full w-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-400" />
        </div>
      </GlassPanel>
    </FadeIn>
  );
}
