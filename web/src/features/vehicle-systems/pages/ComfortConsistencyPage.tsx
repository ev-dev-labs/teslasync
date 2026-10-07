import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useClimateHistory } from '@/api/hooks/useVehicleSystems';

import { PageLayout } from '@/components/layout';
import { deriveDataState } from '@/api/dataState';
import { FadeIn } from '@/components/motion';
import {
  ComfortConsistencyCoverageCadence,
  ComfortConsistencyDataAvailability,
  ComfortConsistencyDeviationDistribution,
  ComfortConsistencyEvidenceKpiLedger,
  ComfortConsistencyExactAccounting,
  ComfortConsistencyHourlyProfile,
  ComfortConsistencyIntervalComposition,
  ComfortConsistencyMethodology,
  ComfortConsistencyRowDisposition,
  ComfortConsistencyScoreDecomposition,
  ComfortConsistencySetpointAgreement,
  ComfortConsistencySourceAvailability,
  ComfortConsistencyStabilizationOutcomes,
  ComfortConsistencyThresholdGateMatrix,
  ComfortConsistencyWindowDirectory,
  type ComfortConsistencyQueryState,
  type TemperatureDeltaFormatter,
} from '../components/comfort-consistency';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';

import {
  convertTempFromSI,
  type TemperatureUnitPref,
} from '@/lib/unitConversion';
import { summarizeComfortConsistency } from '../lib/comfortConsistency';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

const convertDeltaC = (valueC: number, unit: TemperatureUnitPref): number =>
  convertTempFromSI(valueC, unit) - convertTempFromSI(0, unit);
export default function ComfortConsistencyPage() {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  usePageTitle(t('comfortConsistency.title', 'Comfort consistency'));
  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : '';
  const { unitPrefs, formatDuration } = useUnits();
  const climateQuery = useClimateHistory(vehicleIdStr);
  const climateSource = deriveDataState(climateQuery, { provenance: 'historical' });
  const summary = useMemo(
    () => summarizeComfortConsistency(climateQuery.data ?? []),
    [climateQuery.data],
  );
  const formatDelta = useCallback<TemperatureDeltaFormatter>(
    (valueC, options) => {
      if (valueC == null || !Number.isFinite(valueC)) return '—';
      const precision = options?.precision ?? unitPrefs.precision ?? 1;
      return `${fmtNumber(
        convertDeltaC(valueC, unitPrefs.temperature),
        precision,
      )} ${unitPrefs.temperature}`;
    },
    [unitPrefs.precision, unitPrefs.temperature, fmtNumber],
  );
  const hasData = climateQuery.data !== undefined;
  const queryState = useMemo<ComfortConsistencyQueryState>(
    () => ({
      vehicleSelected: vehicleId != null,
      isLoading: climateQuery.isLoading && !climateSource.hasData,
      isPaused: climateSource.isRefreshBlocked,
      isResolved:
        hasData || (!climateSource.isRefreshBlocked && (
          climateQuery.isSuccess || (!climateQuery.isLoading && !climateQuery.isError)
        )),
      error: climateSource.fatalError,
      refreshError: climateSource.refreshError,
      onRetry: () => {
        void climateQuery.refetch();
      },
    }),
    [
      climateQuery.error,
      climateQuery.isError,
      climateQuery.isLoading,
      climateQuery.isSuccess,
      climateQuery.refetch,
      climateSource.fatalError,
      climateSource.refreshError,
      climateSource.hasData,
      climateSource.isRefreshBlocked,
      hasData,
      vehicleId,
    ],
  );
  const locale = unitPrefs.locale ?? 'en-US';

  return (
    <PageLayout
      title={t('comfortConsistency.title', 'Comfort consistency')}
      subtitle={t(
        'comfortConsistency.subtitle',
        'Evidence-qualified cabin-to-setpoint adherence, stabilization, and overshoot from the returned climate timeline',
      )}
      query={climateQuery}
    >
      <FadeIn>
        <ComfortConsistencyEvidenceKpiLedger
          summary={summary}
          state={queryState}
          formatDuration={formatDuration}
          formatDelta={formatDelta}
        />
      </FadeIn>
      <FadeIn delay={0.03}>
        <ComfortConsistencySourceAvailability summary={summary} state={queryState} />
      </FadeIn>
      <FadeIn delay={0.04}>
        <ComfortConsistencyCoverageCadence
          summary={summary}
          state={queryState}
          locale={locale}
          formatDuration={formatDuration}
        />
      </FadeIn>
      <FadeIn delay={0.05}>
        <ComfortConsistencyRowDisposition summary={summary} state={queryState} />
      </FadeIn>
      <FadeIn delay={0.06}>
        <ComfortConsistencyIntervalComposition
          summary={summary}
          state={queryState}
          formatDuration={formatDuration}
          formatDelta={formatDelta}
        />
      </FadeIn>
      <FadeIn delay={0.07}>
        <ComfortConsistencyHourlyProfile
          summary={summary}
          state={queryState}
          formatDuration={formatDuration}
        />
      </FadeIn>
      <FadeIn delay={0.08}>
        <ComfortConsistencyDeviationDistribution
          summary={summary}
          state={queryState}
          formatDelta={formatDelta}
        />
      </FadeIn>
      <FadeIn delay={0.09}>
        <ComfortConsistencySetpointAgreement
          summary={summary}
          state={queryState}
          formatDelta={formatDelta}
        />
      </FadeIn>
      <FadeIn delay={0.1}>
        <ComfortConsistencyStabilizationOutcomes
          summary={summary}
          state={queryState}
          formatDuration={formatDuration}
          formatDelta={formatDelta}
        />
      </FadeIn>
      <FadeIn delay={0.11}>
        <ComfortConsistencyScoreDecomposition
          summary={summary}
          state={queryState}
          formatDuration={formatDuration}
          formatDelta={formatDelta}
        />
      </FadeIn>
      <FadeIn delay={0.12}>
        <ComfortConsistencyThresholdGateMatrix
          summary={summary}
          state={queryState}
          formatDuration={formatDuration}
          formatDelta={formatDelta}
        />
      </FadeIn>
      <FadeIn delay={0.13}>
        <ComfortConsistencyWindowDirectory
          summary={summary}
          state={queryState}
          locale={locale}
          formatDuration={formatDuration}
          formatDelta={formatDelta}
        />
      </FadeIn>
      <FadeIn delay={0.14}>
        <ComfortConsistencyExactAccounting
          summary={summary}
          state={queryState}
          formatDuration={formatDuration}
        />
      </FadeIn>
      <FadeIn delay={0.15}>
        <ComfortConsistencyDataAvailability summary={summary} state={queryState} />
      </FadeIn>
      <FadeIn delay={0.16}>
        <ComfortConsistencyMethodology summary={summary} />
      </FadeIn>
    </PageLayout>
  );
}
