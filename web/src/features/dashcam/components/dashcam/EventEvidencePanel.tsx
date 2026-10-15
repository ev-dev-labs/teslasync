import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui';
import { LayoutCard } from '@/components/layout';
import { Timeline } from '@/components/data-display';
import type { TimelineItemData } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import type { ClipRecord } from '../../lib/types';
import { eventBasisMessages } from '../../lib/eventDetection';
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
        {/* Metadata import and motion analysis live outside this component; Reconstruction is a separate read-only surface. */}
        <EmptyState
          icon={<AlertTriangle className="h-8 w-8" />}
          title={t('dashcam.events.emptyTitle', 'No event candidates yet')}
          message={t(
            'dashcam.events.emptyMessage',
            'Import metadata (event.json / folder) or run local motion analysis to derive clip event candidates. View telemetry-derived incidents separately in the Reconstruction tab; they are not added to this clip’s event evidence.',
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
    subtitle: eventBasisMessages(candidate).map((message) =>
      typeof message === 'string'
        ? message
        : t(message.key, message.defaultValue, {
          ...message.values,
          interpolation: { escapeValue: false },
        }),
    ).join(' — '),
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
