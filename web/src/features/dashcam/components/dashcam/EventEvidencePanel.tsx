import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { GlassPanel, Badge } from '@/components/ui';
import { Timeline } from '@/components/data-display';
import type { TimelineItemData } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import type { ClipRecord } from '../../lib/types';
import { CONFIDENCE_BADGE_VARIANT, EVENT_TYPE_LABELS } from './constants';

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
  const { t } = useTranslation();

  if (clip.eventCandidates.length === 0) {
    return (
      <GlassPanel padding="md">
        <EmptyState
          icon={<AlertTriangle className="h-8 w-8" />}
          title={t('dashcam.events.emptyTitle', 'No event candidates yet')}
          message={t(
            'dashcam.events.emptyMessage',
            'Import metadata (event.json / folder), run local motion analysis, or connect telemetry in the Reconstruction tab to derive event candidates.',
          )}
        />
      </GlassPanel>
    );
  }

  const items: TimelineItemData[] = clip.eventCandidates.map((candidate) => ({
    title: (
      <span className="flex items-center gap-2">
        {EVENT_TYPE_LABELS[candidate.type]}
        <Badge size="sm" variant={CONFIDENCE_BADGE_VARIANT[candidate.confidence]}>
          {t(`dashcam.events.confidence.${candidate.confidence}`, candidate.confidence)}
        </Badge>
      </span>
    ),
    subtitle: candidate.basis.join(' — '),
    time:
      candidate.atSeconds != null
        ? t('dashcam.events.atSeconds', 't={{seconds}}s', { seconds: candidate.atSeconds.toFixed(1) })
        : t('dashcam.events.wholeClip', 'whole clip'),
  }));

  return (
    <GlassPanel padding="md" className="space-y-2">
      <h3 className="text-sm font-semibold text-[var(--text-primary)]">
        {t('dashcam.events.title', 'Event evidence')}
      </h3>
      <Timeline items={items} />
    </GlassPanel>
  );
}
