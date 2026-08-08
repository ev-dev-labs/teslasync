import { CalendarClock, LoaderCircle, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  AlertBanner,
  EmptyState,
  QueryError,
} from '@/components/feedback';
import { Button, Text } from '@/components/ui';
import type { DepartureForecast } from '../../lib/departureForecast';
import { departureEvidenceBandLabel } from './labels';
import type { DepartureForecastQueryState } from './types';

interface DepartureForecastQueryStatusProps {
  forecast: DepartureForecast;
  state: DepartureForecastQueryState;
}

/** The page's single actionable/live query status surface. */
export function DepartureForecastQueryStatus({
  forecast,
  state,
}: DepartureForecastQueryStatusProps) {
  const { t } = useTranslation();

  if (!state.vehicleSelected) {
    return (
      <EmptyState /* no-action: vehicle selection is already available in the page header. */
        className="py-6"
        icon={<CalendarClock className="h-7 w-7" aria-hidden="true" />}
        message={t(
          'departure.states.noVehicle',
          'Select a vehicle to analyze its recorded drive starts.',
        )}
      />
    );
  }
  if (state.isLoading) {
    return (
      <AlertBanner
        className="mt-4"
        variant="info"
        role="status"
        aria-live="polite"
        aria-label={t(
          'departure.states.loadingAria',
          'Loading departure history',
        )}
        data-testid="departure-loading-status"
        icon={
          <LoaderCircle
            className="h-4 w-4 animate-spin"
            aria-hidden="true"
          />
        }
      >
        <Text as="p" variant="caption">
          {t(
            'departure.states.loading',
            'Loading up to 1,000 recent drive starts…',
          )}
        </Text>
      </AlertBanner>
    );
  }
  if (state.error) {
    return (
      <div className="mt-4" data-testid="departure-initial-error">
        <QueryError error={state.error} onRetry={state.onRetry} />
      </div>
    );
  }
  if (state.refreshError) {
    return (
      <AlertBanner
        className="mt-4"
        variant="warning"
        role="alert"
        data-testid="departure-refresh-error"
        icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Text as="p" variant="caption">
            {t(
              'departure.states.refreshError',
              'Departure history could not refresh. Showing the most recently loaded evidence.',
            )}
          </Text>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={state.onRetry}
          >
            {t('departure.states.retry', 'Retry')}
          </Button>
        </div>
      </AlertBanner>
    );
  }
  if (state.isResolved && forecast.totalDepartures === 0) {
    return (
      <EmptyState /* no-action: recorded drives train this read-only model automatically. */
        className="py-6"
        icon={<CalendarClock className="h-7 w-7" aria-hidden="true" />}
        message={
          forecast.accounting.returnedRows === 0
            ? t(
                'departure.states.empty',
                'No drives were returned, so no peak, horizon likelihood, or planning marker is inferred.',
              )
            : t(
                'departure.states.noQualified',
                'Returned rows contained no valid drive starts inside the 120-day model window.',
              )
        }
      />
    );
  }

  return (
    <>
      {forecast.accounting.historyCapReached ? (
        <AlertBanner
          className="mt-4"
          variant="warning"
          data-testid="departure-cap-warning"
        >
          <Text as="p" variant="caption">
            {t(
              'departure.states.capReached',
              'Exactly 1,000 rows were returned. History may be capped, so every finding is limited to the returned 120-day evidence.',
            )}
          </Text>
        </AlertBanner>
      ) : null}
      {forecast.evidenceStrength.band === 'thin' ? (
        <AlertBanner className="mt-4" variant="info">
          <Text as="p" variant="caption">
            {t(
              'departure.states.thinEvidence',
              '{{band}}: estimates remain descriptive, and the illustrative planning marker is unavailable.',
              {
                band: departureEvidenceBandLabel(
                  t,
                  forecast.evidenceStrength.band,
                ),
              },
            )}
          </Text>
        </AlertBanner>
      ) : null}
    </>
  );
}
