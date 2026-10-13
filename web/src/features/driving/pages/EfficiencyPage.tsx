import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { SectionTitle } from '@/components/ui';
import { SavedViewMenu } from '@/components/data-display';
import { PageLayout, CardGrid } from '@/components/layout';
import { SectionErrorBoundary } from '@/components/feedback';
import { useDrivingStats, useDriveCalendarHistory } from '@/api/hooks/useDriving';
import { useUnits } from '@/hooks/useUnits';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useSavedViewUrl } from '@/hooks/useSavedViewUrl';
import { useRangeState } from '@/hooks/useRangeState';
import { useDataState } from '@/hooks/useDataState';
import {
  EfficiencyOverview, EfficiencyTrend, EfficiencySpeedDistribution,
  EfficiencyScatter, EfficiencyTemperatureTable,
  buildEfficiencyModel, inspectStats, inspectDrives,
  type StatsPresentation, type DrivesPresentation,
} from '../components/efficiency-modernization';
import { EfficiencyEvidenceBrief } from '../components/operationalbrief-a-m/EfficiencyEvidenceBrief';

// Public helper identities retained for existing consumers and contract tests.
export { efficiencyColor } from '../components/efficiency-modernization';
export { getEfficiency } from '@/lib/drivesAggregation';

export default function EfficiencyPage() {
  const { t } = useTranslation();
  usePageTitle(t('efficiency.title', 'Efficiency'));
  const savedView = useSavedViewUrl();
  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const { startInstant, endInstantExclusive } = useRangeState({ persistKey: 'efficiency.range' });
  // Lifetime summary remains independent of the header's bounded observations.
  const statsQuery = useDrivingStats(vehicleIdStr);
  const drivesQuery = useDriveCalendarHistory(vehicleIdStr, startInstant, endInstantExclusive);
  const units = useUnits();
  const statsInspection = inspectStats(statsQuery.data);
  const drivesInspection = useMemo(() => inspectDrives(drivesQuery.data), [drivesQuery.data]);
  const statsState = useDataState(statsQuery, {
    provenance: 'historical', partial: statsInspection.partial,
    unavailable: statsQuery.isSuccess && statsQuery.data == null,
  });
  const drivesState = useDataState(drivesQuery, {
    provenance: 'historical', partial: drivesInspection.partial,
    unavailable: drivesQuery.isSuccess && drivesInspection.valid && drivesInspection.rows.length === 0,
  });
  const model = useMemo(() => buildEfficiencyModel(
    drivesInspection.rows, units.unitPrefs, startInstant, endInstantExclusive,
  ), [drivesInspection.rows, units.unitPrefs, startInstant, endInstantExclusive]);
  const statsProps: StatsPresentation = {
    stats: statsInspection.data, model, units,
    source: {
      state: statsState, loading: statsQuery.isLoading,
      malformed: statsQuery.data != null && !statsInspection.valid,
    },
  };
  const drivesProps: DrivesPresentation = {
    model, units,
    source: {
      state: drivesState, loading: drivesQuery.isLoading,
      malformed: drivesQuery.data != null && !drivesInspection.valid,
    },
  };
  const dataSources = useMemo(() => [
    { id: 'efficiency-summary', label: t('dataSources.labels.efficiencySummary', 'Efficiency summary'), query: statsQuery },
    { id: 'drive-history', label: t('dataSources.labels.driveHistory', 'Drive history'), query: drivesQuery },
  ], [statsQuery, drivesQuery, t]);
  return (
    <PageLayout
      title={t('efficiency.title', 'Efficiency')}
      subtitle={t('efficiency.subtitle', 'Energy consumption and driving efficiency analysis')}
      query={[statsQuery, drivesQuery]}
      dataSources={dataSources}
      overflowActions={
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <SavedViewMenu route="/efficiency" currentQuery={savedView.currentQuery} onApply={savedView.apply} />
        </div>
      }
    >
      {/* A — all eight original KPIs and the specialist glossary. */}
      <section aria-label={t('efficiency.section.kpis', 'Key metrics')} className="min-w-0">
        <SectionErrorBoundary name="EfficiencyKeyMetrics">
          <EfficiencyEvidenceBrief {...statsProps} kind="kpis" />
        </SectionErrorBoundary>
      </section>
      {/* B — original overview gauge/bars + annotated daily series. */}
      <section aria-label={t('efficiency.section.overview', 'Overview and trend')} className="min-w-0 space-y-3">
          <SectionTitle>{t('efficiency.section.overview', 'Overview & trend')}</SectionTitle>
          <CardGrid label={t('efficiency.section.overview', 'Overview and trend')} items={[
            { id: 'overview', size: 'third', content: <SectionErrorBoundary name="EfficiencyOverview">
              <EfficiencyOverview {...statsProps} />
            </SectionErrorBoundary> },
            { id: 'daily-trend', size: 'half', content: <SectionErrorBoundary name="EfficiencyDailyTrend">
              <EfficiencyTrend {...drivesProps} selectedVehicleId={vehicleId} />
            </SectionErrorBoundary> },
          ]} />
      </section>
      {/* C — original distribution and both separate scatter clouds. */}
      <section aria-label={t('efficiency.section.analysis', 'Speed and temperature analysis')} className="min-w-0 space-y-3">
          <SectionTitle>{t('efficiency.section.analysis', 'Speed & temperature analysis')}</SectionTitle>
          <CardGrid label={t('efficiency.section.analysis', 'Speed and temperature analysis')} items={[
            { id: 'speed-distribution', size: 'third', content: <SectionErrorBoundary name="EfficiencySpeedDistribution">
              <EfficiencySpeedDistribution {...drivesProps} />
            </SectionErrorBoundary> },
            { id: 'speed-scatter', size: 'third', content: <SectionErrorBoundary name="EfficiencySpeedScatter">
              <EfficiencyScatter {...drivesProps} kind="speed" />
            </SectionErrorBoundary> },
            { id: 'temperature-scatter', size: 'third', content: <SectionErrorBoundary name="EfficiencyTemperatureScatter">
              <EfficiencyScatter {...drivesProps} kind="temperature" />
            </SectionErrorBoundary> },
          ]} />
      </section>
      {/* D — six original table columns and six energy insight occurrences. */}
      <section aria-label={t('efficiency.section.breakdown', 'Breakdown and insights')} className="min-w-0 space-y-3">
          <SectionTitle>{t('efficiency.section.breakdown', 'Breakdown & insights')}</SectionTitle>
          <CardGrid label={t('efficiency.section.breakdown', 'Breakdown and insights')} items={[
            { id: 'temperature-table', size: 'half', content: <SectionErrorBoundary name="EfficiencyTemperatureTable">
              <EfficiencyTemperatureTable {...drivesProps} />
            </SectionErrorBoundary> },
            { id: 'energy-insights', size: 'third', content: <SectionErrorBoundary name="EfficiencyEnergyInsights">
              <EfficiencyEvidenceBrief {...statsProps} kind="insights" />
            </SectionErrorBoundary> },
          ]} />
      </section>
    </PageLayout>
  );
}
