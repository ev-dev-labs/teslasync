import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useClimateHistory } from '@/api/hooks/useVehicleSystems';

import { PageLayout, type CardGridItem } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { useDataState } from '@/hooks/useDataState';
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
  CabinThermalFitQuality,
  CabinThermalMethodology,
  CabinThermalPredictionScenario,
  CabinThermalRejectionReasons,
  CabinThermalSegmentationDiagnostics,
  CabinThermalSourceCoverage,
  CabinThermalThresholdMatrix,
} from '../components/cabin-thermal';
import {
  CabinThermalEvidenceStats,
  CabinThermalGrid,
  cabinThermalSourceState,
} from '../components/cabin-thermal-modernization';
import { summarizeCabinThermal } from '../lib/cabinThermal';

export default function CabinThermalPage() {
  const { t, i18n } = useTranslation();
  usePageTitle(t('cabinThermal.title', 'Cabin thermal model'));

  const { vehicleId } = useSelectedVehicle();
  const {
    unitPrefs,
    formatTemperature,
    formatDuration,
  } = useUnits();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : '';
  const climateQuery = useClimateHistory(vehicleIdStr);
  const climateState = useDataState(climateQuery, { provenance: 'historical' });
  const samples = useMemo(
    () => (vehicleId != null ? climateState.data ?? [] : []),
    [climateState.data, vehicleId],
  );
  const summary = useMemo(
    () => summarizeCabinThermal(samples),
    [samples],
  );
  const state = cabinThermalSourceState(
    climateState,
    climateQuery,
    vehicleId != null,
    () => void climateQuery.refetch(),
  );
  const locale = i18n.language;

  const items: CardGridItem[] = [
    { id: 'evidence', size: 'full', content: (
      <FadeIn>
        <CabinThermalEvidenceStats
          summary={summary}
          state={state}
          formatDuration={formatDuration}
        />
      </FadeIn>
    ) },
    { id: 'source-coverage', size: 'half', content: (
      <FadeIn delay={0.04}>
        <CabinThermalSourceCoverage
          summary={summary}
          state={state}
          locale={locale}
          formatDuration={formatDuration}
        />
      </FadeIn>
    ) },
    { id: 'segmentation', size: 'half', content: (
      <FadeIn delay={0.04}>
        <CabinThermalSegmentationDiagnostics summary={summary} state={state} />
      </FadeIn>
    ) },
    { id: 'disposition', size: 'half', content: (
      <FadeIn delay={0.08}>
        <CabinThermalCandidateDisposition summary={summary} state={state} />
      </FadeIn>
    ) },
    { id: 'rejections', size: 'half', content: (
      <FadeIn delay={0.08}>
        <CabinThermalRejectionReasons summary={summary} state={state} />
      </FadeIn>
    ) },
    { id: 'funnel', size: 'half', content: (
      <FadeIn delay={0.12}>
        <CabinThermalAcceptanceFunnel summary={summary} state={state} />
      </FadeIn>
    ) },
    { id: 'thresholds', size: 'half', content: (
      <FadeIn delay={0.12}>
        <CabinThermalThresholdMatrix
          summary={summary}
          state={state}
          locale={locale}
          temperatureUnit={unitPrefs.temperature}
          formatDuration={formatDuration}
        />
      </FadeIn>
    ) },
    { id: 'candidate-directory', size: 'full', content: (
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
    ) },
    { id: 'fit-quality', size: 'half', content: (
      <FadeIn delay={0.2}>
        <CabinThermalFitQuality
          summary={summary}
          state={state}
          formatDuration={formatDuration}
        />
      </FadeIn>
    ) },
    { id: 'direction-profile', size: 'half', content: (
      <FadeIn delay={0.2}>
        <CabinThermalDirectionProfile
          summary={summary}
          state={state}
          locale={locale}
          temperatureUnit={unitPrefs.temperature}
          formatDuration={formatDuration}
        />
      </FadeIn>
    ) },
    { id: 'accepted-directory', size: 'full', content: (
      <FadeIn delay={0.24}>
        <CabinThermalAcceptedDirectory
          summary={summary}
          state={state}
          locale={locale}
          formatTemperature={formatTemperature}
          formatDuration={formatDuration}
        />
      </FadeIn>
    ) },
    { id: 'prediction', size: 'full', content: (
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
    ) },
    { id: 'accounting', size: 'full', content: (
      <FadeIn delay={0.32}>
        <CabinThermalAccountingMatrix summary={summary} state={state} />
      </FadeIn>
    ) },
    { id: 'methodology', size: 'full', content: (
      <FadeIn delay={0.36}>
        <CabinThermalMethodology summary={summary} />
      </FadeIn>
    ) },
  ];

  return (
    <PageLayout
      className="w-full min-w-0"
      title={t('cabinThermal.title', 'Cabin thermal model')}
      subtitle={t(
        'cabinThermal.subtitle',
        'A gate-by-gate audit of parked cabin relaxation, from returned climate rows to accepted Newton-cooling fits',
      )}
      query={climateQuery}
    >
      <CabinThermalGrid
        items={items}
        label={t('cabinThermal.title', 'Cabin thermal model')}
      />
    </PageLayout>
  );
}
