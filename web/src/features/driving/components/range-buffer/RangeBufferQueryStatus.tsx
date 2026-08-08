import {
  Clock3,
  LoaderCircle,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AlertBanner, EmptyState, QueryError } from '@/components/feedback';
import { Button, Text } from '@/components/ui';
import type { RangeBufferResult } from '../../lib/rangeBuffer';
import { rangeBufferBandLabel } from './labels';
import type { RangeBufferQueryState } from './types';

interface RangeBufferQueryStatusProps {
  result: RangeBufferResult;
  state: RangeBufferQueryState;
}

export function RangeBufferQueryStatus({
  result,
  state,
}: RangeBufferQueryStatusProps) {
  const { t } = useTranslation();

  if (!state.vehicleSelected) {
    return (
      <EmptyState /* no-action: the persistent VehicleSelect in the page header is the canonical recovery control. */
        className="py-6"
        icon={<Clock3 className="h-7 w-7" aria-hidden="true" />}
        message={t(
          'rangeBuffer.states.noVehicle',
          'Select a vehicle to analyze its returned arrival-buffer history.',
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
          'rangeBuffer.states.loadingAria',
          'Loading arrival buffer history',
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
            'rangeBuffer.states.loading',
            'Loading up to 1,000 drives in the selected vehicle-local window...',
          )}
        </Text>
      </AlertBanner>
    );
  }
  if (state.error) {
    return (
      <div className="mt-4" data-testid="range-buffer-initial-error">
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
              'rangeBuffer.states.refreshError',
              'Drive history could not refresh. Showing the most recently loaded arrival evidence.',
            )}
          </Text>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={state.onRetry}
          >
            {t('rangeBuffer.states.retry', 'Retry')}
          </Button>
        </div>
      </AlertBanner>
    );
  }
  if (!state.isResolved) return null;

  return (
    <>
      {result.accounting.historyCapReached ? (
        <AlertBanner
          className="mt-4"
          variant="warning"
          icon={
            <TriangleAlert
              className="h-4 w-4"
              aria-hidden="true"
            />
          }
        >
          <Text as="p" variant="caption">
            {t(
              'rangeBuffer.states.capReached',
              'Exactly 1,000 rows were returned. Findings cover the capped selected window and may omit earlier matching drives.',
            )}
          </Text>
        </AlertBanner>
      ) : null}
      {result.accounting.returnedRows === 0 ? (
        <EmptyState /* no-action: the persistent range picker and vehicle selector above are the canonical recovery controls. */
          className="py-6"
          icon={<Clock3 className="h-7 w-7" aria-hidden="true" />}
          message={t(
            'rangeBuffer.states.empty',
            'No drives were returned for this vehicle-local date window.',
          )}
        />
      ) : result.accounting.includedRows === 0 ? (
        <AlertBanner className="mt-4" variant="info">
          <Text as="p" variant="caption">
            {t(
              'rangeBuffer.states.noQualified',
              'Returned rows contained no complete, valid, non-future arrival with a usable end SoC.',
            )}
          </Text>
        </AlertBanner>
      ) : result.coverage.support.band === 'thin' ? (
        <AlertBanner className="mt-4" variant="info">
          <Text as="p" variant="caption">
            {t(
              'rangeBuffer.states.thinSupport',
              '{{band}} support: interpret arrival summaries as limited returned historical evidence.',
              {
                band: rangeBufferBandLabel(
                  t,
                  result.coverage.support.band,
                ),
              },
            )}
          </Text>
        </AlertBanner>
      ) : null}
    </>
  );
}
