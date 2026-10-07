import { AlertTriangle, CircleDot, Flag, PlayCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { RepairSuggestion } from '@/api/hooks/useDataRepair';
import { Timeline, type TimelineItemData } from '@/components/data-display';
import { formatDateTime } from '@/lib/dateFormat';

import { evidenceSourceLabel, sessionKindLabel } from './repairPresentation';

interface RepairEvidenceTimelineProps {
  suggestion: RepairSuggestion;
}

export function RepairEvidenceTimeline({ suggestion }: RepairEvidenceTimelineProps) {
  const { t } = useTranslation();
  const at = (iso: string): string => formatDateTime(iso);
  const items: TimelineItemData[] = [
    {
      icon: <PlayCircle className="h-3 w-3" aria-hidden="true" />,
      title: t('dataRepair.timeline.start', 'Session started'),
      subtitle: t('dataRepair.timeline.startDetail', 'Stored start of {{kind}} #{{id}}', {
        kind: sessionKindLabel(t, suggestion.kind),
        id: suggestion.session_id,
      }),
      time: at(suggestion.started_at),
    },
  ];

  const inSession = suggestion.last_in_session_evidence;
  items.push(
    inSession
      ? {
          icon: <CircleDot className="h-3 w-3" aria-hidden="true" />,
          title: t('dataRepair.timeline.lastInSession', 'Last evidence the session was still running'),
          subtitle: `${evidenceSourceLabel(t, inSession.source)} · ${inSession.field} = ${
            inSession.value || '—'
          }`,
          time: at(inSession.ts),
        }
      : {
          icon: <AlertTriangle className="h-3 w-3" aria-hidden="true" />,
          title: t('dataRepair.timeline.noInSession', 'No in-session evidence recorded'),
          subtitle: t(
            'dataRepair.timeline.noInSessionDetail',
            'Nothing durable was written between the session start and the contradiction.',
          ),
          time: '—',
        },
  );

  const contradiction = suggestion.contradicting_evidence;
  items.push(
    {
      icon: <AlertTriangle className="h-3 w-3" aria-hidden="true" />,
      title: t('dataRepair.timeline.contradiction', 'Contradicting evidence'),
      subtitle: `${evidenceSourceLabel(t, contradiction.source)} · ${contradiction.field} = ${
        contradiction.value || '—'
      }`,
      time: at(contradiction.ts),
    },
    {
      icon: <Flag className="h-3 w-3" aria-hidden="true" />,
      title: t('dataRepair.timeline.proposed', 'Proposed end'),
      subtitle: t('dataRepair.timeline.proposedDetail', 'Never later than the contradicting evidence'),
      time: at(suggestion.suggested_ended_at),
    },
  );

  return (
    <section
      aria-label={t('dataRepair.card.evidence', 'Evidence timeline')}
      className="rounded-lg bg-[var(--surface-2)] p-3"
    >
      <Timeline items={items} />
    </section>
  );
}
