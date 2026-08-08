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
  SeasonalAccounting,
  SeasonalCalendarCoverage,
  SeasonalComponentDiagnostics,
  SeasonalDeseasonalizedTrend,
  SeasonalEvidenceSupport,
  SeasonalFittedCurve,
  SeasonalKpiEvidenceBand,
  SeasonalMethodology,
  SeasonalMonthProfile,
  SeasonalMonthSupport,
  SeasonalObservationTimeline,
  SeasonalRankedMonths,
  SeasonalResidualDistribution,
  SeasonalYearDirectory,
  type SeasonalQueryState,
} from '../components/seasonal-efficiency';
import { analyzeSeasonalEfficiency } from '../lib/seasonalEfficiency';

const DRIVE_HISTORY_LIMIT = 1_000;
const TWO_COLUMNS = { default: 1, xl: 2 } as const;

export default function SeasonalEfficiencyPage() {
  const { t, i18n } = useTranslation();
  usePageTitle(t('seasonalEfficiency.title', 'Seasonal Efficiency'));

  const { vehicleId } = useSelectedVehicle();
  const units = useUnits();
  const timeZone = useTimezone('vehicle');
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const drivesQuery = useDriveHistory(vehicleIdStr, DRIVE_HISTORY_LIMIT);
  const [nowMs] = useState(() => Date.now());
  const hasCachedData = vehicleId != null && drivesQuery.data !== undefined;
  const isResolved = vehicleId != null && (hasCachedData || drivesQuery.isSuccess);
  const drives = useMemo<Drive[]>(
    () => (vehicleId != null ? drivesQuery.data ?? [] : []),
    [drivesQuery.data, vehicleId],
  );
  const analysis = useMemo(
    () => analyzeSeasonalEfficiency(drives, nowMs, timeZone, {
      historyLimit: DRIVE_HISTORY_LIMIT,
    }),
    [drives, nowMs, timeZone],
  );
  const state: SeasonalQueryState = {
    vehicleSelected: vehicleId != null,
    isLoading: vehicleId != null && !hasCachedData && drivesQuery.isLoading,
    isResolved,
    error: drivesQuery.isError && !hasCachedData ? drivesQuery.error : null,
    refreshError: drivesQuery.isError && hasCachedData ? drivesQuery.error : null,
    onRetry: () => void drivesQuery.refetch(),
  };
  const sectionProps = {
    analysis,
    state,
    locale: i18n.language,
    timeZone: analysis.timeZone,
    units,
  };

  return (
    <PageContainer
      title={t('seasonalEfficiency.title', 'Seasonal Efficiency')}
      subtitle={t(
        'seasonalEfficiency.subtitle',
        'Vehicle-local calendar normalization with explicit evidence accounting and descriptive support',
      )}
      actions={<VehicleSelect />}
    >
      <FadeIn>
        <SeasonalKpiEvidenceBand {...sectionProps} />
      </FadeIn>
      <FadeIn delay={0.05}>
        <Grid cols={TWO_COLUMNS} gap={4}>
          <SeasonalCalendarCoverage {...sectionProps} />
          <SeasonalEvidenceSupport {...sectionProps} />
        </Grid>
      </FadeIn>
      <FadeIn delay={0.1}>
        <Grid cols={TWO_COLUMNS} gap={4}>
          <SeasonalFittedCurve {...sectionProps} />
          <SeasonalMonthProfile {...sectionProps} />
        </Grid>
      </FadeIn>
      <FadeIn delay={0.15}>
        <SeasonalObservationTimeline {...sectionProps} />
      </FadeIn>
      <FadeIn delay={0.2}>
        <Grid cols={TWO_COLUMNS} gap={4}>
          <SeasonalDeseasonalizedTrend {...sectionProps} />
          <SeasonalResidualDistribution {...sectionProps} />
        </Grid>
      </FadeIn>
      <FadeIn delay={0.25}>
        <Grid cols={TWO_COLUMNS} gap={4}>
          <SeasonalComponentDiagnostics {...sectionProps} />
          <SeasonalMonthSupport {...sectionProps} />
        </Grid>
      </FadeIn>
      <FadeIn delay={0.3}>
        <Grid cols={TWO_COLUMNS} gap={4}>
          <SeasonalYearDirectory {...sectionProps} />
          <SeasonalRankedMonths {...sectionProps} />
        </Grid>
      </FadeIn>
      <FadeIn delay={0.35}>
        <SeasonalAccounting {...sectionProps} />
      </FadeIn>
      <FadeIn delay={0.4}>
        <SeasonalMethodology {...sectionProps} />
      </FadeIn>
    </PageContainer>
  );
}
