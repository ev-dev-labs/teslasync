import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDriveHistory } from '@/api/hooks/useDriving';

import { Grid, PageLayout } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { StaleRefreshWarning } from '@/components/feedback';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDataState } from '@/hooks/useDataState';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useTimezone } from '@/lib/timezone';
import type { Drive } from '@/types/driving';

import {
  DepartureForecastEvidenceQuality,
  DepartureForecastHeatmap,
  DepartureForecastHourDistribution,
  DepartureForecastMethodology,
  DepartureForecastNext24Chart,
  DepartureForecastRankedWindows,
  DepartureForecastWeekdayRoutines,
  DepartureForecastWeeklyTrend,
  type DepartureForecastQueryState,
} from '../components/departure-forecast';
import { forecastDepartures } from '../lib/departureForecast';
import { DepartureEvidenceBrief } from '../components/operationalbrief-a-m/DepartureEvidenceBrief';

const DRIVE_HISTORY_LIMIT = 1_000;
const TWO_COLUMNS = { default: 1, xl: 2 } as const;

export default function DepartureForecastPage() {
  const { t, i18n } = useTranslation();
  usePageTitle(t('departure.title', 'Departure Forecast'));

  const { vehicleId } = useSelectedVehicle();
  const timeZone = useTimezone('vehicle');
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const drivesQuery = useDriveHistory(
    vehicleIdStr,
    DRIVE_HISTORY_LIMIT,
  );
  const drivesState = useDataState(drivesQuery, { provenance: 'historical' });
  const [nowMs] = useState(() => Date.now());
  const hasCachedData =
    vehicleId != null && drivesState.hasData;
  const isResolved =
    vehicleId != null && (hasCachedData || drivesQuery.isSuccess);
  const drives = useMemo<Drive[]>(
    () => (vehicleId != null ? drivesQuery.data ?? [] : []),
    [drivesQuery.data, vehicleId],
  );
  const forecast = useMemo(
    () =>
      forecastDepartures(drives, nowMs, timeZone, {
        historyLimit: DRIVE_HISTORY_LIMIT,
      }),
    [drives, nowMs, timeZone],
  );
  const state: DepartureForecastQueryState = {
    vehicleSelected: vehicleId != null,
    isLoading:
      vehicleId != null && drivesState.status === 'initial',
    isResolved,
    error:
      drivesState.fatalError,
    refreshError:
      drivesState.refreshError,
    onRetry: () => void drivesQuery.refetch(),
  };
  const locale = i18n.language;
  const modelTimeZone = forecast.timeZone;

  return (
    <PageLayout
      title={t('departure.title', 'Departure Forecast')}
      query={drivesQuery}
      subtitle={t(
        'departure.subtitle',
        'Vehicle-timezone departure patterns from returned drive starts, expressed as modeled likelihood estimates',
      )}
    >
      {drivesState.isRefreshBlocked && (
        <StaleRefreshWarning state={drivesState} label={t('departure.title', 'Departure Forecast')} />
      )}
      <FadeIn>
        <DepartureEvidenceBrief
          forecast={forecast}
          state={state}
          locale={locale}
          timeZone={modelTimeZone}
        />
      </FadeIn>

      <FadeIn delay={0.05}>
        <DepartureForecastNext24Chart
          forecast={forecast}
          state={state}
          locale={locale}
          timeZone={modelTimeZone}
        />
      </FadeIn>

      <FadeIn delay={0.1}>
        <Grid cols={TWO_COLUMNS} gap={4}>
          <DepartureForecastRankedWindows
            forecast={forecast}
            state={state}
            locale={locale}
            timeZone={modelTimeZone}
          />
          <DepartureForecastWeekdayRoutines
            forecast={forecast}
            state={state}
            locale={locale}
            timeZone={modelTimeZone}
          />
        </Grid>
      </FadeIn>

      <FadeIn delay={0.15}>
        <DepartureForecastHeatmap
          forecast={forecast}
          state={state}
          locale={locale}
        />
      </FadeIn>

      <FadeIn delay={0.2}>
        <Grid cols={TWO_COLUMNS} gap={4}>
          <DepartureForecastHourDistribution
            forecast={forecast}
            state={state}
            locale={locale}
            timeZone={modelTimeZone}
          />
          <DepartureForecastWeeklyTrend
            forecast={forecast}
            state={state}
            locale={locale}
            timeZone={modelTimeZone}
          />
        </Grid>
      </FadeIn>

      <FadeIn delay={0.25}>
        <DepartureForecastEvidenceQuality
          forecast={forecast}
          state={state}
          locale={locale}
        />
      </FadeIn>

      <FadeIn delay={0.3}>
        <DepartureForecastMethodology
          forecast={forecast}
          locale={locale}
          timeZone={modelTimeZone}
        />
      </FadeIn>
    </PageLayout>
  );
}
