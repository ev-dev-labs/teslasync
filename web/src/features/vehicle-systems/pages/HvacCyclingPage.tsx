import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useClimateHistory } from '@/api/hooks/useVehicleSystems';
import { VehicleSelect } from '@/components/forms';
import { Grid, PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';

import {
  HvacCyclingCoverageCadence,
  HvacCyclingCycleDiagnostics,
  HvacCyclingDataAvailability,
  HvacCyclingDutyComposition,
  HvacCyclingEvidenceKpiLedger,
  HvacCyclingExactAccounting,
  HvacCyclingHourlyDuty,
  HvacCyclingIntervalDisposition,
  HvacCyclingMethodology,
  HvacCyclingRunDirectory,
  HvacCyclingRunLengthDistribution,
  HvacCyclingSourceAvailability,
  HvacCyclingThresholdGateMatrix,
  HvacCyclingTransitionMatrix,
  type HvacCyclingQueryState,
} from '../components/hvac-cycling';
import { summarizeHvacCycling } from '../lib/hvacCycling';

const TWO_COLUMNS = { default: 1, xl: 2 } as const;

export default function HvacCyclingPage() {
  const { t, i18n } = useTranslation();
  usePageTitle(t('hvacCycling.title', 'HVAC Cycling'));

  const { vehicleId } = useSelectedVehicle();
  const { formatDuration } = useUnits();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : '';
  const climateQuery = useClimateHistory(vehicleIdStr);
  const hasCachedData =
    vehicleId != null && climateQuery.data !== undefined;
  const dataAvailable =
    vehicleId != null && (hasCachedData || climateQuery.isSuccess);
  const isLoading =
    vehicleId != null
    && !dataAvailable
    && (climateQuery.isLoading || climateQuery.isFetching);
  const samples = useMemo(
    () => (vehicleId != null ? climateQuery.data ?? [] : []),
    [climateQuery.data, vehicleId],
  );
  const summary = useMemo(
    () => summarizeHvacCycling(samples),
    [samples],
  );
  const state: HvacCyclingQueryState = {
    vehicleSelected: vehicleId != null,
    isLoading,
    isResolved:
      vehicleId != null
      && (
        dataAvailable
        || (!isLoading && climateQuery.isError)
      ),
    error:
      vehicleId != null && !hasCachedData && climateQuery.isError
        ? climateQuery.error
        : null,
    refreshError:
      hasCachedData && climateQuery.isError
        ? climateQuery.error
        : null,
    onRetry: () => {
      void climateQuery.refetch();
    },
  };

  return (
    <PageContainer
      title={t('hvacCycling.title', 'HVAC Cycling')}
      subtitle={t(
        'hvacCycling.subtitle',
        'An evidence chain from returned climate rows to gap-qualified intervals, censored runs, and complete-cycle diagnostics',
      )}
      actions={<VehicleSelect />}
      query={climateQuery}
    >
      <FadeIn>
        <HvacCyclingEvidenceKpiLedger
          summary={summary}
          state={state}
          formatDuration={formatDuration}
        />
      </FadeIn>

      <FadeIn delay={0.04}>
        <Grid cols={TWO_COLUMNS} gap={4}>
          <HvacCyclingSourceAvailability summary={summary} state={state} />
          <HvacCyclingCoverageCadence
            summary={summary}
            state={state}
            locale={i18n.language}
            formatDuration={formatDuration}
          />
        </Grid>
      </FadeIn>

      <FadeIn delay={0.08}>
        <Grid cols={TWO_COLUMNS} gap={4}>
          <HvacCyclingIntervalDisposition summary={summary} state={state} />
          <HvacCyclingDutyComposition
            summary={summary}
            state={state}
            formatDuration={formatDuration}
          />
        </Grid>
      </FadeIn>

      <FadeIn delay={0.12}>
        <HvacCyclingHourlyDuty
          summary={summary}
          state={state}
          formatDuration={formatDuration}
        />
      </FadeIn>

      <FadeIn delay={0.16}>
        <Grid cols={TWO_COLUMNS} gap={4}>
          <HvacCyclingTransitionMatrix summary={summary} state={state} />
          <HvacCyclingRunLengthDistribution
            summary={summary}
            state={state}
            formatDuration={formatDuration}
          />
        </Grid>
      </FadeIn>

      <FadeIn delay={0.2}>
        <Grid cols={TWO_COLUMNS} gap={4}>
          <HvacCyclingCycleDiagnostics summary={summary} state={state} />
          <HvacCyclingThresholdGateMatrix
            summary={summary}
            state={state}
            formatDuration={formatDuration}
          />
        </Grid>
      </FadeIn>

      <FadeIn delay={0.24}>
        <HvacCyclingRunDirectory
          summary={summary}
          state={state}
          locale={i18n.language}
          formatDuration={formatDuration}
        />
      </FadeIn>

      <FadeIn delay={0.28}>
        <HvacCyclingExactAccounting summary={summary} state={state} />
      </FadeIn>

      <FadeIn delay={0.32}>
        <HvacCyclingDataAvailability summary={summary} state={state} />
      </FadeIn>

      <FadeIn delay={0.36}>
        <HvacCyclingMethodology summary={summary} />
      </FadeIn>
    </PageContainer>
  );
}
