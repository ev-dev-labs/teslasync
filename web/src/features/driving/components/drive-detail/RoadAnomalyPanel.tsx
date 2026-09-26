import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, MapPin, Activity } from 'lucide-react';

import { useDriveRoadAnomalies } from '@/api/hooks/useDriving';
import { useDataState } from '@/hooks/useDataState';
import { useUnits } from '@/hooks/useUnits';
import { formatDateTime } from '@/lib/dateFormat';
import { Button, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { EmptyState, QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { MapContainer, MapTileLayer, MapInvalidator, MarkerCluster } from '@/components/maps';

interface RoadAnomalyPanelProps {
  driveId: string;
}

export function RoadAnomalyPanel({ driveId }: RoadAnomalyPanelProps) {
  const { t } = useTranslation();
  const { formatSpeed } = useUnits();
  const [expanded, setExpanded] = useState(false);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const regionId = useId();
  const query = useDriveRoadAnomalies(driveId, expanded);
  const state = useDataState(query, { provenance: 'inferred' });
  const candidates = useMemo(
    () => Array.isArray(state.data?.candidates) ? state.data.candidates : [],
    [state.data?.candidates],
  );
  const points = useMemo(
    () => candidates.map((candidate, index) => ({
      id: `${candidate.ts}-${index}`,
      lat: candidate.latitude,
      lng: candidate.longitude,
      color: '#fbbf24',
      ariaLabel: t('driveDetail.road.possibleJolt', 'Possible jolt'),
    })),
    [candidates, t],
  );
  const selectedCandidate = candidates.find((candidate, index) =>
    `${candidate.ts}-${index}` === selectedCandidateId);

  return (
    <GlassPanel className="overflow-hidden p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Activity className="h-5 w-5 text-amber-300" aria-hidden="true" />
          <div>
            <PanelTitle>{t('driveDetail.road.title', 'Possible road-surface anomalies')}</PanelTitle>
            <Text as="p" variant="caption">
              {t('driveDetail.road.subtitle', 'Historical telemetry review — not confirmed potholes')}
            </Text>
          </div>
        </div>
        <Button
          variant="secondary"
          size="sm"
          icon={expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          aria-expanded={expanded}
          aria-controls={regionId}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? t('driveDetail.road.hide', 'Hide analysis') : t('driveDetail.road.review', 'Review road surface')}
        </Button>
      </div>

      {expanded && (
        <div id={regionId} className="mt-5 space-y-4">
          <Text as="p" variant="bodySm">
            {t(
              'driveDetail.road.caveat',
              'Tesla does not report vertical impact or suspension motion. A candidate may be a road seam, speed bump, or maneuver; no candidate does not prove the road was smooth.',
            )}
          </Text>
          <StaleRefreshWarning state={state} label={t('driveDetail.road.title', 'Possible road-surface anomalies')} />
          {state.status === 'initial' ? (
            <Skeleton height={140} className="rounded-xl" />
          ) : state.fatalError ? (
            <QueryError error={state.fatalError} onRetry={() => query.refetch()} />
          ) : state.data?.status === 'insufficient_data' ? (
            <EmptyState
              icon={<Activity className="h-8 w-8" />}
              title={t('driveDetail.road.insufficientTitle', 'Not enough synchronized samples')}
              message={t(
                'driveDetail.road.insufficient',
                'This drive did not record sufficiently close acceleration, speed, and GPS observations to screen for short jolts. Missing evidence is not a smooth-road result.',
              )}
              actionTo={{ to: '/drives', label: t('driveDetail.road.otherDrive', 'Review other drives') }}
            />
          ) : state.data?.status === 'no_candidates' || candidates.length === 0 ? (
            <EmptyState
              icon={<MapPin className="h-8 w-8" />}
              title={t('driveDetail.road.noneTitle', 'No candidates in recorded samples')}
              message={t(
                'driveDetail.road.none',
                'No short jolt matched the screening criteria in the usable telemetry. Events between reports may have been missed.',
              )}
              actionTo={{ to: '/drives', label: t('driveDetail.road.otherDrive', 'Review other drives') }}
            />
          ) : (
            <>
              <Text as="p" variant="bodySm">
                {t('driveDetail.road.count', '{{count}} possible jolts in this drive', { count: candidates.length })}
                {' · '}
                {t('driveDetail.road.samples', '{{count}} acceleration observations screened', {
                  count: state.data?.analyzed_samples ?? 0,
                })}
              </Text>
              <div
                role="region"
                aria-label={t('driveDetail.road.map', 'Possible road-anomaly locations')}
                className="h-56 overflow-hidden rounded-xl sm:h-72"
              >
                <MapContainer
                  center={[candidates[0].latitude, candidates[0].longitude]}
                  zoom={15}
                  bounds={candidates.length > 1
                    ? candidates.map((candidate): [number, number] => [candidate.latitude, candidate.longitude])
                    : undefined}
                  boundsOptions={{ padding: [30, 30], maxZoom: 16 }}
                  scrollWheelZoom={false}
                  className="h-full w-full"
                >
                  <MapTileLayer style="dark" />
                  <MapInvalidator />
                  <MarkerCluster points={points} onMarkerClick={(point) => setSelectedCandidateId(String(point.id))} />
                </MapContainer>
              </div>
              {selectedCandidate && (
                <Text as="p" variant="bodySm" role="status">
                  {t('driveDetail.road.possibleJolt', 'Possible jolt')}
                  {' · '}{formatDateTime(selectedCandidate.ts)}
                  {' · '}{selectedCandidate.latitude.toFixed(5)}, {selectedCandidate.longitude.toFixed(5)}
                </Text>
              )}
              <div className="grid gap-3 md:grid-cols-2">
                {candidates.map((candidate, index) => (
                  <div key={`${candidate.ts}-${index}`} className="rounded-xl border border-[var(--border-default)] p-4">
                    <Text as="p" variant="bodySm" weight="semibold">
                      {t('driveDetail.road.possibleJolt', 'Possible jolt')}
                      {' · '}
                      {formatDateTime(candidate.ts)}
                    </Text>
                    <Text as="p" variant="caption">
                      {t('driveDetail.road.speed', 'Recorded speed')}: {formatSpeed(candidate.speed_mps)}
                    </Text>
                    <Text as="p" variant="caption">
                      {t('driveDetail.road.position', 'Approximate location')}: {candidate.latitude.toFixed(5)}, {candidate.longitude.toFixed(5)}
                    </Text>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </GlassPanel>
  );
}
