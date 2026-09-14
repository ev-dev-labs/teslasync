import { useTranslation } from 'react-i18next';
import { Icons } from '@/lib/icons';
import {
  useReplanAssessment,
  useRequestReplan,
  type JourneyDeviationVerdict,
  type JourneySession,
} from '@/api/hooks/useJourney';
import { useDataState } from '@/hooks/useDataState';
import { useUnits } from '@/hooks/useUnits';
import { Badge, Button, Text } from '@/components/ui';
import { ListSkeleton, QueryError } from '@/components/feedback';
import { StopScoreTable } from './StopScoreTable';

const VERDICT_LABEL_KEYS: Record<JourneyDeviationVerdict, string> = {
  on_track: 'journey.replan.verdict.on_track',
  drifted: 'journey.replan.verdict.drifted',
  off_route: 'journey.replan.verdict.off_route',
  unknown: 'journey.replan.verdict.unknown',
};

const VERDICT_DEFAULTS: Record<JourneyDeviationVerdict, string> = {
  on_track: 'On track',
  drifted: 'Drifting',
  off_route: 'Off route',
  unknown: 'Unknown',
};

function verdictVariant(verdict: JourneyDeviationVerdict) {
  switch (verdict) {
    case 'on_track':
      return 'success' as const;
    case 'drifted':
      return 'warning' as const;
    case 'off_route':
      return 'danger' as const;
    default:
      return 'neutral' as const;
  }
}

/**
 * Replan engine: corridor-deviation verdict from the latest fix, with
 * one-click rescoring of the saved candidates from the current
 * position. The rescore persists a replan version and refreshes the
 * live view's next stop.
 */
export function ReplanPanel({ session }: { session: JourneySession }) {
  const { t } = useTranslation();
  const units = useUnits();

  const assessQuery = useReplanAssessment(session.id);
  const assessState = useDataState(assessQuery);
  const assessment = assessQuery.data ?? null;

  const replan = useRequestReplan();
  const result = replan.data ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Text as="p" variant="label" className="flex items-center gap-2">
          <Icons.refresh className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('journey.replan.title', 'Replan')}
        </Text>
        <Button
          variant="secondary"
          size="sm"
          loading={replan.isPending}
          disabled={assessment?.latest == null}
          onClick={() => replan.mutate({ id: session.id })}
        >
          {t('journey.replan.rescore', 'Rescore from here')}
        </Button>
      </div>

      {assessQuery.isLoading ? (
        <ListSkeleton label={t('journey.replan.loading', 'Measuring deviation…')} />
      ) : assessState.fatalError ? (
        <QueryError error={assessState.fatalError} onRetry={() => assessState.retry?.()} />
      ) : assessment == null ? (
        <Text as="p" size="sm" color="secondary">
          {t('journey.replan.empty', 'No deviation reading yet.')}
        </Text>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={verdictVariant(assessment.deviation.verdict)}>
              {t(
                VERDICT_LABEL_KEYS[assessment.deviation.verdict],
                VERDICT_DEFAULTS[assessment.deviation.verdict],
              )}
            </Badge>
            {assessment.deviation.deviation_m != null ? (
              <Text as="p" variant="caption" className="tabular-nums">
                {t('journey.replan.offBy', '{{distance}} off corridor', {
                  distance: units.formatDistance(assessment.deviation.deviation_m),
                })}
              </Text>
            ) : null}
          </div>
          {assessment.evidence.length > 0 ? (
            <ul className="space-y-1">
              {assessment.evidence.map((line) => (
                <Text as="li" key={line} size="xs" color="muted">
                  · {line}
                </Text>
              ))}
            </ul>
          ) : null}
        </div>
      )}

      {replan.isPending ? (
        <ListSkeleton label={t('journey.replan.scoring', 'Rescoring stops…')} />
      ) : result ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Badge variant="success">
              {t('journey.scoring.winner', '{{site}} wins', { site: result.winner })}
            </Badge>
            <Text as="span" variant="caption">
              {t('journey.planVersion', 'v{{version}}', { version: result.plan_version })}
            </Text>
          </div>
          <StopScoreTable stops={result.stops} tableId="journey-replan-scores" />
        </div>
      ) : null}
    </div>
  );
}
