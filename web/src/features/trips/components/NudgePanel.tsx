import { useTranslation } from 'react-i18next';
import { useNudge, type JourneyNudgeVerdict, type JourneySession } from '@/api/hooks/useJourney';
import { useDataState } from '@/hooks/useDataState';
import { Badge, Text } from '@/components/ui';
import { KVList } from '@/components/data-display';
import { LayoutCard, SourceContent } from '@/components/layout';
import { ListSkeleton } from '@/components/feedback';
import { JourneyEvidenceList } from './continuation-mobility-trips-watch/JourneyEvidenceList';
import { formatDateTime } from '@/lib/dateFormat';
import { safeArray } from '@/lib/safeArray';

const VERDICT_LABEL_KEYS: Record<JourneyNudgeVerdict, string> = {
  leave_now: 'journey.nudge.verdict.leave_now',
  wait: 'journey.nudge.verdict.wait',
  delay: 'journey.nudge.verdict.delay',
  unknown: 'journey.nudge.verdict.unknown',
};

const VERDICT_DEFAULTS: Record<JourneyNudgeVerdict, string> = {
  leave_now: 'Leave now',
  wait: 'Wait',
  delay: 'Delay',
  unknown: 'Unknown',
};

function verdictVariant(verdict: JourneyNudgeVerdict) {
  switch (verdict) {
    case 'leave_now':
      return 'success' as const;
    case 'wait':
      return 'warning' as const;
    case 'delay':
      return 'danger' as const;
    default:
      return 'neutral' as const;
  }
}

/**
 * Leave-now nudge: one verdict from the calm-hour ranking plus the
 * readiness blockers. Read-only — the verdict refreshes when the
 * checklist re-runs and on the ambient operational tick.
 */
export function NudgePanel({ session }: { session: JourneySession }) {
  const { t } = useTranslation();

  const nudgeQuery = useNudge(session.id);
  const nudgeState = useDataState(nudgeQuery);
  const nudge = nudgeQuery.data ?? null;
  const blockers = safeArray(nudge?.blockers);
  const evidence = safeArray(nudge?.evidence);

  return (
    <LayoutCard title={t('journey.nudge.title', 'Leave now?')}>
      <SourceContent
        state={nudgeState.fatalError ? 'error' : nudgeQuery.isLoading && !nudgeState.hasData
          ? 'loading' : nudgeState.status === 'stale' ? 'retained' : nudge == null ? 'empty' : 'ready'}
        label={t('journey.nudge.title', 'Leave now?')}
        emptyMessage={t('journey.nudge.empty', 'No nudge yet.')}
        errorMessage={t('journey.nudge.loadFailed', 'The departure nudge could not be loaded.')}
        error={nudgeState.fatalError}
        errorRecovery={{ onRetry: nudgeState.retry ?? undefined }}
        loadingContent={<ListSkeleton label={t('journey.nudge.loading', 'Reading departure window…')} />}
      >
      {nudge != null ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={verdictVariant(nudge.verdict)}>
              {t(VERDICT_LABEL_KEYS[nudge.verdict], VERDICT_DEFAULTS[nudge.verdict])}
            </Badge>
            {nudge.slot_at != null ? (
              <Text as="p" variant="caption" className="tabular-nums">
                {t('journey.nudge.slot', 'calm {{time}}', {
                  time: formatDateTime(nudge.slot_at),
                })}
              </Text>
            ) : null}
          </div>

          {blockers.length > 0 ? (
            <KVList
              layout="responsive"
              items={blockers.map((item) => ({
                id: item.key,
                label: item.detail,
                value: <Badge variant="danger">{t('journey.nudge.blocker', 'Blocker')}</Badge>,
              }))}
            />
          ) : null}

          <JourneyEvidenceList evidence={evidence} />
        </div>
      ) : (
        <Text as="p" variant="bodySm">{t('journey.nudge.empty', 'No nudge yet.')}</Text>
      )}
      </SourceContent>
    </LayoutCard>
  );
}
