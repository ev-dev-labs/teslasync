import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDrives } from '@/api/hooks/useDriving';

import { Grid, PageLayout } from '@/components/layout';
import { StaleRefreshWarning } from '@/components/feedback';
import { useDataState } from '@/hooks/useDataState';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import { useFormatting } from '@/hooks/useFormatting';
import { useDateFormat } from '@/hooks/useDateFormat';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useRangeState } from '@/hooks/useRangeState';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { tzAbbreviation } from '@/lib/dateFormat';
import { useTimezone } from '@/lib/timezone';

import {
  ColdStartMethodology,
  ColdStartOpportunities,
  ColdWarmComparison,
  MonthlyColdStartChart,
  ParkingGapDistribution,
  TemperatureEfficiencyChart,
  type ColdStartSectionState,
} from '../components/cold-start';
import { summarizeColdStarts } from '../lib/coldStart';
import { ColdStartBrief } from '../components/operationalbrief-a-m/ColdStartBrief';

const DRIVE_WINDOW_LIMIT = 1_000;
const ANALYSIS_COLUMNS = { default: 1, xl: 5 } as const;

export default function ColdStartPage() {
  const { t } = useTranslation();
  usePageTitle(t('coldStart.title', 'Cold Start Cost'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const { formatCurrency, costPerKwh } = useFormatting();
  const timezone = useTimezone('vehicle');
  const { formatDateTime } = useDateFormat('vehicle');
  const { startInstant, endInstantExclusive } = useRangeState({
    persistKey: 'cold-start.range',
    defaultPresetId: 'all',
    timezone,
  });

  const drivesQuery = useDrives(vehicleIdStr, {
    start: startInstant,
    end: endInstantExclusive,
    limit: DRIVE_WINDOW_LIMIT,
  });
  const drives = useMemo(() => drivesQuery.data ?? [], [drivesQuery.data]);
  const sourceState = useDataState(drivesQuery, { provenance: 'historical' });
  const summary = useMemo(() => summarizeColdStarts(drives), [drives]);
  const penaltyCost =
    summary.totalPenaltyWh != null &&
    Number.isFinite(summary.totalPenaltyWh) &&
    costPerKwh != null &&
    Number.isFinite(costPerKwh) &&
    costPerKwh >= 0
      ? (summary.totalPenaltyWh / 1_000) * costPerKwh
      : null;
  const penaltyCostLabel =
    penaltyCost != null && Number.isFinite(penaltyCost)
      ? formatCurrency(penaltyCost)
      : null;

  if (vehicleId == null) {
    return (
      <NoVehicleSelected
        pageTitle={t('coldStart.title', 'Cold Start Cost')}
      />
    );
  }

  const sectionState: ColdStartSectionState = {
    isLoading: sourceState.status === 'initial',
    retained: sourceState.status === 'stale' || sourceState.refreshError != null,
    error: sourceState.fatalError,
    onRetry: () => {
      void drivesQuery.refetch();
    },
  };

  return (
    <PageLayout
      title={t('coldStart.title', 'Cold Start Cost')}
      subtitle={t(
        'coldStart.subtitle',
        'What the first kilometres after a long park really cost',
      )}
      query={drivesQuery}
    >
      <StaleRefreshWarning state={sourceState} label={t('coldStart.title', 'Cold Start Cost')} />
      <FadeIn>
        <ColdStartBrief
          summary={summary}
          penaltyCostLabel={penaltyCostLabel}
          {...sectionState}
          scope={t(
            'coldStart.brief.window',
            '{{start}}–{{end}}; returned selected-window drives',
            {
              start: `${formatDateTime(startInstant)} ${tzAbbreviation(startInstant, timezone)}`,
              end: `${formatDateTime(endInstantExclusive)} ${tzAbbreviation(endInstantExclusive, timezone)}`,
            },
          )}
          retained={sectionState.retained ?? false}
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
    </PageLayout>
  );
}
