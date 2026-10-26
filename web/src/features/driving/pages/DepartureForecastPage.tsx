import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDriveHistory } from '@/api/hooks/useDriving';

import { Grid, PageLayout } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { StaleRefreshWarning } from '@/components/feedback';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDataState } from '@/hooks/useDataState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useSettings } from '@/hooks/useSettings';
import { isValidTimezone } from '@/lib/timezone';
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
  const { t } = useTranslation();
  usePageTitle(t('departure.title', 'Departure Forecast'));

  const { vehicleId, vehicle } = useSelectedVehicle();
  const { settings } = useSettings();
  const { locale, tz: timeZone } = useDateFormat();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const drivesQuery = useDriveHistory(
    vehicleIdStr,
    DRIVE_HISTORY_LIMIT,
  );
  const drivesState = useDataState(drivesQuery, { provenance: 'historical' });
  // History refreshes must not rebase the model's mount-time snapshot.
  const [modelAnchorMs] = useState(() => Date.now());
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
      forecastDepartures(drives, modelAnchorMs, timeZone, {
        historyLimit: DRIVE_HISTORY_LIMIT,
      }),
    [drives, modelAnchorMs, timeZone],
  );
  const state: DepartureForecastQueryState = {
    vehicleSelected: vehicleId != null,
    isLoading:
      vehicleId != null && drivesState.status === 'initial' && !drivesState.isRefreshBlocked,
    isRefreshBlocked: vehicleId != null && drivesState.isRefreshBlocked,
    fetchStatus: drivesQuery.fetchStatus,
    isResolved,
    error:
      drivesState.fatalError,
    refreshError:
      drivesState.refreshError,
    onRetry: () => void drivesQuery.refetch(),
  };
  const modelTimeZone = forecast.timeZone;
  const vehicleTimeZone = vehicleId != null && vehicle?.id === vehicleId
    ? vehicle.timezone
    : null;
  const usesVehicleMetadata = Boolean(
    vehicleTimeZone && vehicleTimeZone !== 'UTC' && isValidTimezone(vehicleTimeZone),
  );
  const savedUserZone = settings.timezone_user?.trim();
  const displayMode = settings.tz_display_default === 'user' || settings.tz_display_default === 'utc'
    ? settings.tz_display_default
    : 'vehicle';
  const fallbackSource = savedUserZone && isValidTimezone(savedUserZone)
    ? t('departure.method.zoneSavedUser', 'saved user timezone')
    : t('departure.method.zoneBrowser', 'browser timezone');
  const timeZoneProvenance = [
    t('departure.method.effectiveZone', 'The model follows your selected time zone.'),
    displayMode === 'utc'
      ? t('departure.method.zoneFixed', 'Source: fixed reference display setting.')
      : displayMode === 'user'
        ? t('departure.method.zoneUser', 'Source: shared user display setting ({{source}}).', { source: fallbackSource })
        : usesVehicleMetadata
          ? t('departure.method.zoneMetadata', 'Source: selected vehicle timezone metadata.')
          : t('departure.method.zoneFallback', 'Source: shared vehicle-mode fallback ({{source}}); vehicle timezone metadata is unavailable or unsuitable.', {
              source: fallbackSource,
            }),
    timeZone.trim() !== modelTimeZone
      ? t('departure.method.zoneInvalid', 'The selected time zone is missing or invalid; this model uses the fixed reference clock without changing shared settings.')
      : '',
  ].filter(Boolean).join(' ');

  return (
    <PageLayout
      title={t('departure.title', 'Departure Forecast')}
      query={drivesQuery}
      subtitle={t(
        'departure.subtitle',
        'Departure patterns from returned drive starts in your selected time zone, expressed as modeled likelihood estimates',
      )}
    >
      {hasCachedData && state.isRefreshBlocked && !state.refreshError && (
        <StaleRefreshWarning state={drivesState} label={t('departure.title', 'Departure Forecast')} />
      )}
      <FadeIn>
        <DepartureEvidenceBrief
          forecast={forecast}
          state={state}
          locale={locale}
          timeZone={modelTimeZone}
          timeZoneProvenance={timeZoneProvenance}
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
          timeZoneProvenance={timeZoneProvenance}
        />
      </FadeIn>
    </PageLayout>
  );
}
