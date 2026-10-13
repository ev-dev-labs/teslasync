import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDriveHistory } from '@/api/hooks/useDriving';

import { EmptyState, SectionErrorBoundary, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { PageLayout, Grid, LayoutCard } from '@/components/layout';
import { Select, Text } from '@/components/ui';
import { useDataState } from '@/hooks/useDataState';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useTimezone } from '@/lib/timezone';

import {
  AccountingPanel,
  ChainLengthChart,
  ElapsedComposition,
  EnergyIntensityPanel,
  JourneyDirectory,
  MethodologyPanel,
  MonthlyTrendChart,
  StartProfileChart,
  StopoverGapChart,
  StructureIndicators,
  ThresholdSensitivityChart,
  WeekdayProfileChart,
} from '../components/journey-fragmentation';
import { analyzeJourneyFragmentation } from '../lib/journeyFragmentation';
import { JourneyEvidenceBrief } from '../components/operationalbrief-a-m/JourneyEvidenceBrief';

const HISTORY_LIMIT = 1_000;
const GAP_OPTIONS = [30, 60, 120, 240] as const;

export default function JourneyFragmentationPage() {
  const { t } = useTranslation();
  usePageTitle(t('journeyFragmentation.title', 'Journey Fragmentation'));
  const { vehicleId } = useSelectedVehicle();
  const timeZone = useTimezone('vehicle');
  const [maxGapMin, setMaxGapMin] = useState(120);
  const [analysisNowMs] = useState(() => Date.now());
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const drivesQuery = useDriveHistory(vehicleIdStr, HISTORY_LIMIT);
  const drivesState = useDataState(drivesQuery, { provenance: 'historical' });
  const result = useMemo(
    () => analyzeJourneyFragmentation(
      drivesQuery.data ?? [],
      analysisNowMs,
      timeZone,
      { maxParkingGapMin: maxGapMin, historyLimit: HISTORY_LIMIT },
    ),
    [analysisNowMs, drivesQuery.data, maxGapMin, timeZone],
  );
  const initialLoading = vehicleId != null && drivesState.status === 'initial' && !drivesState.isRefreshBlocked;
  const pendingContext = vehicleId != null && !drivesState.hasData;
  const gapOptions = GAP_OPTIONS.map((minutes) => ({
    value: String(minutes),
    label: t('journeyFragmentation.gapMinutes', '{{count}} min', { count: minutes }),
  }));

  return (
    <PageLayout
      className="w-full min-w-0"
      title={t('journeyFragmentation.title', 'Journey Fragmentation')}
      query={drivesQuery}
      subtitle={t('journeyFragmentation.subtitle', 'Descriptive continuity analysis of a capped returned drive-history window')}
      contextActions={(
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 sm:gap-3">
          <Select
            label={t('journeyFragmentation.maxGap', 'Maximum parking gap')}
            aria-label={t('journeyFragmentation.maxGap', 'Maximum parking gap')}
            value={String(maxGapMin)}
            options={gapOptions}
            size="sm"
            onChange={(event) => setMaxGapMin(Number(event.target.value))}
          />
        </div>
      )}
    >
      <StaleRefreshWarning state={drivesState} label={t('journeyFragmentation.title', 'Journey Fragmentation')} />
      <SectionErrorBoundary name="JourneyFragmentationEvidence">
        <JourneyEvidenceBrief
          result={result}
          loading={initialLoading}
          hasVehicle={vehicleId != null}
          error={drivesState.fatalError}
          onRetry={() => void drivesQuery.refetch()}
          available={drivesState.hasData}
          retained={drivesState.status === 'stale' || drivesState.refreshError != null}
        />
      </SectionErrorBoundary>

      <Grid cols={{ default: 1, lg: 2 }} gap={4}>
        <SectionErrorBoundary name="JourneyFragmentationChainLength">
          <ChainLengthChart result={result} loading={initialLoading} />
        </SectionErrorBoundary>
        <SectionErrorBoundary name="JourneyFragmentationStopoverGap">
          <StopoverGapChart result={result} loading={initialLoading} />
        </SectionErrorBoundary>
        <SectionErrorBoundary name="JourneyFragmentationThresholdSensitivity">
          <ThresholdSensitivityChart result={result} loading={initialLoading} />
        </SectionErrorBoundary>
        <SectionErrorBoundary name="JourneyFragmentationElapsedComposition">
          <ElapsedComposition result={result} loading={initialLoading} />
        </SectionErrorBoundary>
      </Grid>

      <SectionErrorBoundary name="JourneyFragmentationStructureIndicators">
        <StructureIndicators result={result} loading={initialLoading} />
      </SectionErrorBoundary>
      <SectionErrorBoundary name="JourneyFragmentationEnergyIntensity">
        <EnergyIntensityPanel result={result} loading={initialLoading} />
      </SectionErrorBoundary>

      <Grid cols={{ default: 1, lg: 2 }} gap={4}>
        <SectionErrorBoundary name="JourneyFragmentationStartProfile">
          <StartProfileChart result={result} loading={initialLoading} />
        </SectionErrorBoundary>
        <SectionErrorBoundary name="JourneyFragmentationWeekdayProfile">
          <WeekdayProfileChart result={result} loading={initialLoading} />
        </SectionErrorBoundary>
        <SectionErrorBoundary name="JourneyFragmentationMonthlyTrend">
          <MonthlyTrendChart result={result} loading={initialLoading} />
        </SectionErrorBoundary>
        <SectionErrorBoundary name="JourneyFragmentationDirectory">
          <JourneyDirectory result={result} loading={initialLoading} />
        </SectionErrorBoundary>
      </Grid>

      <SectionErrorBoundary name="JourneyFragmentationAccounting">
        <AccountingPanel result={result} loading={initialLoading} />
      </SectionErrorBoundary>
      <SectionErrorBoundary name="JourneyFragmentationMethodology">
        <MethodologyPanel result={result} />
      </SectionErrorBoundary>

      <LayoutCard title={t('journeyFragmentation.footer.title', 'Report context')}>
        {pendingContext ? (
          <div aria-busy={initialLoading || undefined} className="min-w-0 space-y-3">
            <Text as="p" variant="caption">
              {t('driving.brief.pending', 'Drive evidence is not available yet.')}
            </Text>
            {initialLoading && <Skeleton lines={2} />}
          </div>
        ) : <Text as="p" variant="caption">
          {result.returnedRows === 0
            ? t('journeyFragmentation.footer.empty', 'All analytical shells remain visible while the returned history window is empty.')
            : t('journeyFragmentation.footer.note', 'Charts and directories describe returned records at the selected continuity threshold.')}
        </Text>}
        {!pendingContext && result.returnedRows === 0 && (
          <EmptyState /* no-action: the active filters and recorded telemetry determine this read-only result */
            message={t('journeyFragmentation.footer.waiting', 'No returned drive rows are available for this vehicle yet.')}
          />
        )}
      </LayoutCard>
    </PageLayout>
  );
}
