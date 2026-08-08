import { AlertTriangle, Database, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AlertBanner, QueryError } from '@/components/feedback';
import { Button, Text } from '@/components/ui';
import type { ArchetypeSummary } from '../../lib/driveArchetypes';
import type { ArchetypeQueryState } from './types';

interface ArchetypeQueryStatusProps {
  summary: ArchetypeSummary;
  state: ArchetypeQueryState;
}

export function ArchetypeQueryStatus({
  summary,
  state,
}: ArchetypeQueryStatusProps) {
  const { t } = useTranslation();

  if (!state.vehicleSelected) {
    return (
      <AlertBanner className="mt-4" variant="info" icon={<Database className="h-4 w-4" />}>
        {t(
          'archetypes.query.noVehicle',
          'Select a vehicle to query an observed window of up to 1,000 recent drives.',
        )}
      </AlertBanner>
    );
  }
  if (state.isLoading) {
    return (
      <div
        className="mt-4 flex items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
        role="status"
        aria-label={t(
          'archetypes.query.loadingAria',
          'Loading drive-archetype evidence',
        )}
      >
        <RefreshCw className="h-4 w-4 animate-spin text-[var(--text-muted)]" aria-hidden="true" />
        <Text variant="bodySm">
          {t(
            'archetypes.query.loading',
            'Loading the bounded drive-history window...',
          )}
        </Text>
      </div>
    );
  }
  if (state.isPaused) {
    return (
      <AlertBanner className="mt-4" variant="warning">
        {t(
          'archetypes.query.paused',
          'Evidence loading is paused while the network is unavailable; no empty response has been inferred.',
        )}
      </AlertBanner>
    );
  }
  if (state.error) {
    return (
      <div className="mt-4">
        <Text as="p" variant="label" className="mb-2">
          {t('archetypes.query.failed', 'Drive-history query failed')}
        </Text>
        <QueryError error={state.error} onRetry={state.onRetry} />
      </div>
    );
  }
  if (state.refreshPaused) {
    return (
      <AlertBanner className="mt-4" variant="warning">
        {t(
          'archetypes.query.refreshPaused',
          'The network is unavailable, so cached evidence remains visible while its refresh is paused.',
        )}
      </AlertBanner>
    );
  }
  if (state.refreshError) {
    return (
      <AlertBanner
        className="mt-4"
        variant="warning"
        icon={<AlertTriangle className="h-4 w-4" />}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Text as="p" variant="caption">
            {t(
              'archetypes.query.refreshFailed',
              'The history window could not refresh. The most recently loaded evidence remains visible.',
            )}
          </Text>
          <Button type="button" variant="ghost" size="sm" onClick={state.onRetry}>
            {t('archetypes.query.retryRefresh', 'Retry refresh')}
          </Button>
        </div>
      </AlertBanner>
    );
  }
  if (state.isResolved && summary.source.returnedRows === 0) {
    return (
      <AlertBanner className="mt-4" variant="info">
        {t(
          'archetypes.query.empty',
          'The drive-history endpoint returned a valid empty response; no archetype partition is published.',
        )}
      </AlertBanner>
    );
  }
  if (summary.status === 'insufficient_drives') {
    return (
      <AlertBanner className="mt-4" variant="info">
        {t(
          'archetypes.query.belowFloor',
          '{{eligible}} eligible drives are available; {{required}} are required for clustering.',
          {
            eligible: summary.analyzedDrives,
            required: summary.thresholds.minDrives,
          },
        )}
      </AlertBanner>
    );
  }
  if (summary.status === 'insufficient_variation') {
    return (
      <AlertBanner className="mt-4" variant="warning">
        {t(
          'archetypes.query.noVariation',
          'Clustering is withheld because every standardized feature dimension is constant.',
        )}
      </AlertBanner>
    );
  }
  if (summary.status === 'insufficient_partition') {
    return (
      <AlertBanner className="mt-4" variant="warning">
        {t(
          'archetypes.query.noStablePartition',
          'Clustering is withheld because no candidate realized every requested cluster in a deterministic restart.',
        )}
      </AlertBanner>
    );
  }
  return (
    <AlertBanner className="mt-4" variant="info">
      {t(
        'archetypes.query.observational',
        'Published clusters are descriptive observational patterns, not verified trip purposes or ground truth.',
      )}
    </AlertBanner>
  );
}
