import { useTranslation } from 'react-i18next';
import { Flag } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { formatTime } from '@/lib/dateFormat';
import { formatDuration } from './helpers';
import type { DriveDetail } from '@/types/driving';
import { VisuallyHidden } from '@/components/a11y';

interface DriveTimelineProps {
  drive: DriveDetail;
}

/**
 * Compact "start → duration → end" ribbon for a single drive.
 *
 * Times render in the user's locale via `formatTime` (which already degrades
 * nullish/invalid timestamps to an em-dash). The duration is derived from the
 * SI-canonical `durationS`, guarded so a malformed payload (missing or negative
 * seconds) can never surface "NaNm" or a negative label. Colour alone does not
 * carry the start/end meaning: each marker is prefixed with visually-hidden
 * text and the container is exposed as a labelled group so assistive tech
 * announces "Started at … / Duration … / Ended at …".
 */
export function DriveTimeline({ drive }: DriveTimelineProps) {
  const { t } = useTranslation();

  const startLabel = formatTime(drive.startTs);
  const inProgress = !drive.endTs;
  const endLabel = inProgress
    ? t('driveDetail.inProgress', 'In progress')
    : formatTime(drive.endTs);
  // Guard the SI seconds → minutes conversion: a null/undefined `durationS`
  // (bad payload) would divide to NaN and render "NaNm", and a negative value
  // would render a nonsensical label. Clamp to a non-negative number first.
  const durationLabel = formatDuration(Math.max(0, (drive.durationS ?? 0) / 60));

  return (
    <FadeIn>
      <GlassPanel className="p-4">
        <div
          role="group"
          aria-label={t('driveDetail.timeline.label', 'Drive timeline')}
          className="flex items-center justify-between text-xs text-[var(--text-secondary)] mb-2"
        >
          <span className="flex items-center gap-1 text-green-400">
            <Flag className="h-3 w-3" aria-hidden="true" />
            <VisuallyHidden>{t('driveDetail.timeline.startedAt', 'Started at ')}</VisuallyHidden>
            <span>{startLabel}</span>
          </span>
          <span className="text-[var(--text-muted)]">
            <VisuallyHidden>
              {t('driveDetail.timeline.durationPrefix', 'Duration ')}
            </VisuallyHidden>
            <span>{durationLabel}</span>
          </span>
          <span className="flex items-center gap-1 text-red-400">
            <Flag className="h-3 w-3" aria-hidden="true" />
            <VisuallyHidden>
              {inProgress
                ? t('driveDetail.timeline.statusPrefix', 'Status ')
                : t('driveDetail.timeline.endedAt', 'Ended at ')}
            </VisuallyHidden>
            <span>{endLabel}</span>
          </span>
        </div>
        <div
          aria-hidden="true"
          className="h-3 rounded-full overflow-hidden bg-[var(--surface-2)]"
        >
          <div className="h-full w-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-400" />
        </div>
      </GlassPanel>
    </FadeIn>
  );
}
