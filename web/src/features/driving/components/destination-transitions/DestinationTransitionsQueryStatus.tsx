import {
  DatabaseZap,
  LoaderCircle,
  RefreshCw,
  RouteOff,
  TriangleAlert,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AlertBanner, EmptyState, QueryError } from '@/components/feedback';
import { Button, Text } from '@/components/ui';
import type { DestinationTransitionResult } from '../../lib/destinationTransitions';
import type { DestinationTransitionsQueryState } from './types';

interface DestinationTransitionsQueryStatusProps {
  model: DestinationTransitionResult;
  state: DestinationTransitionsQueryState;
}

/** The page's only actionable query status and retry surface. */
export function DestinationTransitionsQueryStatus({
  model,
  state,
}: DestinationTransitionsQueryStatusProps) {
  const { t } = useTranslation();

  if (!state.vehicleSelected) {
    return (
      <EmptyState /* no-action: vehicle selection is available in the persistent page header. */
        className="py-6"
        icon={<RouteOff className="h-7 w-7" aria-hidden="true" />}
        message={t(
          'destinationTransitions.states.noVehicle',
          'Select a vehicle to analyze its returned destination visits and continuity-safe transitions.',
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
          'destinationTransitions.states.loadingAria',
          'Loading destination transition history',
        )}
        icon={<LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />}
      >
        <Text as="p" variant="caption">
          {t(
            'destinationTransitions.states.loading',
            'Loading up to 1,000 recent drives…',
          )}
        </Text>
      </AlertBanner>
    );
  }
  if (state.error) {
    return (
      <div className="mt-4" data-testid="destination-transitions-initial-error">
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
              'destinationTransitions.states.refreshError',
              'Drive history could not refresh. Showing the most recently loaded destination evidence.',
            )}
          </Text>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={state.onRetry}
          >
            {t('destinationTransitions.states.retry', 'Retry')}
          </Button>
        </div>
      </AlertBanner>
    );
  }
  if (!state.isResolved) return null;

  return (
    <>
      {model.accounting.historyCapReached ? (
        <AlertBanner
          className="mt-4"
          variant="warning"
          icon={<TriangleAlert className="h-4 w-4" aria-hidden="true" />}
        >
          <Text as="p" variant="caption">
            {t(
              'destinationTransitions.states.capReached',
              'Exactly 1,000 rows were returned. Findings cover only the latest returned history and may be capped.',
            )}
          </Text>
        </AlertBanner>
      ) : null}
      {model.accounting.returnedRows === 0 ? (
        <EmptyState /* no-action: destination evidence arrives through vehicle drive sync. */
          className="py-6"
          icon={<DatabaseZap className="h-7 w-7" aria-hidden="true" />}
          message={t(
            'destinationTransitions.states.empty',
            'No drives were returned, so no destination or transition claim is made.',
          )}
        />
      ) : model.accounting.includedRows === 0 ? (
        <AlertBanner className="mt-4" variant="info">
          <Text as="p" variant="caption">
            {t(
              'destinationTransitions.states.noQualified',
              'Returned rows contained no completed, valid, non-future drive with a usable end destination.',
            )}
          </Text>
        </AlertBanner>
      ) : model.acceptedTransitions === 0 ? (
        <AlertBanner className="mt-4" variant="info">
          <Text as="p" variant="caption">
            {t(
              'destinationTransitions.states.noContinuity',
              'Included destination visits are available, but no adjacent pair passed endpoint continuity and time-order checks.',
            )}
          </Text>
        </AlertBanner>
      ) : model.evidence.supportedOriginStates === 0 ? (
        <AlertBanner className="mt-4" variant="info">
          <Text as="p" variant="caption">
            {t(
              'destinationTransitions.states.thinSupport',
              'Accepted transitions are descriptive, but no origin has the three outgoing observations required for supported evidence.',
            )}
          </Text>
        </AlertBanner>
      ) : null}
    </>
  );
}
