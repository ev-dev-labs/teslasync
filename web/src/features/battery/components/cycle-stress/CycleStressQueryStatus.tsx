import {
  Activity,
  DatabaseZap,
  LoaderCircle,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  AlertBanner,
  EmptyState,
  QueryError,
} from '@/components/feedback';
import { Button, Text } from '@/components/ui';
import type { CycleStressResult } from '../../lib/cycleStress';
import {
  cycleStressBandLabel,
  cycleStressSourceLabel,
} from './labels';
import type { CycleStressQueryState } from './types';

interface CycleStressQueryStatusProps {
  result: CycleStressResult;
  state: CycleStressQueryState;
}

export function CycleStressQueryStatus({
  result,
  state,
}: CycleStressQueryStatusProps) {
  const { t } = useTranslation();

  if (!state.vehicleSelected) {
    return (
      <EmptyState /* no-action: the persistent VehicleSelect in the page header is the canonical recovery control. */
        className="py-6"
        icon={<Activity className="h-7 w-7" aria-hidden="true" />}
        message={t(
          'cycleStress.states.noVehicle',
          'Select a vehicle to analyze its returned charge and drive history.',
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
          'cycleStress.states.loadingAria',
          'Loading Cycle Stress evidence',
        )}
        icon={
          <LoaderCircle
            className="h-4 w-4 animate-spin"
            aria-hidden="true"
          />
        }
      >
        <Text as="p" variant="caption">
          {t(
            'cycleStress.states.loading',
            'Loading up to 1,000 completed drives and 1,000 completed charging sessions...',
          )}
        </Text>
      </AlertBanner>
    );
  }
  if (state.error) {
    return (
      <div className="mt-4" data-testid="cycle-stress-initial-error">
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
              'cycleStress.states.refreshError',
              'One or more histories could not refresh. Showing the most recently loaded evidence.',
            )}
          </Text>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={state.onRetry}
          >
            {t('cycleStress.states.retry', 'Retry')}
          </Button>
        </div>
      </AlertBanner>
    );
  }
  if (!state.isResolved) return null;

  if (
    state.failedSources.length > 0
    || state.loadingSources.length > 0
  ) {
    const affected = [
      ...state.failedSources,
      ...state.loadingSources,
    ].map((source) => cycleStressSourceLabel(t, source)).join(', ');
    return (
      <AlertBanner
        className="mt-4"
        variant="warning"
        icon={<DatabaseZap className="h-4 w-4" aria-hidden="true" />}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Text as="p" variant="caption">
            {t(
              'cycleStress.states.partialSources',
              'Partial evidence is shown while these sources are unavailable or pending: {{sources}}.',
              { sources: affected },
            )}
          </Text>
          {state.failedSources.length > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={state.onRetry}
            >
              {t('cycleStress.states.retry', 'Retry')}
            </Button>
          ) : null}
        </div>
      </AlertBanner>
    );
  }

  const capReached =
    result.driveAccounting.historyCapReached
    || result.chargingAccounting.historyCapReached;
  const returnedRows =
    result.driveAccounting.returnedRows
    + result.chargingAccounting.returnedRows;
  if (capReached) {
    return (
      <AlertBanner
        className="mt-4"
        variant="warning"
        icon={<TriangleAlert className="h-4 w-4" aria-hidden="true" />}
      >
        <Text as="p" variant="caption">
          {t(
            'cycleStress.states.capReached',
            'At least one source returned exactly its 1,000-row cap. Older matching history may be omitted, and the two source spans may differ.',
          )}
        </Text>
      </AlertBanner>
    );
  }
  if (returnedRows === 0) {
    return (
      <EmptyState /* no-action: history is recorded automatically; the persistent VehicleSelect remains the only relevant control. */
        className="py-6"
        icon={<Activity className="h-7 w-7" aria-hidden="true" />}
        message={t(
          'cycleStress.states.empty',
          'No drive or charging history was returned for this vehicle.',
        )}
      />
    );
  }
  if (result.continuity.acceptedIntervals === 0) {
    return (
      <AlertBanner className="mt-4" variant="info">
        <Text as="p" variant="caption">
          {t(
            'cycleStress.states.noQualified',
            'Returned rows contained no complete, valid, non-future interval with direction-consistent SoC endpoints.',
          )}
        </Text>
      </AlertBanner>
    );
  }
  if (result.coverage.support.band === 'thin') {
    return (
      <AlertBanner className="mt-4" variant="info">
        <Text as="p" variant="caption">
          {t(
            'cycleStress.states.thinSupport',
            '{{band}} support: interpret cycle summaries as limited reconstructed evidence.',
            {
              band: cycleStressBandLabel(
                t,
                result.coverage.support.band,
              ),
            },
          )}
        </Text>
      </AlertBanner>
    );
  }
  return null;
}
