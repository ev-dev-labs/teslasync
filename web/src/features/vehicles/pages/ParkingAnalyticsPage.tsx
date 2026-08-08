import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDrives } from '@/api/hooks/useDriving';
import { RangePicker, VehicleSelect } from '@/components/forms';
import { Grid, PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import { useDateFormat } from '@/hooks/useDateFormat';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useRangeState } from '@/hooks/useRangeState';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';

import {
  DurationDistributionChart,
  LongestParkingStints,
  MonthlyDwellTrend,
  OvernightParkingContext,
  ParkingCoverageMethodology,
  ParkingKpiBand,
  ParkingTemporalProfile,
  TopParkingLocations,
  type ParkingSectionState,
} from '../components/parking-analytics';
import {
  PARKING_DRIVE_LIMIT,
  summarizeParking,
} from '../lib/parkingDwell';

const TWO_COLUMNS = { default: 1, xl: 2 } as const;

export default function ParkingAnalyticsPage() {
  const { t } = useTranslation();
  usePageTitle(t('parking.title', 'Parking Analytics'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const { tz } = useDateFormat();
  const [pageNowMs] = useState(() => Date.now());
  const { start, end, setRange } = useRangeState({
    persistKey: 'parking-analytics.range',
    defaultPresetId: '30d',
  });

  const drivesQuery = useDrives(vehicleIdStr, {
    start,
    end,
    limit: PARKING_DRIVE_LIMIT,
  });
  const drives = useMemo(() => drivesQuery.data ?? [], [drivesQuery.data]);
  const summary = useMemo(
    () =>
      summarizeParking(drives, {
        nowMs: pageNowMs,
        rangeStart: start,
        rangeEnd: end,
        timeZone: tz,
        rowLimit: PARKING_DRIVE_LIMIT,
      }),
    [drives, end, pageNowMs, start, tz],
  );
  const onRetry = useCallback(() => {
    void drivesQuery.refetch();
  }, [drivesQuery.refetch]);
  const sectionState = useMemo<ParkingSectionState>(
    () => ({
      isLoading: drivesQuery.isLoading,
      error: drivesQuery.isError ? drivesQuery.error : null,
      onRetry,
    }),
    [
      drivesQuery.error,
      drivesQuery.isError,
      drivesQuery.isLoading,
      onRetry,
    ],
  );

  if (vehicleId == null) {
    return (
      <NoVehicleSelected pageTitle={t('parking.title', 'Parking Analytics')} />
    );
  }

  return (
    <PageContainer
      title={t('parking.title', 'Parking Analytics')}
      subtitle={t(
        'parking.subtitle',
        'Where your car spends its time between drives',
      )}
      query={drivesQuery}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <VehicleSelect />
          <RangePicker
            value={{ start, end }}
            onChange={setRange}
            align="end"
            triggerTestId="parking-analytics-range"
          />
        </div>
      }
    >
      <FadeIn>
        <ParkingKpiBand summary={summary} {...sectionState} />
      </FadeIn>

      <FadeIn delay={0.05}>
        <Grid cols={TWO_COLUMNS} gap={4}>
          <DurationDistributionChart
            summary={summary}
            state={sectionState}
          />
          <OvernightParkingContext summary={summary} state={sectionState} />
        </Grid>
      </FadeIn>

      <FadeIn delay={0.1}>
        <ParkingTemporalProfile summary={summary} state={sectionState} />
      </FadeIn>

      <FadeIn delay={0.15}>
        <MonthlyDwellTrend summary={summary} state={sectionState} />
      </FadeIn>

      <FadeIn delay={0.2}>
        <Grid cols={TWO_COLUMNS} gap={4}>
          <TopParkingLocations summary={summary} state={sectionState} />
          <LongestParkingStints summary={summary} state={sectionState} />
        </Grid>
      </FadeIn>

      <FadeIn delay={0.25}>
        <ParkingCoverageMethodology
          summary={summary}
          state={sectionState}
          rangeStart={start}
          rangeEnd={end}
        />
      </FadeIn>
    </PageContainer>
  );
}
