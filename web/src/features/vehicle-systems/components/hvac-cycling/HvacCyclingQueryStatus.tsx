import {
  Fan,
  LoaderCircle,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  AlertBanner,
  EmptyState,
  QueryError,
} from '@/components/feedback';
import { Button, Text } from '@/components/ui';
import type { HvacCyclingSummary } from '../../lib/hvacCycling';
import type { HvacCyclingQueryState } from './types';

interface HvacCyclingQueryStatusProps {
  summary: HvacCyclingSummary;
  state: HvacCyclingQueryState;
}

/** The workspace's single actionable query status and retry surface. */
export function HvacCyclingQueryStatus({
  summary,
  state,
}: HvacCyclingQueryStatusProps) {
  const { t } = useTranslation();

  if (!state.vehicleSelected) {
    return (
      <EmptyState /* no-action: retry, vehicle, and range controls are owned by the parent page */
        className="py-5"
        icon={<Fan className="h-7 w-7" aria-hidden="true" />}
        message={t(
          'hvacCycling.states.noVehicle',
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
          'hvacCycling.states.loadingAria',
          'Loading HVAC cycling evidence',
        )}
        icon={<LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />}
      >
        <Text as="p" variant="caption">
          {t(
            'hvacCycling.states.loading',
            'Loading the climate endpoint’s seven-day timeline…',
          )}
        </Text>
      </AlertBanner>
    );
  }
  if (state.error) {
    return (
      <div className="mt-4" data-testid="hvac-cycling-initial-error">
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
              'hvacCycling.states.refreshError',
              'Climate history could not refresh. Showing the most recently loaded HVAC evidence.',
            )}
          </Text>
          <Button type="button" variant="ghost" size="sm" onClick={state.onRetry}>
            {t('hvacCycling.states.retry', 'Retry')}
          </Button>
        </div>
      </AlertBanner>
    );
  }
  if (!state.isResolved) return null;
  if (summary.rows.returnedRows === 0) {
    return (
      <EmptyState /* no-action: retry, vehicle, and range controls are owned by the parent page */
        className="py-5"
        icon={<Fan className="h-7 w-7" aria-hidden="true" />}
        message={t(
          'hvacCycling.states.empty',
          'The climate endpoint returned no rows, so no cycling claim is made.',
        )}
      />
    );
  }
  if (summary.rows.validKnownStateRows === 0) {
    return (
      <AlertBanner className="mt-4" variant="warning">
        <Text as="p" variant="caption">
          {t(
            'hvacCycling.states.unknownOnly',
            'Rows were returned, but every unique timestamp had an uninterpretable HVAC state.',
          )}
        </Text>
      </AlertBanner>
    );
  }
  if (summary.intervals.observedIntervals === 0) {
    return (
      <AlertBanner className="mt-4" variant="info">
        <Text as="p" variant="caption">
          {t(
            'hvacCycling.states.noIntervals',
            'Known states exist, but no adjacent interval passed the continuity and maximum-gap rules.',
          )}
        </Text>
      </AlertBanner>
    );
  }
  if (
    summary.activeRunCount > 0
    && summary.completeOnRunCount === 0
  ) {
    return (
      <AlertBanner
        className="mt-4"
        variant="warning"
        icon={<ShieldAlert className="h-4 w-4" aria-hidden="true" />}
      >
        <Text as="p" variant="caption">
          {t(
            'hvacCycling.states.censoredOnly',
            'Active run fragments are present, but none has two observed transition boundaries; short-cycle rate is withheld.',
          )}
        </Text>
      </AlertBanner>
    );
  }
  return null;
}
