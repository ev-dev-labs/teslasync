import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDrives } from '@/api/hooks/useDriving';
import { RangePicker, VehicleSelect } from '@/components/forms';
import { Grid, PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import { useFormatting } from '@/hooks/useFormatting';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useRangeState } from '@/hooks/useRangeState';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';

import {
  ColdStartKpis,
  ColdStartMethodology,
  ColdStartOpportunities,
  ColdWarmComparison,
  MonthlyColdStartChart,
  ParkingGapDistribution,
  TemperatureEfficiencyChart,
  type ColdStartSectionState,
} from '../components/cold-start';
import { summarizeColdStarts } from '../lib/coldStart';

const DRIVE_WINDOW_LIMIT = 1_000;
const ANALYSIS_COLUMNS = { default: 1, xl: 5 } as const;

export default function ColdStartPage() {
  const { t } = useTranslation();
  usePageTitle(t('coldStart.title', 'Cold Start Cost'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const { formatCurrency, costPerKwh } = useFormatting();
  const { start, end, setRange } = useRangeState({
    persistKey: 'cold-start.range',
    defaultPresetId: 'all',
  });

  const drivesQuery = useDrives(vehicleIdStr, {
    start,
    end,
    limit: DRIVE_WINDOW_LIMIT,
  });
  const drives = useMemo(() => drivesQuery.data ?? [], [drivesQuery.data]);
  const summary = useMemo(() => summarizeColdStarts(drives), [drives]);
  const penaltyCost =
    summary.totalPenaltyWh != null && costPerKwh > 0
      ? (summary.totalPenaltyWh / 1_000) * costPerKwh
      : null;
  const penaltyCostLabel =
    penaltyCost != null ? formatCurrency(penaltyCost) : null;

  if (vehicleId == null) {
    return (
      <NoVehicleSelected
        pageTitle={t('coldStart.title', 'Cold Start Cost')}
      />
    );
  }

  const sectionState: ColdStartSectionState = {
    isLoading: drivesQuery.isLoading,
    error: drivesQuery.isError ? drivesQuery.error : null,
    onRetry: () => {
      void drivesQuery.refetch();
    },
  };

  return (
    <PageContainer
      title={t('coldStart.title', 'Cold Start Cost')}
      subtitle={t(
        'coldStart.subtitle',
        'What the first kilometres after a long park really cost',
      )}
      query={drivesQuery}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <VehicleSelect />
          <RangePicker
            value={{ start, end }}
            onChange={setRange}
            align="end"
            triggerTestId="cold-start-range"
          />
        </div>
      }
    >
      <FadeIn>
        <ColdStartKpis
          summary={summary}
          penaltyCostLabel={penaltyCostLabel}
          {...sectionState}
        />
      </FadeIn>

      <FadeIn delay={0.05}>
        <Grid cols={ANALYSIS_COLUMNS} gap={4}>
          <ColdWarmComparison
            summary={summary}
            penaltyCostLabel={penaltyCostLabel}
            state={sectionState}
            className="xl:col-span-3"
          />
          <ColdStartMethodology
            summary={summary}
            observedDrives={drives.length}
            windowLimit={DRIVE_WINDOW_LIMIT}
            state={sectionState}
            className="xl:col-span-2"
          />
        </Grid>
      </FadeIn>

      <FadeIn delay={0.1}>
        <Grid cols={ANALYSIS_COLUMNS} gap={4}>
          <MonthlyColdStartChart
            months={summary.monthly}
            state={sectionState}
            className="xl:col-span-3"
          />
          <ParkingGapDistribution
            buckets={summary.gapBuckets}
            analyzed={summary.analyzed}
            state={sectionState}
            className="xl:col-span-2"
          />
        </Grid>
      </FadeIn>

      <FadeIn delay={0.15}>
        <Grid cols={ANALYSIS_COLUMNS} gap={4}>
          <TemperatureEfficiencyChart
            points={summary.temperature}
            state={sectionState}
            className="xl:col-span-3"
          />
          <ColdStartOpportunities
            summary={summary}
            state={sectionState}
            className="xl:col-span-2"
          />
        </Grid>
      </FadeIn>
    </PageContainer>
  );
}
