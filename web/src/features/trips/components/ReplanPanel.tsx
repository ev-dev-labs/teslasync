import { useTranslation } from 'react-i18next';
import {
  useReplanAssessment,
  useRequestReplan,
  type JourneyDeviationVerdict,
  type JourneySession,
} from '@/api/hooks/useJourney';
import { useDataState } from '@/hooks/useDataState';
import { useUnits } from '@/hooks/useUnits';
import { Badge, Button, Text } from '@/components/ui';
import { LayoutCard, SourceContent } from '@/components/layout';
import { ErrorDisplay, ListSkeleton } from '@/components/feedback';
import { JourneyEvidenceList } from './continuation-mobility-trips-watch/JourneyEvidenceList';
import { StopScoreTable } from './StopScoreTable';
import { safeArray } from '@/lib/safeArray';

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
  const replanEvidence = safeArray(assessment?.evidence);

  const replan = useRequestReplan();
  const result = replan.data ?? null;

  return (
    <LayoutCard
      title={t('journey.replan.title', 'Replan')}
      actions={
        <Button
          wrapLabel
          variant="secondary"
          size="sm"
          loading={replan.isPending}
          disabled={assessment?.latest == null}
          onClick={() => replan.mutate({ id: session.id })}
        >
          {t('journey.replan.rescore', 'Rescore from here')}
        </Button>
      }
    >
      <SourceContent
        state={assessState.fatalError ? 'error' : assessQuery.isLoading && !assessState.hasData
          ? 'loading' : assessState.status === 'stale' ? 'retained' : assessment == null ? 'empty' : 'ready'}
        label={t('journey.replan.title', 'Replan')}
        emptyMessage={t('journey.replan.empty', 'No deviation reading yet.')}
        errorMessage={t('journey.replan.loadFailed', 'The route assessment could not be loaded.')}
        error={assessState.fatalError}
        errorRecovery={{ onRetry: assessState.retry ?? undefined }}
        loadingContent={<ListSkeleton label={t('journey.replan.loading', 'Measuring deviation…')} />}
      >
      {assessment != null ? (
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
          <JourneyEvidenceList evidence={replanEvidence} />
        </div>
      ) : (
        <Text as="p" variant="bodySm">{t('journey.replan.empty', 'No deviation reading yet.')}</Text>
      )}
      </SourceContent>

      {replan.error ? (
        <ErrorDisplay compact error={replan.error} message={t('journey.replan.rescoreFailed', 'Stops could not be rescored. Try rescoring again.')} />
      ) : null}
      {replan.isPending && !result ? (
        <ListSkeleton label={t('journey.replan.scoring', 'Rescoring stops…')} />
      ) : result ? (
        <div className="space-y-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge variant="success">
              {t('journey.scoring.winner', '{{site}} wins', { site: result.winner })}
            </Badge>
            <Text as="span" variant="caption">
              {t('journey.planVersion', 'v{{version}}', { version: result.plan_version })}
            </Text>
          </div>
          <StopScoreTable stops={safeArray(result.stops)} tableId="journey-replan-scores" />
        </div>
      ) : null}
    </LayoutCard>
  );
}
