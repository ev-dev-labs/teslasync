import {
  LoaderCircle,
  RefreshCw,
  ShieldAlert,
  Thermometer,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AlertBanner, EmptyState, QueryError } from '@/components/feedback';
import { Button, Text } from '@/components/ui';
import type { ComfortConsistencySummary } from '../../lib/comfortConsistency';
import type { ComfortConsistencyQueryState } from './types';

interface ComfortConsistencyQueryStatusProps {
  summary: ComfortConsistencySummary;
  state: ComfortConsistencyQueryState;
}

export function ComfortConsistencyQueryStatus({
  summary,
  state,
}: ComfortConsistencyQueryStatusProps) {
  const { t } = useTranslation();

  if (!state.vehicleSelected) {
    return (
      <EmptyState
        className="py-5"
        icon={<Thermometer className="h-7 w-7" aria-hidden="true" />}
        message={t(
          'comfortConsistency.states.noVehicle',
          'Select a vehicle to analyze its returned climate timeline.',
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
          'comfortConsistency.states.loadingAria',
          'Loading comfort-consistency evidence',
        )}
        icon={<LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />}
      >
        <Text as="p" variant="caption">
          {t(
            'comfortConsistency.states.loading',
            'Loading the climate endpoint\'s seven-day timeline...',
          )}
        </Text>
      </AlertBanner>
    );
  }
  if (state.error) {
    return (
      <div className="mt-4" data-testid="comfort-consistency-initial-error">
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
        icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Text as="p" variant="caption">
            {t(
              'comfortConsistency.states.refreshError',
              'Climate history could not refresh. Showing the most recently loaded comfort evidence.',
            )}
          </Text>
          <Button type="button" variant="ghost" size="sm" onClick={state.onRetry}>
            {t('comfortConsistency.states.retry', 'Retry')}
          </Button>
        </div>
      </AlertBanner>
    );
  }
  if (!state.isResolved) return null;
  if (summary.rows.returnedRows === 0) {
    return (
      <EmptyState
        className="py-5"
        icon={<Thermometer className="h-7 w-7" aria-hidden="true" />}
        message={t(
          'comfortConsistency.states.empty',
          'The climate endpoint returned no rows, so no comfort claim is made.',
        )}
      />
    );
  }
  if (summary.rows.uniqueTimestampRows === 0) {
    return (
      <AlertBanner className="mt-4" variant="warning">
        <Text as="p" variant="caption">
          {t(
            'comfortConsistency.states.noValidTimestamps',
            'Rows were returned, but none supplied a unique valid timestamp.',
          )}
        </Text>
      </AlertBanner>
    );
  }
  if (summary.analyzedSamples === 0) {
    return (
      <AlertBanner className="mt-4" variant="warning">
        <Text as="p" variant="caption">
          {t(
            'comfortConsistency.states.noAnalyzedSamples',
            'Timestamped rows exist, but none passed the active-HVAC, cabin, and setpoint gates.',
          )}
        </Text>
      </AlertBanner>
    );
  }
  if (summary.intervals.observedActiveIntervals === 0) {
    return (
      <AlertBanner className="mt-4" variant="info">
        <Text as="p" variant="caption">
          {t(
            'comfortConsistency.states.sampleOnly',
            'Sample metrics are available, but no adjacent interval supports duration-weighted consistency.',
          )}
        </Text>
      </AlertBanner>
    );
  }
  if (
    summary.stabilizationWindows.length > 0
    && summary.stabilizedWindows === 0
  ) {
    return (
      <AlertBanner
        className="mt-4"
        variant="warning"
        icon={<ShieldAlert className="h-4 w-4" aria-hidden="true" />}
      >
        <Text as="p" variant="caption">
          {t(
            'comfortConsistency.states.noStabilization',
            'Outside-band fragments were observed, but none reached the sustained-band gate; censored endings remain disclosed.',
          )}
        </Text>
      </AlertBanner>
    );
  }
  return null;
}
