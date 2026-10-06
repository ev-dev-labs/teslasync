import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDriveHistory } from '@/api/hooks/useDriving';

import { EmptyState, StaleRefreshWarning } from '@/components/feedback';
import { PageLayout, Grid, LayoutCard } from '@/components/layout';
import { FadeIn } from '@/components/motion';
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
  const initialLoading = vehicleId != null && drivesState.status === 'initial';
  const gapOptions = GAP_OPTIONS.map((minutes) => ({
    value: String(minutes),
    label: t('journeyFragmentation.gapMinutes', '{{count}} min', { count: minutes }),
  }));

  return (
    <PageLayout
      title={t('journeyFragmentation.title', 'Journey Fragmentation')}
      query={drivesQuery}
      subtitle={t('journeyFragmentation.subtitle', 'Descriptive continuity analysis of a capped returned drive-history window')}
      contextActions={(
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <Select
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
      <FadeIn>
        <JourneyEvidenceBrief
          result={result}
          loading={initialLoading}
          hasVehicle={vehicleId != null}
          error={drivesState.fatalError}
          onRetry={() => void drivesQuery.refetch()}
          available={drivesState.hasData}
          retained={drivesState.status === 'stale' || drivesState.refreshError != null}
        />
      </FadeIn>

      <Grid cols={{ default: 1, lg: 2 }} gap={4}>
        <FadeIn><ChainLengthChart result={result} loading={initialLoading} /></FadeIn>
        <FadeIn delay={0.05}><StopoverGapChart result={result} loading={initialLoading} /></FadeIn>
        <FadeIn delay={0.1}><ThresholdSensitivityChart result={result} loading={initialLoading} /></FadeIn>
        <FadeIn delay={0.15}><ElapsedComposition result={result} loading={initialLoading} /></FadeIn>
      </Grid>

      <FadeIn delay={0.2}><StructureIndicators result={result} loading={initialLoading} /></FadeIn>
      <FadeIn delay={0.25}><EnergyIntensityPanel result={result} loading={initialLoading} /></FadeIn>

      <Grid cols={{ default: 1, lg: 2 }} gap={4}>
        <FadeIn delay={0.3}><StartProfileChart result={result} loading={initialLoading} /></FadeIn>
        <FadeIn delay={0.35}><WeekdayProfileChart result={result} loading={initialLoading} /></FadeIn>
        <FadeIn delay={0.4}><MonthlyTrendChart result={result} loading={initialLoading} /></FadeIn>
        <FadeIn delay={0.45}><JourneyDirectory result={result} /></FadeIn>
      </Grid>

      <FadeIn delay={0.5}><AccountingPanel result={result} /></FadeIn>
      <FadeIn delay={0.55}><MethodologyPanel result={result} /></FadeIn>

      <LayoutCard title={t('journeyFragmentation.footer.title', 'Report context')}>
        <Text as="p" variant="caption">
          {result.returnedRows === 0
            ? t('journeyFragmentation.footer.empty', 'All analytical shells remain visible while the returned history window is empty.')
            : t('journeyFragmentation.footer.note', 'Charts and directories describe returned records at the selected continuity threshold.')}
        </Text>
        {result.returnedRows === 0 && (
          <EmptyState /* no-action: the active filters and recorded telemetry determine this read-only result */
            message={t('journeyFragmentation.footer.waiting', 'No returned drive rows are available for this vehicle yet.')}
          />
        )}
      </LayoutCard>
    </PageLayout>
  );
}
