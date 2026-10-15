import { Database, LoaderCircle, RefreshCw, ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AlertBanner, EmptyState, QueryError } from '@/components/feedback';
import { Button, Text } from '@/components/ui';
import { VehicleSourcePause } from '../VehicleSourcePause';
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
  if (!state.vehicleSelected) {
    return (
      <EmptyState /* no-action: retry, vehicle, and range controls are owned by the parent page */
        className="py-5"
        icon={<Database className="h-7 w-7" aria-hidden="true" />}
        message={t(
          'preconditioningEffectiveness.states.noVehicle',
          'Select a vehicle to query climate history and up to 1,000 recent drives.',
        )}
      />
    );
  }
  const sources = [
    {
      id: 'climate',
      label: t('preconditioningEffectiveness.coverage.climateSource', 'Climate history source'),
      failure: t('preconditioningEffectiveness.states.climateFailure', 'Climate-history query failed'),
      query: state.climate,
    },
    {
      id: 'drives',
      label: t('preconditioningEffectiveness.coverage.driveSource', 'Drive history source'),
      failure: t('preconditioningEffectiveness.states.driveFailure', 'Drive-history query failed'),
      query: state.drives,
    },
  ];
  const affected = sources.filter(({ query }) => (
    query.error || query.refreshError || query.isPaused || query.isLoading
    || (query.isFetching && query.hasData)
  ));
  if (affected.length > 0) {
    return (
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {affected.map(({ id, label, failure, query }) => (
          <div key={id} role="group" aria-label={label} data-testid={`preconditioning-${id}-notice`}>
            <Text as="h3" variant="label" className="mb-2">
              {query.error ? failure : label}
            </Text>
            {query.error ? (
              <QueryError error={query.error} onRetry={query.onRetry} resourceName={label} />
            ) : (
              <>
                {query.refreshError ? (
                  <AlertBanner variant="warning" role="alert"
                    icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <Text as="p" variant="caption">
                        {t(
                          'preconditioningEffectiveness.states.refreshError',
                          'One or more sources could not refresh. The most recently loaded evidence remains visible.',
                        )}
                      </Text>
                      <Button type="button" variant="ghost" size="sm" wrapLabel
                        className="min-h-11 md:min-h-9" onClick={query.onRetry}>
                        {t('preconditioningEffectiveness.states.retryRefresh', 'Retry refresh')}
                      </Button>
                    </div>
                  </AlertBanner>
                ) : null}
                {query.isPaused && !query.refreshError ? (
                  <VehicleSourcePause label={label} retained={query.hasData} onRetry={query.onRetry}
                    message={t('dataSources.status.paused', 'Refresh paused')} />
                ) : !query.isPaused && (query.isLoading || (query.isFetching && query.hasData)) ? (
                  <AlertBanner variant="info" role="status" aria-live="polite"
                    aria-label={t(
                      'preconditioningEffectiveness.states.loadingAria',
                      'Loading preconditioning evidence',
                    )}
                    icon={<LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />}>
                    <Text as="p" variant="caption">
                      {query.hasData
                        ? t('dataSources.status.refreshing', 'Refreshing')
                        : t('dataSources.status.loading', 'Loading')}
                    </Text>
                  </AlertBanner>
                ) : null}
              </>
            )}
          </div>
        ))}
      </div>
    );
  }
  if (!state.climate.isResolved || !state.drives.isResolved) return null;
  if (
    summary.climateRows.returnedRows === 0
    && summary.driveRows.returnedRows === 0
  ) {
    return (
      <EmptyState /* no-action: retry, vehicle, and range controls are owned by the parent page */
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
