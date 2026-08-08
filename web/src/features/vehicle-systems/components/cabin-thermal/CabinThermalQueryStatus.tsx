import {
  LoaderCircle,
  RefreshCw,
  ThermometerSun,
  TriangleAlert,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AlertBanner, EmptyState, QueryError } from '@/components/feedback';
import { Button, Text } from '@/components/ui';
import type { CabinThermalSummary } from '../../lib/cabinThermal';
import type { CabinThermalQueryState } from './types';

interface CabinThermalQueryStatusProps {
  summary: CabinThermalSummary;
  state: CabinThermalQueryState;
}

/** The workspace's only actionable query status and retry surface. */
export function CabinThermalQueryStatus({
  summary,
  state,
}: CabinThermalQueryStatusProps) {
  const { t } = useTranslation();

  if (!state.vehicleSelected) {
    return (
      <EmptyState
        className="py-5"
        icon={<ThermometerSun className="h-7 w-7" aria-hidden="true" />}
        message={t(
          'cabinThermal.states.noVehicle',
          'Select a vehicle to analyze its returned climate history.',
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
          'cabinThermal.states.loadingAria',
          'Loading cabin thermal evidence',
        )}
        icon={<LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />}
      >
        <Text as="p" variant="caption">
          {t(
            'cabinThermal.states.loading',
            'Loading the climate endpoint’s seven-day history…',
          )}
        </Text>
      </AlertBanner>
    );
  }
  if (state.error) {
    return (
      <div className="mt-4" data-testid="cabin-thermal-initial-error">
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
              'cabinThermal.states.refreshError',
              'Climate history could not refresh. Showing the most recently loaded thermal evidence.',
            )}
          </Text>
          <Button type="button" variant="ghost" size="sm" onClick={state.onRetry}>
            {t('cabinThermal.states.retry', 'Retry')}
          </Button>
        </div>
      </AlertBanner>
    );
  }
  if (!state.isResolved) return null;

  if (summary.accounting.returnedRows === 0) {
    return (
      <EmptyState
        className="py-5"
        icon={<ThermometerSun className="h-7 w-7" aria-hidden="true" />}
        message={t(
          'cabinThermal.states.empty',
          'The climate endpoint returned no rows, so no thermal claim is made.',
        )}
      />
    );
  }
  if (summary.accounting.normalizedRows === 0) {
    return (
      <AlertBanner className="mt-4" variant="warning">
        <Text as="p" variant="caption">
          {t(
            'cabinThermal.states.noNormalized',
            'Rows were returned, but timestamp or temperature validation excluded every row.',
          )}
        </Text>
      </AlertBanner>
    );
  }
  if (summary.accounting.candidateWindows === 0) {
    return (
      <AlertBanner className="mt-4" variant="info">
        <Text as="p" variant="caption">
          {t(
            'cabinThermal.states.noCandidates',
            'Normalized evidence exists, but it formed no HVAC-off candidate window.',
          )}
        </Text>
      </AlertBanner>
    );
  }
  if (summary.accounting.acceptedFits === 0) {
    return (
      <AlertBanner
        className="mt-4"
        variant="warning"
        icon={<TriangleAlert className="h-4 w-4" aria-hidden="true" />}
      >
        <Text as="p" variant="caption">
          {t(
            'cabinThermal.states.allRejected',
            'No candidate passed every gate. Rejections below are diagnostics only and do not support a τ estimate.',
          )}
        </Text>
      </AlertBanner>
    );
  }
  return null;
}
