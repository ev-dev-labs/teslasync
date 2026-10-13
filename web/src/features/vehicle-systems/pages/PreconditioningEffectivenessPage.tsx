import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';

import { useDriveHistory } from '@/api/hooks/useDriving';
import { useClimateHistory } from '@/api/hooks/useVehicleSystems';

import { PageLayout } from '@/components/layout';
import { deriveDataState } from '@/api/dataState';
import { FadeIn } from '@/components/motion';
import { Button, Icon } from '@/components/ui';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';

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
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

function convertDeltaC(valueC: number, unit: TemperatureUnitPref): number {
  return convertTempFromSI(valueC, unit) - convertTempFromSI(0, unit);
}

export default function PreconditioningEffectivenessPage() {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  usePageTitle(
    t(
      'preconditioningEffectiveness.title',
      'Preconditioning effectiveness',
    ),
  );
  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : '';
  const { unitPrefs, formatDuration } = useUnits();
  const climateQuery = useClimateHistory(vehicleIdStr);
  const drivesQuery = useDriveHistory(vehicleIdStr || undefined, 1000);
  const climateSource = deriveDataState(climateQuery, { provenance: 'historical' });
  const drivesSource = deriveDataState(drivesQuery, { provenance: 'historical' });
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
        isLoading:
          !climateHasData
          && (
            climateQuery.isLoading
            || (
              climateQuery.isPending
              && climateQuery.fetchStatus === 'fetching'
            )
          ),
        isResolved: climateQuery.isSuccess || climateHasData,
        isFetching: climateQuery.isFetching,
        // A paused refresh still retains historical evidence; it is not a fresh load.
        isPaused: climateQuery.fetchStatus === 'paused',
        error: climateSource.fatalError,
        refreshError: climateSource.refreshError,
        onRetry: retryClimate,
      },
      drives: {
        hasData: drivesHaveData,
        isLoading:
          !drivesHaveData
          && (
            drivesQuery.isLoading
            || (
              drivesQuery.isPending
              && drivesQuery.fetchStatus === 'fetching'
            )
          ),
        isResolved: drivesQuery.isSuccess || drivesHaveData,
        isFetching: drivesQuery.isFetching,
        isPaused: drivesQuery.fetchStatus === 'paused',
        error: drivesSource.fatalError,
        refreshError: drivesSource.refreshError,
        onRetry: retryDrives,
      },
      onRefresh: refreshAll,
    }),
    [
      climateHasData,
      climateQuery.error,
      climateQuery.fetchStatus,
      climateQuery.isError,
      climateQuery.isFetching,
      climateQuery.isLoading,
      climateQuery.isPending,
      climateQuery.isSuccess,
      climateSource.fatalError,
      climateSource.refreshError,
      drivesHaveData,
      drivesQuery.error,
      drivesQuery.fetchStatus,
      drivesQuery.isError,
      drivesQuery.isFetching,
      drivesQuery.isLoading,
      drivesQuery.isPending,
      drivesQuery.isSuccess,
      drivesSource.fatalError,
      drivesSource.refreshError,
      refreshAll,
      retryClimate,
      retryDrives,
      vehicleId,
    ],
  );
  // SectionBody's current paused guard means 'no usable evidence'. Keep that
  // presentation contract separate from the ledger's actual transport state,
  // so offline refreshes disclose retained evidence without blanking its panels.
  const sectionState: PreconditioningQueryState = {
    ...queryState,
    climate: {
      ...queryState.climate,
      isPaused: queryState.climate.isPaused && !climateHasData,
    },
    drives: {
      ...queryState.drives,
      isPaused: queryState.drives.isPaused && !drivesHaveData,
    },
  };
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
    [convertDelta, unitPrefs.precision, unitPrefs.temperature, fmtNumber],
  );
  const locale = unitPrefs.locale ?? 'en-US';
  const refreshing = climateQuery.isFetching || drivesQuery.isFetching;

  return (
    <PageLayout
      title={t(
        'preconditioningEffectiveness.title',
        'Preconditioning effectiveness',
      )}
      subtitle={t(
        'preconditioningEffectiveness.subtitle',
        'Observational pre-drive cabin readiness with explicit source, exclusion, support, and uncertainty accounting',
      )}
      query={[climateQuery, drivesQuery]}
      secondaryActions={(
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            wrapLabel
            className="min-h-11 md:min-h-9"
            onClick={refreshAll}
            disabled={vehicleId == null}
            loading={refreshing && vehicleId != null}
            icon={<Icon icon={RefreshCw} />}
          >
            {t(
              'preconditioningEffectiveness.actions.refresh',
              'Refresh evidence',
            )}
          </Button>
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
        <PreconditioningClimateDisposition summary={summary} state={sectionState} />
      </FadeIn>
      <FadeIn delay={0.05}>
        <PreconditioningDepartureDisposition summary={summary} state={sectionState} />
      </FadeIn>
      <FadeIn delay={0.06}>
        <PreconditioningJoinSupport
          summary={summary}
          state={sectionState}
          formatDuration={formatDuration}
        />
      </FadeIn>
      <FadeIn delay={0.07}>
        <PreconditioningHourlyProfile
          summary={summary}
          state={sectionState}
          formatDelta={formatDelta}
        />
      </FadeIn>
      <FadeIn delay={0.08}>
        <PreconditioningReadinessComparison
          summary={summary}
          state={sectionState}
          convertDelta={convertDelta}
          formatDelta={formatDelta}
          temperatureUnit={unitPrefs.temperature}
        />
      </FadeIn>
      <FadeIn delay={0.09}>
        <PreconditioningImprovementComparison
          summary={summary}
          state={sectionState}
          convertDelta={convertDelta}
          formatDelta={formatDelta}
          temperatureUnit={unitPrefs.temperature}
        />
      </FadeIn>
      <FadeIn delay={0.1}>
        <PreconditioningStrata
          summary={summary}
          state={sectionState}
          formatDelta={formatDelta}
        />
      </FadeIn>
      <FadeIn delay={0.11}>
        <PreconditioningImprovementDistribution
          summary={summary}
          state={sectionState}
          formatDelta={formatDelta}
        />
      </FadeIn>
      <FadeIn delay={0.12}>
        <PreconditioningThresholdConfidence
          summary={summary}
          state={sectionState}
          formatDuration={formatDuration}
          formatDelta={formatDelta}
        />
      </FadeIn>
      <FadeIn delay={0.13}>
        <PreconditioningDepartureDirectory
          summary={summary}
          state={sectionState}
          locale={locale}
          formatDuration={formatDuration}
          formatDelta={formatDelta}
        />
      </FadeIn>
      <FadeIn delay={0.14}>
        <PreconditioningExactAccounting summary={summary} state={sectionState} />
      </FadeIn>
      <FadeIn delay={0.15}>
        <PreconditioningDataAvailability summary={summary} state={sectionState} />
      </FadeIn>
      <FadeIn delay={0.16}>
        <PreconditioningMethodology summary={summary} state={sectionState} />
      </FadeIn>
    </PageLayout>
  );
}
