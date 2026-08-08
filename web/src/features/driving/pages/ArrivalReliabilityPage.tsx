import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDriveHistory } from '@/api/hooks/useDriving';
import { VehicleSelect } from '@/components/forms';
import { Grid, PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { useTimezone } from '@/lib/timezone';
import type { Drive } from '@/types/driving';

import {
  ArrivalReliabilityDepartureWindowProfile,
  ArrivalReliabilityEvidenceQuality,
  ArrivalReliabilityKpiBand,
  ArrivalReliabilityMethodology,
  ArrivalReliabilityMonthTrend,
  ArrivalReliabilityRouteDirectory,
  ArrivalReliabilityTimingBandsChart,
  ArrivalReliabilityTimingConsistencyChart,
  ArrivalReliabilityWeekdayProfile,
  ArrivalReliabilityWindowComparisons,
  type ArrivalReliabilityQueryState,
} from '../components/arrival-reliability';
import { analyzeArrivalReliability } from '../lib/arrivalReliability';

const DRIVE_HISTORY_LIMIT = 1_000;
const TWO_COLUMNS = { default: 1, xl: 2 } as const;

export default function ArrivalReliabilityPage() {
  const { t, i18n } = useTranslation();
  usePageTitle(t('arrivalReliability.title', 'Arrival Reliability'));

  const { vehicleId } = useSelectedVehicle();
  const { formatDuration } = useUnits();
  const selectedTimeZone = useTimezone('vehicle');
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const drivesQuery = useDriveHistory(vehicleIdStr, DRIVE_HISTORY_LIMIT);
  const [nowMs] = useState(() => Date.now());
  const hasCachedData =
    vehicleId != null && drivesQuery.data !== undefined;
  const isResolved =
    vehicleId != null && (hasCachedData || drivesQuery.isSuccess);
  const drives = useMemo<Drive[]>(
    () => (vehicleId != null ? drivesQuery.data ?? [] : []),
    [drivesQuery.data, vehicleId],
  );
  const analysis = useMemo(
    () =>
      analyzeArrivalReliability(drives, nowMs, selectedTimeZone, {
        historyLimit: DRIVE_HISTORY_LIMIT,
      }),
    [drives, nowMs, selectedTimeZone],
  );
  const state: ArrivalReliabilityQueryState = {
    vehicleSelected: vehicleId != null,
    isLoading:
      vehicleId != null && !hasCachedData && drivesQuery.isLoading,
    isResolved,
    error:
      drivesQuery.isError && !hasCachedData
        ? drivesQuery.error
        : null,
    refreshError:
      drivesQuery.isError && hasCachedData
        ? drivesQuery.error
        : null,
    onRetry: () => void drivesQuery.refetch(),
  };
  const locale = i18n.language;
  const timeZone = analysis.timeZone;

  return (
    <PageContainer
      title={t('arrivalReliability.title', 'Arrival Reliability')}
      subtitle={t(
        'arrivalReliability.subtitle',
        'Observed timing consistency and evidence coverage for directional routes in the vehicle timezone',
      )}
      actions={<VehicleSelect />}
    >
      <FadeIn>
        <ArrivalReliabilityKpiBand
          analysis={analysis}
          state={state}
          locale={locale}
          formatDuration={formatDuration}
        />
      </FadeIn>

      <FadeIn delay={0.05}>
        <Grid cols={TWO_COLUMNS} gap={4}>
          <ArrivalReliabilityTimingConsistencyChart
            analysis={analysis}
            state={state}
            locale={locale}
          />
          <ArrivalReliabilityTimingBandsChart
            analysis={analysis}
            state={state}
            formatDuration={formatDuration}
          />
        </Grid>
      </FadeIn>

      <FadeIn delay={0.1}>
        <ArrivalReliabilityWindowComparisons
          analysis={analysis}
          state={state}
          locale={locale}
          timeZone={timeZone}
          formatDuration={formatDuration}
        />
      </FadeIn>

      <FadeIn delay={0.15}>
        <Grid cols={TWO_COLUMNS} gap={4}>
          <ArrivalReliabilityDepartureWindowProfile
            analysis={analysis}
            state={state}
            locale={locale}
          />
          <ArrivalReliabilityWeekdayProfile
            analysis={analysis}
            state={state}
            locale={locale}
            timeZone={timeZone}
          />
        </Grid>
      </FadeIn>

      <FadeIn delay={0.2}>
        <ArrivalReliabilityMonthTrend
          analysis={analysis}
          state={state}
          locale={locale}
          timeZone={timeZone}
        />
      </FadeIn>

      <FadeIn delay={0.25}>
        <ArrivalReliabilityRouteDirectory
          analysis={analysis}
          state={state}
          locale={locale}
          formatDuration={formatDuration}
        />
      </FadeIn>

      <FadeIn delay={0.3}>
        <ArrivalReliabilityEvidenceQuality
          analysis={analysis}
          state={state}
          locale={locale}
          timeZone={timeZone}
        />
      </FadeIn>

      <FadeIn delay={0.35}>
        <ArrivalReliabilityMethodology
          analysis={analysis}
          timeZone={timeZone}
        />
      </FadeIn>
    </PageContainer>
  );
}
