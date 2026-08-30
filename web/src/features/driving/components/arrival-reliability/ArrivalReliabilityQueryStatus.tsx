import {
  Clock3,
  LoaderCircle,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AlertBanner, EmptyState, QueryError } from '@/components/feedback';
import { Button, Text } from '@/components/ui';
import type { ArrivalReliabilityResult } from '../../lib/arrivalReliability';
import { arrivalEvidenceBandLabel } from './labels';
import type { ArrivalReliabilityQueryState } from './types';

interface ArrivalReliabilityQueryStatusProps {
  analysis: ArrivalReliabilityResult;
  state: ArrivalReliabilityQueryState;
}

/** The page's only actionable query status and retry surface. */
export function ArrivalReliabilityQueryStatus({
  analysis,
  state,
}: ArrivalReliabilityQueryStatusProps) {
  const { t } = useTranslation();

  if (!state.vehicleSelected) {
    return (
      <EmptyState /* no-action: retry, vehicle, and range controls are owned by the parent page */
        className="py-6"
        icon={<Clock3 className="h-7 w-7" aria-hidden="true" />}
        message={t(
          'arrivalReliability.states.noVehicle',
          'Select a vehicle to analyze its returned directional-route timing.',
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
          'arrivalReliability.states.loadingAria',
          'Loading arrival timing history',
        )}
        icon={<LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />}
      >
        <Text as="p" variant="caption">
          {t(
            'arrivalReliability.states.loading',
            'Loading up to 1,000 recent drives…',
          )}
        </Text>
      </AlertBanner>
    );
  }
  if (state.error) {
    return (
      <div className="mt-4" data-testid="arrival-initial-error">
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
              'arrivalReliability.states.refreshError',
              'Drive history could not refresh. Showing the most recently loaded timing evidence.',
            )}
          </Text>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={state.onRetry}
          >
            {t('arrivalReliability.states.retry', 'Retry')}
          </Button>
        </div>
      </AlertBanner>
    );
  }
  if (!state.isResolved) return null;

  return (
    <>
      {analysis.accounting.historyCapReached ? (
        <AlertBanner
          className="mt-4"
          variant="warning"
          icon={<TriangleAlert className="h-4 w-4" aria-hidden="true" />}
        >
          <Text as="p" variant="caption">
            {t(
              'arrivalReliability.states.capReached',
              'Exactly 1,000 rows were returned. Findings cover the returned latest history and may not represent lifetime driving.',
            )}
          </Text>
        </AlertBanner>
      ) : null}
      {analysis.accounting.returnedRows === 0 ? (
        <EmptyState /* no-action: retry, vehicle, and range controls are owned by the parent page */
          className="py-6"
          icon={<Clock3 className="h-7 w-7" aria-hidden="true" />}
          message={t(
            'arrivalReliability.states.empty',
            'No drives were returned, so no route timing claim is made.',
          )}
        />
      ) : analysis.accounting.includedRows === 0 ? (
        <AlertBanner className="mt-4" variant="info">
          <Text as="p" variant="caption">
            {t(
              'arrivalReliability.states.noQualified',
              'Returned rows contained no complete, valid, non-future drive with usable route endpoints.',
            )}
          </Text>
        </AlertBanner>
      ) : analysis.routes.length === 0 ? (
        <AlertBanner className="mt-4" variant="info">
          <Text as="p" variant="caption">
            {t(
              'arrivalReliability.states.insufficientRoutes',
              'Included drives are available, but no directional route has three samples yet.',
            )}
          </Text>
        </AlertBanner>
      ) : analysis.coverage.globalSupport.band === 'thin' ? (
        <AlertBanner className="mt-4" variant="info">
          <Text as="p" variant="caption">
            {t(
              'arrivalReliability.states.thinSupport',
              '{{band}}: interpret route timing summaries as limited historical evidence.',
              {
                band: arrivalEvidenceBandLabel(
                  t,
                  analysis.coverage.globalSupport.band,
                ),
              },
            )}
          </Text>
        </AlertBanner>
      ) : null}
    </>
  );
}
