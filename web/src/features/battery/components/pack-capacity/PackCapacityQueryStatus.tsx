import {
  BatteryMedium,
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
import type { PackCapacityResult } from '../../lib/packCapacity';
import { packCapacityBandLabel } from './labels';
import type { PackCapacityQueryState } from './types';

interface PackCapacityQueryStatusProps {
  result: PackCapacityResult;
  state: PackCapacityQueryState;
}

export function PackCapacityQueryStatus({
  result,
  state,
}: PackCapacityQueryStatusProps) {
  const { t } = useTranslation();

  if (!state.vehicleSelected) {
    return (
      <EmptyState /* no-action: retry, vehicle, and range controls are owned by the parent page */
        className="py-6"
        icon={<BatteryMedium className="h-7 w-7" aria-hidden="true" />}
        message={t(
          'packCapacity.states.noVehicle',
          'Select a vehicle to analyze its returned charging history.',
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
          'packCapacity.states.loadingAria',
          'Loading Pack Capacity evidence',
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
            'packCapacity.states.loading',
            'Loading up to 1,000 charging sessions for deterministic analysis...',
          )}
        </Text>
      </AlertBanner>
    );
  }
  if (state.error) {
    return (
      <div className="mt-4" data-testid="pack-capacity-initial-error">
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
              'packCapacity.states.refreshError',
              'Charging history could not refresh. Showing the most recently loaded evidence.',
            )}
          </Text>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={state.onRetry}
          >
            {t('packCapacity.states.retry', 'Retry')}
          </Button>
        </div>
      </AlertBanner>
    );
  }
  if (!state.isResolved) return null;

  if (result.accounting.historyCapReached) {
    return (
      <AlertBanner
        className="mt-4"
        variant="warning"
        icon={<TriangleAlert className="h-4 w-4" aria-hidden="true" />}
      >
        <Text as="p" variant="caption">
          {t(
            'packCapacity.states.capReached',
            'The endpoint returned exactly its 1,000-row cap. Older matching charging history may be omitted.',
          )}
        </Text>
      </AlertBanner>
    );
  }
  if (result.accounting.returnedRows === 0) {
    return (
      <EmptyState /* no-action: retry, vehicle, and range controls are owned by the parent page */
        className="py-6"
        icon={<BatteryMedium className="h-7 w-7" aria-hidden="true" />}
        message={t(
          'packCapacity.states.empty',
          'No charging history was returned for this vehicle.',
        )}
      />
    );
  }
  if (result.observations.length === 0) {
    return (
      <AlertBanner className="mt-4" variant="info">
        <Text as="p" variant="caption">
          {t(
            'packCapacity.states.noQualified',
            'Returned sessions contained no complete, valid, non-future measurement with enough SoC gain, positive energy, and plausible implied capacity.',
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
            'packCapacity.states.thinSupport',
            '{{band}}: interpret filtered estimates as limited charging evidence.',
            {
              band: packCapacityBandLabel(
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
