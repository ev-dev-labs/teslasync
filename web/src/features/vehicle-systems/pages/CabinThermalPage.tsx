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
  CabinThermalAcceptedDirectory,
  CabinThermalAcceptanceFunnel,
  CabinThermalAccountingMatrix,
  CabinThermalCandidateDirectory,
  CabinThermalCandidateDisposition,
  CabinThermalDirectionProfile,
  CabinThermalEvidenceKpiBand,
  CabinThermalFitQuality,
  CabinThermalMethodology,
  CabinThermalPredictionScenario,
  CabinThermalRejectionReasons,
  CabinThermalSegmentationDiagnostics,
  CabinThermalSourceCoverage,
  CabinThermalThresholdMatrix,
  type CabinThermalQueryState,
} from '../components/cabin-thermal';
import { summarizeCabinThermal } from '../lib/cabinThermal';

const TWO_COLUMNS = { default: 1, xl: 2 } as const;

export default function CabinThermalPage() {
  const { t, i18n } = useTranslation();
  usePageTitle(t('cabinThermal.title', 'Cabin Thermal Model'));

  const { vehicleId } = useSelectedVehicle();
  const {
    unitPrefs,
    formatTemperature,
    formatDuration,
  } = useUnits();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : '';
  const climateQuery = useClimateHistory(vehicleIdStr);
  const hasCachedData =
    vehicleId != null && climateQuery.data !== undefined;
  const isResolved =
    vehicleId != null && (hasCachedData || climateQuery.isSuccess);
  const samples = useMemo(
    () => (vehicleId != null ? climateQuery.data ?? [] : []),
    [climateQuery.data, vehicleId],
  );
  const summary = useMemo(
    () => summarizeCabinThermal(samples),
    [samples],
  );
  const state: CabinThermalQueryState = {
    vehicleSelected: vehicleId != null,
    isLoading:
      vehicleId != null && !hasCachedData && climateQuery.isLoading,
    isResolved,
    error:
      climateQuery.isError && !hasCachedData
        ? climateQuery.error
        : null,
    refreshError:
      climateQuery.isError && hasCachedData
        ? climateQuery.error
        : null,
    onRetry: () => void climateQuery.refetch(),
  };
  const locale = i18n.language;

  return (
    <PageContainer
      title={t('cabinThermal.title', 'Cabin Thermal Model')}
      subtitle={t(
        'cabinThermal.subtitle',
        'A gate-by-gate audit of parked cabin relaxation, from returned climate rows to accepted Newton-cooling fits',
      )}
      actions={<VehicleSelect />}
      query={climateQuery}
    >
      <FadeIn>
        <CabinThermalEvidenceKpiBand
          summary={summary}
          state={state}
          formatDuration={formatDuration}
        />
      </FadeIn>

      <FadeIn delay={0.04}>
        <Grid cols={TWO_COLUMNS} gap={4}>
          <CabinThermalSourceCoverage
            summary={summary}
            state={state}
            locale={locale}
            formatDuration={formatDuration}
          />
          <CabinThermalSegmentationDiagnostics summary={summary} state={state} />
        </Grid>
      </FadeIn>

      <FadeIn delay={0.08}>
        <Grid cols={TWO_COLUMNS} gap={4}>
          <CabinThermalCandidateDisposition summary={summary} state={state} />
          <CabinThermalRejectionReasons summary={summary} state={state} />
        </Grid>
      </FadeIn>

      <FadeIn delay={0.12}>
        <Grid cols={TWO_COLUMNS} gap={4}>
          <CabinThermalAcceptanceFunnel summary={summary} state={state} />
          <CabinThermalThresholdMatrix
            summary={summary}
            state={state}
            locale={locale}
            temperatureUnit={unitPrefs.temperature}
            formatDuration={formatDuration}
          />
        </Grid>
      </FadeIn>

      <FadeIn delay={0.16}>
        <CabinThermalCandidateDirectory
          summary={summary}
          state={state}
          locale={locale}
          temperatureUnit={unitPrefs.temperature}
          formatTemperature={formatTemperature}
          formatDuration={formatDuration}
        />
      </FadeIn>

      <FadeIn delay={0.2}>
        <Grid cols={TWO_COLUMNS} gap={4}>
          <CabinThermalFitQuality
            summary={summary}
            state={state}
            formatDuration={formatDuration}
          />
          <CabinThermalDirectionProfile
            summary={summary}
            state={state}
            locale={locale}
            temperatureUnit={unitPrefs.temperature}
            formatDuration={formatDuration}
          />
        </Grid>
      </FadeIn>

      <FadeIn delay={0.24}>
        <CabinThermalAcceptedDirectory
          summary={summary}
          state={state}
          locale={locale}
          formatTemperature={formatTemperature}
          formatDuration={formatDuration}
        />
      </FadeIn>

      <FadeIn delay={0.28}>
        <CabinThermalPredictionScenario
          summary={summary}
          state={state}
          temperatureUnit={unitPrefs.temperature}
          durationUnit={unitPrefs.duration}
          formatTemperature={formatTemperature}
          formatDuration={formatDuration}
        />
      </FadeIn>

      <FadeIn delay={0.32}>
        <CabinThermalAccountingMatrix summary={summary} state={state} />
      </FadeIn>

      <FadeIn delay={0.36}>
        <CabinThermalMethodology summary={summary} />
      </FadeIn>
    </PageContainer>
  );
}
