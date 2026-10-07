import { AlertTriangle, Database, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AlertBanner, QueryError } from '@/components/feedback';
import { Button, Text } from '@/components/ui';
import type { TrueCostAnalysis } from '../../lib/trueCost';
import type { TrueCostQueryState } from './types';

interface TrueCostQueryStatusProps {
  analysis: TrueCostAnalysis;
  state: TrueCostQueryState;
}

export function TrueCostQueryStatus({
  analysis,
  state,
}: TrueCostQueryStatusProps) {
  const { t } = useTranslation();
  if (!state.enabled) {
    return (
      <AlertBanner className="mt-4" variant="info" icon={<Database className="h-4 w-4" />}>
        {t('tco.query.noVehicle', 'Select a vehicle to query its operating-cost envelope.')}
      </AlertBanner>
    );
  }
  if (state.isLoading) {
    return (
      <div
        className="mt-4 flex items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
        role="status"
        aria-label={t('tco.query.loadingAria', 'Loading True Cost evidence')}
      >
        <RefreshCw className="h-4 w-4 animate-spin text-[var(--text-muted)]" aria-hidden="true" />
        <Text variant="bodySm">
          {t('tco.query.loading', 'Loading recorded-cost charging and positive-drive evidence...')}
        </Text>
      </div>
    );
  }
  if (state.isPaused) {
    return (
      <AlertBanner className="mt-4" variant="warning">
        {t('tco.query.paused', 'Initial loading is paused while the network is unavailable; no empty response is inferred.')}
      </AlertBanner>
    );
  }
  if (state.error) {
    return (
      <div className="mt-4">
        <Text as="p" variant="label" className="mb-2">
          {t('tco.query.failed', 'Operating-cost query failed')}
        </Text>
        <QueryError error={state.error} onRetry={state.onRetry} />
      </div>
    );
  }
  if (state.refreshPaused) {
    return (
      <AlertBanner className="mt-4" variant="warning">
        {t('tco.query.refreshPaused', 'Cached evidence remains visible while its refresh is paused.')}
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
            {t('tco.query.refreshFailed', 'The refresh failed; the most recently loaded evidence remains visible.')}
          </Text>
          <Button type="button" variant="ghost" size="sm" onClick={state.onRetry}>
            {t('tco.query.retryRefresh', 'Retry refresh')}
          </Button>
        </div>
      </AlertBanner>
    );
  }
  if (state.isFetching) {
    return (
      <AlertBanner className="mt-4" variant="info">
        {t('tco.query.refreshing', 'Cached evidence is visible while a refresh is in progress.')}
      </AlertBanner>
    );
  }
  if (state.isResolved && analysis.zeroEnvelope) {
    return (
      <AlertBanner className="mt-4" variant="info">
        {t('tco.query.zero', 'The endpoint returned a valid zero envelope: no costed sessions, no positive distance, and no valid monthly evidence.')}
      </AlertBanner>
    );
  }
  if (state.isResolved && analysis.payloadAvailability !== 'valid') {
    return (
      <AlertBanner className="mt-4" variant="warning">
        {t('tco.query.invalidPayload', 'The response resolved, but its top-level payload is missing or malformed. Unsupported values remain unavailable.')}
      </AlertBanner>
    );
  }
  return (
    <AlertBanner className="mt-4" variant="info">
      {t('tco.query.scope', 'This workspace compares recorded-cost charging with a modeled gasoline equivalent; it is not a complete ownership-cost account.')}
    </AlertBanner>
  );
}
