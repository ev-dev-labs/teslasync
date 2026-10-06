import { useTranslation } from 'react-i18next';
import { MapPin, BatteryCharging } from 'lucide-react';
import { Badge, Button, Text } from '@/components/ui';
import { LayoutCard, SourceContent } from '@/components/layout';
import { deriveDataState } from '@/api/dataState';
import { Skeleton, InlineCallout } from '@/components/feedback';
import { TimeStamp } from '@/components/data-display';
import { useVisitedPlaceCandidates } from '@/api/hooks/useLocations';
import type { VisitedPlaceCandidate } from '@/api/types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export function VisitedCandidates({ onReview, onSelectForTemplate }: {
  onReview: (candidate: VisitedPlaceCandidate) => void;
  onSelectForTemplate?: (id: number) => void;
}) {
  const { fmtScientificNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const query = useVisitedPlaceCandidates();
  const candidates = query.data ?? [];
  const state = deriveDataState(query);
  return (
    <LayoutCard
      title={t('geofences.visits.title', 'Visited places to review')}
      actions={<><MapPin className="h-4 w-4 text-cyan-300" aria-hidden="true" /><Badge variant="neutral" size="sm">{state.hasData ? candidates.length : '—'}</Badge></>}
    >
      <Text size="sm" color="secondary" className="mb-3">
        {t('geofences.visits.description', 'Drive endpoints suggest places; completed charging sessions provide independent charging evidence. Review each location before adding it to your directory.')}
      </Text>
      <SourceContent
        state={state.fatalError ? 'error' : state.status === 'stale' ? 'retained' : query.isLoading && !state.hasData ? 'loading' : candidates.length === 0 ? 'empty' : 'ready'}
        label={t('geofences.visits.title', 'Visited places to review')}
        error={state.fatalError}
        errorMessage={t('geofences.visits.loadFailed', 'Visited place suggestions could not be loaded.')}
        errorRecovery={{ onRetry: () => void query.refetch() }}
        emptyMessage={t('geofences.visits.empty', 'No unmatched visited places in recent drive history.')}
        loadingContent={<Skeleton className="h-24 w-full" />}
        emptyContent={
        <InlineCallout variant="info">
          {state.hasData
            ? t('geofences.visits.empty', 'No unmatched visited places in recent drive history.')
            : t('geofences.visits.unavailable', 'Visited place suggestions are unavailable.')}
        </InlineCallout>
        }
      >
        <div className="max-h-96 space-y-2 overflow-y-auto">
          {candidates.map((candidate) => (
            <div key={candidate.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--glass-border)] bg-[var(--surface-2)] p-3">
              <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
                <Text variant="body" className="break-words font-medium">{candidate.name || `${fmtScientificNumber(candidate.latitude, 4)}, ${fmtScientificNumber(candidate.longitude, 4)}`}</Text>
                <Text size="sm" color="muted">
                  {t('geofences.visits.evidence', '{{visits}} visits · {{charges}} confirmed charges', { visits: candidate.visit_count, charges: candidate.charge_count })}
                  {' · '}<TimeStamp value={candidate.last_visited} format="relative" />
                </Text>
                <Badge variant={candidate.charge_count > 0 ? 'success' : 'neutral'} size="sm">
                  {candidate.charge_count > 0
                    ? <><BatteryCharging className="mr-1 inline h-3 w-3" aria-hidden="true" />{t('geofences.visits.suggestCharging', 'Likely charging')}</>
                    : t('geofences.visits.suggestOther', 'Visited; charging not observed')}
                </Badge>
              </div>
              <div className="flex min-w-0 flex-wrap gap-2">
                {onSelectForTemplate && (
                  <Button wrapLabel size="sm" variant="ghost" disabled={!candidate.name} onClick={() => onSelectForTemplate(candidate.id)}>
                    {t('geofences.visits.useTemplate', 'Use in template')}
                  </Button>
                )}
                <Button wrapLabel size="sm" variant="secondary" onClick={() => onReview(candidate)}>
                  {t('geofences.visits.review', 'Review place')}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </SourceContent>
    </LayoutCard>
  );
}
