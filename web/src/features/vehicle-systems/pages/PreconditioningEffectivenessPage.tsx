import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';

import { useDriveHistory } from '@/api/hooks/useDriving';
import { useClimateHistory } from '@/api/hooks/useVehicleSystems';
import { VehicleSelect } from '@/components/forms';
import { PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { Button } from '@/components/ui';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber } from '@/lib/numberFormat';
import {
  convertTempFromSI,
  type TemperatureUnitPref,
} from '@/lib/unitConversion';
import {
  PreconditioningClimateDisposition,
  PreconditioningDataAvailability,
  PreconditioningDepartureDirectory,
  PreconditioningDepartureDisposition,
  PreconditioningEvidenceLedger,
  PreconditioningExactAccounting,
  PreconditioningHourlyProfile,
  PreconditioningImprovementComparison,
  PreconditioningImprovementDistribution,
  PreconditioningJoinSupport,
  PreconditioningMethodology,
  PreconditioningReadinessComparison,
  PreconditioningSourceCoverage,
  PreconditioningStrata,
  PreconditioningThresholdConfidence,
  type PreconditioningQueryState,
  type TemperatureDeltaConverter,
  type TemperatureDeltaFormatter,
} from '../components/preconditioning-effectiveness';
import { summarizePreconditioningEffectiveness } from '../lib/preconditioningEffectiveness';

function convertDeltaC(valueC: number, unit: TemperatureUnitPref): number {
  return convertTempFromSI(valueC, unit) - convertTempFromSI(0, unit);
}

export default function PreconditioningEffectivenessPage() {
  const { t } = useTranslation();
  usePageTitle(
    t(
      'preconditioningEffectiveness.title',
      'Preconditioning Effectiveness',
    ),
  );
  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : '';
  const { unitPrefs, formatDuration } = useUnits();
  const climateQuery = useClimateHistory(vehicleIdStr);
  const drivesQuery = useDriveHistory(vehicleIdStr || undefined, 1000);
  const summary = useMemo(
    () => summarizePreconditioningEffectiveness(
      climateQuery.data ?? [],
      drivesQuery.data ?? [],
    ),
    [climateQuery.data, drivesQuery.data],
  );
  const climateHasData = climateQuery.data !== undefined;
  const drivesHaveData = drivesQuery.data !== undefined;
  const retryClimate = useCallback(() => {
    void climateQuery.refetch();
  }, [climateQuery.refetch]);
  const retryDrives = useCallback(() => {
    void drivesQuery.refetch();
  }, [drivesQuery.refetch]);
  const refreshAll = useCallback(() => {
    if (vehicleId == null) return;
    void climateQuery.refetch();
    void drivesQuery.refetch();
  }, [climateQuery.refetch, drivesQuery.refetch, vehicleId]);
  const queryState = useMemo<PreconditioningQueryState>(
    () => ({
      vehicleSelected: vehicleId != null,
      climate: {
        hasData: climateHasData,
        isLoading: climateQuery.isLoading && !climateHasData,
        isResolved:
          climateQuery.isSuccess
          || climateHasData
          || (
            vehicleId != null
            && !climateQuery.isLoading
            && !climateQuery.isError
          ),
        isFetching: climateQuery.isFetching,
        error:
          climateQuery.isError && !climateHasData
            ? climateQuery.error
            : null,
        refreshError:
          climateQuery.isError && climateHasData
            ? climateQuery.error
            : null,
        onRetry: retryClimate,
      },
      drives: {
        hasData: drivesHaveData,
        isLoading: drivesQuery.isLoading && !drivesHaveData,
        isResolved:
          drivesQuery.isSuccess
          || drivesHaveData
          || (
            vehicleId != null
            && !drivesQuery.isLoading
            && !drivesQuery.isError
          ),
        isFetching: drivesQuery.isFetching,
        error:
          drivesQuery.isError && !drivesHaveData
            ? drivesQuery.error
            : null,
        refreshError:
          drivesQuery.isError && drivesHaveData
            ? drivesQuery.error
            : null,
        onRetry: retryDrives,
      },
      onRefresh: refreshAll,
    }),
    [
      climateHasData,
      climateQuery.error,
      climateQuery.isError,
      climateQuery.isFetching,
      climateQuery.isLoading,
      climateQuery.isSuccess,
      drivesHaveData,
      drivesQuery.error,
      drivesQuery.isError,
      drivesQuery.isFetching,
      drivesQuery.isLoading,
      drivesQuery.isSuccess,
      refreshAll,
      retryClimate,
      retryDrives,
      vehicleId,
    ],
  );
  const convertDelta = useCallback<TemperatureDeltaConverter>(
    (valueC) => (
      valueC == null || !Number.isFinite(valueC)
        ? null
        : convertDeltaC(valueC, unitPrefs.temperature)
    ),
    [unitPrefs.temperature],
  );
  const formatDelta = useCallback<TemperatureDeltaFormatter>(
    (valueC, options) => {
      const value = convertDelta(valueC);
      if (value == null) return '—';
      const precision = options?.precision ?? unitPrefs.precision ?? 1;
      const prefix = options?.signed && value > 0 ? '+' : '';
      return `${prefix}${fmtNumber(value, precision)} ${unitPrefs.temperature}`;
    },
    [convertDelta, unitPrefs.precision, unitPrefs.temperature],
  );
  const locale = unitPrefs.locale ?? 'en-US';
  const refreshing = climateQuery.isFetching || drivesQuery.isFetching;

  return (
    <PageContainer
      title={t(
        'preconditioningEffectiveness.title',
        'Preconditioning Effectiveness',
      )}
      subtitle={t(
        'preconditioningEffectiveness.subtitle',
        'Observational pre-drive cabin readiness with explicit source, exclusion, support, and uncertainty accounting',
      )}
      query={[climateQuery, drivesQuery]}
      actions={(
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={refreshAll}
            disabled={vehicleId == null}
            loading={refreshing && vehicleId != null}
            icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
          >
            {t(
              'preconditioningEffectiveness.actions.refresh',
              'Refresh evidence',
            )}
          </Button>
          <VehicleSelect />
        </div>
      )}
    >
      <FadeIn>
        <PreconditioningEvidenceLedger
          summary={summary}
          state={queryState}
          formatDelta={formatDelta}
        />
      </FadeIn>
      <FadeIn delay={0.03}>
        <PreconditioningSourceCoverage
          summary={summary}
          state={queryState}
          formatDuration={formatDuration}
          locale={locale}
        />
      </FadeIn>
      <FadeIn delay={0.04}>
        <PreconditioningClimateDisposition summary={summary} state={queryState} />
      </FadeIn>
      <FadeIn delay={0.05}>
        <PreconditioningDepartureDisposition summary={summary} state={queryState} />
      </FadeIn>
      <FadeIn delay={0.06}>
        <PreconditioningJoinSupport
          summary={summary}
          state={queryState}
          formatDuration={formatDuration}
        />
      </FadeIn>
      <FadeIn delay={0.07}>
        <PreconditioningHourlyProfile
          summary={summary}
          state={queryState}
          formatDelta={formatDelta}
        />
      </FadeIn>
      <FadeIn delay={0.08}>
        <PreconditioningReadinessComparison
          summary={summary}
          state={queryState}
          convertDelta={convertDelta}
          formatDelta={formatDelta}
          temperatureUnit={unitPrefs.temperature}
        />
      </FadeIn>
      <FadeIn delay={0.09}>
        <PreconditioningImprovementComparison
          summary={summary}
          state={queryState}
          convertDelta={convertDelta}
          formatDelta={formatDelta}
          temperatureUnit={unitPrefs.temperature}
        />
      </FadeIn>
      <FadeIn delay={0.1}>
        <PreconditioningStrata
          summary={summary}
          state={queryState}
          formatDelta={formatDelta}
        />
      </FadeIn>
      <FadeIn delay={0.11}>
        <PreconditioningImprovementDistribution
          summary={summary}
          state={queryState}
          formatDelta={formatDelta}
        />
      </FadeIn>
      <FadeIn delay={0.12}>
        <PreconditioningThresholdConfidence
          summary={summary}
          state={queryState}
          formatDuration={formatDuration}
          formatDelta={formatDelta}
        />
      </FadeIn>
      <FadeIn delay={0.13}>
        <PreconditioningDepartureDirectory
          summary={summary}
          state={queryState}
          locale={locale}
          formatDuration={formatDuration}
          formatDelta={formatDelta}
        />
      </FadeIn>
      <FadeIn delay={0.14}>
        <PreconditioningExactAccounting summary={summary} state={queryState} />
      </FadeIn>
      <FadeIn delay={0.15}>
        <PreconditioningDataAvailability summary={summary} state={queryState} />
      </FadeIn>
      <FadeIn delay={0.16}>
        <PreconditioningMethodology summary={summary} />
      </FadeIn>
    </PageContainer>
  );
}
