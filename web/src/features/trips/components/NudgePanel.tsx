import { useTranslation } from 'react-i18next';
import { Icons } from '@/lib/icons';
import { useNudge, type JourneyNudgeVerdict, type JourneySession } from '@/api/hooks/useJourney';
import { useDataState } from '@/hooks/useDataState';
import { Badge, Text } from '@/components/ui';
import { ListSkeleton, QueryError } from '@/components/feedback';
import { formatDateTime } from '@/lib/dateFormat';

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

  return (
    <div className="space-y-4">
      <Text as="p" variant="label" className="flex items-center gap-2">
        <Icons.timer className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
        {t('journey.nudge.title', 'Leave now?')}
      </Text>

      {nudgeQuery.isLoading ? (
        <ListSkeleton label={t('journey.nudge.loading', 'Reading departure window…')} />
      ) : nudgeState.fatalError ? (
        <QueryError error={nudgeState.fatalError} onRetry={() => nudgeState.retry?.()} />
      ) : nudge == null ? (
        <Text as="p" size="sm" color="secondary">
          {t('journey.nudge.empty', 'No nudge yet.')}
        </Text>
      ) : (
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

          {nudge.blockers.length > 0 ? (
            <ul className="space-y-2">
              {nudge.blockers.map((item) => (
                <li
                  key={item.key}
                  className="flex items-start justify-between gap-3 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2"
                >
                  <Text as="p" variant="caption">
                    {item.detail}
                  </Text>
                  <Badge variant="danger">{t('journey.nudge.blocker', 'Blocker')}</Badge>
                </li>
              ))}
            </ul>
          ) : null}

          {nudge.evidence.length > 0 ? (
            <ul className="space-y-1">
              {nudge.evidence.map((line) => (
                <Text as="li" key={line} size="xs" color="muted">
                  · {line}
                </Text>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </div>
  );
}
