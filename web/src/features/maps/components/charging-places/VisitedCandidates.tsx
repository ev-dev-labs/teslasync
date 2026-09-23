import { useTranslation } from 'react-i18next';
import { MapPin, BatteryCharging } from 'lucide-react';
import { Badge, Button, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { QueryError, Skeleton, InlineCallout } from '@/components/feedback';
import { TimeStamp } from '@/components/data-display';
import { useVisitedPlaceCandidates } from '@/api/hooks/useLocations';
import type { VisitedPlaceCandidate } from '@/api/types';

export function VisitedCandidates({ onReview, onSelectForTemplate }: {
  onReview: (candidate: VisitedPlaceCandidate) => void;
  onSelectForTemplate?: (id: number) => void;
}) {
  const { t } = useTranslation();
  const query = useVisitedPlaceCandidates();
  const candidates = query.data ?? [];
  return (
    <GlassPanel className="p-4 sm:p-5">
      <PanelTitle className="mb-2 flex items-center gap-2">
        <MapPin className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('geofences.visits.title', 'Visited places to review')}
        <Badge variant="neutral" size="sm">{candidates.length}</Badge>
      </PanelTitle>
      <Text size="sm" color="secondary" className="mb-3">
        {t('geofences.visits.description', 'Drive endpoints suggest places; completed charging sessions provide independent charging evidence. Review each location before adding it to your directory.')}
      </Text>
      {query.error ? (
        <QueryError error={query.error} onRetry={() => void query.refetch()} />
      ) : query.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : candidates.length === 0 ? (
        <InlineCallout variant="info">
          {t('geofences.visits.empty', 'No unmatched visited places in recent drive history.')}
        </InlineCallout>
      ) : (
        <div className="max-h-96 space-y-2 overflow-y-auto">
          {candidates.map((candidate) => (
            <div key={candidate.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--glass-border)] bg-[var(--surface-2)] p-3">
              <div className="min-w-0">
                <Text variant="body" className="font-medium">{candidate.name || `${candidate.latitude.toFixed(4)}, ${candidate.longitude.toFixed(4)}`}</Text>
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
              <div className="flex gap-2">
                {onSelectForTemplate && (
                  <Button size="sm" variant="ghost" disabled={!candidate.name} onClick={() => onSelectForTemplate(candidate.id)}>
                    {t('geofences.visits.useTemplate', 'Use in template')}
                  </Button>
                )}
                <Button size="sm" variant="secondary" onClick={() => onReview(candidate)}>
                  {t('geofences.visits.review', 'Review place')}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </GlassPanel>
  );
}
