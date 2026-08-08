import { Gauge, LoaderCircle, RefreshCw, Rows3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AlertBanner, EmptyState, QueryError } from '@/components/feedback';
import { Button, Text } from '@/components/ui';

import type { DriveDnaModel } from '../../lib/driveDNA';
import type { DriveDnaSectionState } from './types';

interface DriveDnaKpiNoticesProps {
  model: DriveDnaModel;
  state: DriveDnaSectionState;
  capReached: boolean;
}

export function DriveDnaKpiNotices({
  model,
  state,
  capReached,
}: DriveDnaKpiNoticesProps) {
  const { t } = useTranslation();
  return (
    <>
      {!state.vehicleSelected ? (
        <EmptyState
          className="py-6"
          icon={<Gauge className="h-7 w-7" aria-hidden="true" />}
          message={t(
            'driveDna.states.noVehicle',
            'Select a vehicle to inspect its drive fingerprints.',
          )}
        />
      ) : null}
      {state.list.isLoading ? (
        <AlertBanner
          className="mt-4"
          variant="info"
          role="status"
          aria-live="polite"
          aria-label={t(
            'driveDna.states.listLoading',
            'Loading drive history',
          )}
          data-testid="drive-dna-list-loading"
          icon={
            <LoaderCircle
              className="h-4 w-4 animate-spin"
              aria-hidden="true"
            />
          }
        >
          <Text as="p" variant="caption">
            {t('driveDna.states.listLoading', 'Loading drive history')}
          </Text>
        </AlertBanner>
      ) : null}
      {state.telemetry.isLoading && state.hasDrive ? (
        <AlertBanner
          className="mt-4"
          variant="info"
          role="status"
          aria-live="polite"
          aria-label={t(
            'driveDna.states.telemetryLoading',
            'Loading selected-drive telemetry',
          )}
          data-testid="drive-dna-telemetry-loading"
          icon={
            <LoaderCircle
              className="h-4 w-4 animate-spin"
              aria-hidden="true"
            />
          }
        >
          <Text as="p" variant="caption">
            {t(
              'driveDna.states.telemetryLoading',
              'Loading selected-drive telemetry',
            )}
          </Text>
        </AlertBanner>
      ) : null}
      {state.list.error ? (
        <div className="mt-4" data-testid="drive-dna-list-error">
          <QueryError error={state.list.error} onRetry={state.list.onRetry} />
        </div>
      ) : null}
      {state.telemetry.error && state.hasDrive ? (
        <div className="mt-4" data-testid="drive-dna-telemetry-error">
          <QueryError
            error={state.telemetry.error}
            onRetry={state.telemetry.onRetry}
          />
        </div>
      ) : null}
      {state.list.refreshError ? (
        <AlertBanner
          className="mt-4"
          variant="warning"
          role="alert"
          data-testid="drive-dna-list-refresh-error"
          icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Text as="p" variant="caption">
              {t(
                'driveDna.states.listRefreshError',
                'Drive history could not refresh. Showing the most recently loaded drives.',
              )}
            </Text>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={state.list.onRetry}
            >
              {t('error.retry', 'Retry')}
            </Button>
          </div>
        </AlertBanner>
      ) : null}
      {state.telemetry.refreshError && state.hasDrive ? (
        <AlertBanner
          className="mt-4"
          variant="warning"
          role="alert"
          data-testid="drive-dna-telemetry-refresh-error"
          icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Text as="p" variant="caption">
              {t(
                'driveDna.states.telemetryRefreshError',
                'Drive telemetry could not refresh. Showing the most recently loaded fingerprint and evidence.',
              )}
            </Text>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={state.telemetry.onRetry}
            >
              {t('error.retry', 'Retry')}
            </Button>
          </div>
        </AlertBanner>
      ) : null}
      {state.list.isResolved && !state.hasDrive ? (
        <EmptyState
          className="py-6"
          icon={<Gauge className="h-7 w-7" aria-hidden="true" />}
          message={t(
            'driveDna.states.noDrives',
            'No drives were returned for this vehicle.',
          )}
        />
      ) : null}
      {state.telemetry.isResolved &&
      state.hasDrive &&
      model.sample.validRows === 0 ? (
        <EmptyState
          className="py-6"
          icon={<Rows3 className="h-7 w-7" aria-hidden="true" />}
          message={
            model.sample.returnedRows > 0
              ? t(
                  'driveDna.states.invalidTimestamps',
                  'Telemetry rows were returned, but none had a valid timestamp.',
                )
              : t(
                  'driveDna.states.noTelemetry',
                  'This drive returned no telemetry emissions.',
                )
          }
        />
      ) : null}
      {capReached ? (
        <AlertBanner className="mt-4" variant="warning">
          <Text as="p" variant="caption">
            {t(
              'driveDna.kpis.capReached',
              'The selector reached its 1,000-drive history cap; this selected drive’s telemetry remains complete for that drive.',
            )}
          </Text>
        </AlertBanner>
      ) : null}
    </>
  );
}
