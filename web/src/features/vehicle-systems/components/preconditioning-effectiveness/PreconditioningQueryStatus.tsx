import { Database, LoaderCircle, RefreshCw, ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AlertBanner, EmptyState, QueryError } from '@/components/feedback';
import { Button, Text } from '@/components/ui';
import type { PreconditioningSummary } from '../../lib/preconditioningEffectiveness';
import type { PreconditioningQueryState } from './types';

interface PreconditioningQueryStatusProps {
  summary: PreconditioningSummary;
  state: PreconditioningQueryState;
}

export function PreconditioningQueryStatus({
  summary,
  state,
}: PreconditioningQueryStatusProps) {
  const { t } = useTranslation();
  const loading = state.climate.isLoading || state.drives.isLoading;
  const refreshing = (state.climate.isFetching && state.climate.hasData)
    || (state.drives.isFetching && state.drives.hasData);
  const paused = state.climate.isPaused || state.drives.isPaused;
  const refreshFailed = Boolean(state.climate.refreshError)
    || Boolean(state.drives.refreshError);

  if (!state.vehicleSelected) {
    return (
      <EmptyState
        className="py-5"
        icon={<Database className="h-7 w-7" aria-hidden="true" />}
        message={t(
          'preconditioningEffectiveness.states.noVehicle',
          'Select a vehicle to query climate history and up to 1,000 recent drives.',
        )}
      />
    );
  }
  if (loading) {
    return (
      <AlertBanner
        className="mt-4"
        variant="info"
        role="status"
        aria-live="polite"
        aria-label={t(
          'preconditioningEffectiveness.states.loadingAria',
          'Loading preconditioning evidence',
        )}
        icon={<LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />}
      >
        <Text as="p" variant="caption">
          {t(
            'preconditioningEffectiveness.states.loading',
            'Loading the climate timeline and bounded drive history...',
          )}
        </Text>
      </AlertBanner>
    );
  }
  if (paused) {
    return (
      <AlertBanner
        className="mt-4"
        variant="warning"
        role="status"
        aria-live="polite"
        icon={<ShieldAlert className="h-4 w-4" aria-hidden="true" />}
      >
        <Text as="p" variant="caption">
          {t(
            'preconditioningEffectiveness.states.paused',
            'Evidence loading is paused while the network is unavailable; no empty response has been inferred.',
          )}
        </Text>
      </AlertBanner>
    );
  }
  if (state.climate.error || state.drives.error) {
    return (
      <div
        className="mt-4 grid gap-3 lg:grid-cols-2"
        data-testid="preconditioning-initial-errors"
      >
        {state.climate.error ? (
          <div>
            <Text as="h3" variant="label" className="mb-2">
              {t(
                'preconditioningEffectiveness.states.climateFailure',
                'Climate-history query failed',
              )}
            </Text>
            <QueryError
              error={state.climate.error}
              onRetry={state.climate.onRetry}
            />
          </div>
        ) : null}
        {state.drives.error ? (
          <div>
            <Text as="h3" variant="label" className="mb-2">
              {t(
                'preconditioningEffectiveness.states.driveFailure',
                'Drive-history query failed',
              )}
            </Text>
            <QueryError
              error={state.drives.error}
              onRetry={state.drives.onRetry}
            />
          </div>
        ) : null}
      </div>
    );
  }
  if (refreshFailed) {
    return (
      <AlertBanner
        className="mt-4"
        variant="warning"
        role="alert"
        icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Text as="p" variant="caption">
            {t(
              'preconditioningEffectiveness.states.refreshError',
              'One or more sources could not refresh. The most recently loaded evidence remains visible.',
            )}
          </Text>
          <Button type="button" variant="ghost" size="sm" onClick={state.onRefresh}>
            {t('preconditioningEffectiveness.states.retryRefresh', 'Retry refresh')}
          </Button>
        </div>
      </AlertBanner>
    );
  }
  if (refreshing) {
    return (
      <AlertBanner
        className="mt-4"
        variant="info"
        role="status"
        aria-live="polite"
        icon={<LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />}
      >
        <Text as="p" variant="caption">
          {t(
            'preconditioningEffectiveness.states.refreshing',
            'Refreshing both evidence sources while retaining the current workspace...',
          )}
        </Text>
      </AlertBanner>
    );
  }
  if (!state.climate.isResolved || !state.drives.isResolved) return null;
  if (
    summary.climateRows.returnedRows === 0
    && summary.driveRows.returnedRows === 0
  ) {
    return (
      <EmptyState
        className="py-5"
        icon={<Database className="h-7 w-7" aria-hidden="true" />}
        message={t(
          'preconditioningEffectiveness.states.empty',
          'Both endpoints returned valid empty responses, so no readiness comparison is published.',
        )}
      />
    );
  }
  if (summary.joinedDepartures === 0) {
    return (
      <AlertBanner
        className="mt-4"
        variant="warning"
        icon={<ShieldAlert className="h-4 w-4" aria-hidden="true" />}
      >
        <Text as="p" variant="caption">
          {t(
            'preconditioningEffectiveness.states.excluded',
            'No departure is currently classified. Review the disposition ledger for distinct coverage, window, thermal, freshness, target, and HVAC exclusions.',
          )}
        </Text>
      </AlertBanner>
    );
  }
  if (summary.overall.evidence === 'none') {
    return (
      <AlertBanner className="mt-4" variant="warning">
        <Text as="p" variant="caption">
          {t(
            'preconditioningEffectiveness.states.oneGroup',
            'Classified departures exist, but comparison remains withheld because no hot/cold stratum contains both observational groups.',
          )}
        </Text>
      </AlertBanner>
    );
  }
  return null;
}
