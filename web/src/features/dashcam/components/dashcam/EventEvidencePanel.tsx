import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui';
import { LayoutCard } from '@/components/layout';
import { Timeline } from '@/components/data-display';
import type { TimelineItemData } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import type { ClipRecord } from '../../lib/types';
import { CONFIDENCE_BADGE_VARIANT, EVENT_TYPE_LABELS } from './constants';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export interface EventEvidencePanelProps {
  clip: ClipRecord;
}

/**
 * Displays every locally-derived event candidate for a clip, each with its
 * confidence tier and an honest, human-readable `basis` — the exact
 * metadata/telemetry/motion evidence that produced it. No entry here
 * implies computer-vision object detection unless a `basis` string says so
 * (and none of this feature's candidates ever do).
 */
export function EventEvidencePanel({ clip }: EventEvidencePanelProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();

  if (clip.eventCandidates.length === 0) {
    return (
      <LayoutCard title={t('dashcam.events.title', 'Event evidence')}>
        {/* no-action: three disjoint recovery paths (import metadata, run motion analysis, or switch to Reconstruction tab) live outside this component with no single handler in scope here. */}
        <EmptyState
          icon={<AlertTriangle className="h-8 w-8" />}
          title={t('dashcam.events.emptyTitle', 'No event candidates yet')}
          message={t(
            'dashcam.events.emptyMessage',
            'Import metadata (event.json / folder), run local motion analysis, or connect telemetry in the Reconstruction tab to derive event candidates.',
          )}
        />
      </LayoutCard>
    );
  }

  const items: TimelineItemData[] = clip.eventCandidates.map((candidate) => ({
    title: (
      <span className="flex min-w-0 flex-wrap items-center gap-2">
        {t(`dashcam.events.type.${candidate.type}`, EVENT_TYPE_LABELS[candidate.type])}
        <Badge size="sm" variant={CONFIDENCE_BADGE_VARIANT[candidate.confidence]}>
          {t(`dashcam.events.confidence.${candidate.confidence}`, candidate.confidence)}
        </Badge>
      </span>
    ),
    subtitle: candidate.basis.join(' — '),
    time:
      candidate.atSeconds != null
        ? t('dashcam.events.atSeconds', 't={{seconds}}s', { seconds: fmtNumber(candidate.atSeconds) })
        : t('dashcam.events.wholeClip', 'whole clip'),
  }));

  return (
    <LayoutCard title={t('dashcam.events.title', 'Event evidence')}>
      <Timeline items={items} label={t('dashcam.events.title', 'Event evidence')} summaryBounds={{}} />
    </LayoutCard>
  );
}
