import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDrives } from '@/api/hooks/useDriving';

import { Grid, PageLayout } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { SectionErrorBoundary, StaleRefreshWarning } from '@/components/feedback';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDataState } from '@/hooks/useDataState';
import { useRangeState } from '@/hooks/useRangeState';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { useTimezone } from '@/lib/timezone';
import type { Drive } from '@/types/driving';

import {
  RangeBufferDestinationDirectory,
  RangeBufferDistanceProfile,
  RangeBufferDistribution,
  RangeBufferHourProfile,
  RangeBufferLowArrivals,
  RangeBufferMethodology,
  RangeBufferMonthTrend,
  RangeBufferThresholdSensitivity,
  RangeBufferWeekdayProfile,
  type RangeBufferQueryState,
} from '../components/range-buffer';
import { RangeBufferSummaryBrief } from '../components/operationalbrief-n-z/RangeBufferSummaryBrief';
import {
  analyzeRangeBuffer,
  DEFAULT_RANGE_BUFFER_THRESHOLD_PCT,
} from '../lib/rangeBuffer';

const DRIVE_WINDOW_LIMIT = 1_000;
const TWO_COLUMNS = { default: 1, xl: 2 } as const;

export default function RangeBufferPage() {
  const { t, i18n } = useTranslation();
  usePageTitle(t('rangeBuffer.title', 'Range Buffer'));

  const { vehicleId } = useSelectedVehicle();
  const { formatDistance } = useUnits();
  const selectedTimeZone = useTimezone('vehicle');
  const vehicleIdStr =
    vehicleId != null ? String(vehicleId) : undefined;
  const { start, end, startInstant, endInstantExclusive } = useRangeState({
    persistKey: 'range-buffer.range',
    defaultPresetId: 'all',
    timezone: selectedTimeZone,
  });
  const drivesQuery = useDrives(vehicleIdStr, {
    start: startInstant,
    end: endInstantExclusive,
    limit: DRIVE_WINDOW_LIMIT,
  });
  const drivesState = useDataState(drivesQuery, { provenance: 'historical' });
  const [nowMs] = useState(() => Date.now());
  const [thresholdPct, setThresholdPct] = useState(
    DEFAULT_RANGE_BUFFER_THRESHOLD_PCT,
  );
  const hasCachedData =
    vehicleId != null && drivesState.hasData;
  const isResolved =
    vehicleId != null && (hasCachedData || drivesQuery.isSuccess);
  const drives = useMemo<Drive[]>(
    () => (vehicleId != null ? drivesQuery.data ?? [] : []),
    [drivesQuery.data, vehicleId],
  );
  const result = useMemo(
    () =>
      analyzeRangeBuffer(drives, nowMs, selectedTimeZone, {
        thresholdPct,
        historyLimit: DRIVE_WINDOW_LIMIT,
      }),
    [drives, nowMs, selectedTimeZone, thresholdPct],
  );
  const state: RangeBufferQueryState = {
    vehicleSelected: vehicleId != null,
    isLoading:
      vehicleId != null && drivesState.status === 'initial' && drivesQuery.isLoading,
    isResolved,
    error:
      drivesState.fatalError,
    refreshError:
      drivesState.refreshError,
    onRetry: () => void drivesQuery.refetch(),
  };
  const locale = i18n.language;
  const summaryProps = {
    result, state, locale, thresholdPct, onThresholdChange: setThresholdPct,
    formatDistance, scope: `${start} — ${end} (${result.timeZone})`,
  };

  return (
    <PageLayout
      title={t('rangeBuffer.title', 'Range Buffer')}
      query={drivesQuery}
      subtitle={t(
        'rangeBuffer.subtitle',
        'Observed arrival SoC distribution, context, and evidence coverage in the vehicle timezone',
      )}
    >
      {drivesState.isRefreshBlocked && (
        <StaleRefreshWarning state={drivesState} label={t('rangeBuffer.title', 'Range Buffer')} />
      )}
      <FadeIn>
        <SectionErrorBoundary name="RangeBufferSummaryBrief-arrivals">
          <RangeBufferSummaryBrief kind="arrivals" {...summaryProps} />
        </SectionErrorBoundary>
      </FadeIn>

      <FadeIn delay={0.05}>
        <Grid cols={TWO_COLUMNS} gap={4}>
          <SectionErrorBoundary name="RangeBufferDistribution">
            <RangeBufferDistribution result={result} state={state} />
          </SectionErrorBoundary>
          <SectionErrorBoundary name="RangeBufferMonthTrend">
            <RangeBufferMonthTrend
              result={result}
              state={state}
              locale={locale}
            />
          </SectionErrorBoundary>
        </Grid>
      </FadeIn>

      <FadeIn delay={0.1}>
        <Grid cols={TWO_COLUMNS} gap={4}>
          <SectionErrorBoundary name="RangeBufferThresholdSensitivity">
            <RangeBufferThresholdSensitivity
              result={result}
              state={state}
            />
          </SectionErrorBoundary>
          <SectionErrorBoundary name="RangeBufferWeekdayProfile">
            <RangeBufferWeekdayProfile
              result={result}
              state={state}
              timeZone={result.timeZone}
            />
          </SectionErrorBoundary>
        </Grid>
      </FadeIn>

      <FadeIn delay={0.15}>
        <Grid cols={TWO_COLUMNS} gap={4}>
          <SectionErrorBoundary name="RangeBufferHourProfile">
            <RangeBufferHourProfile
              result={result}
              state={state}
              timeZone={result.timeZone}
            />
          </SectionErrorBoundary>
          <SectionErrorBoundary name="RangeBufferDistanceProfile">
            <RangeBufferDistanceProfile
              result={result}
              state={state}
              formatDistance={formatDistance}
            />
          </SectionErrorBoundary>
        </Grid>
      </FadeIn>

      <FadeIn delay={0.2}>
        <SectionErrorBoundary name="RangeBufferSummaryBrief-context">
          <RangeBufferSummaryBrief kind="context" {...summaryProps} />
        </SectionErrorBoundary>
      </FadeIn>

      <FadeIn delay={0.25}>
        <SectionErrorBoundary name="RangeBufferDestinationDirectory">
          <RangeBufferDestinationDirectory
            result={result}
            state={state}
            locale={locale}
            timeZone={result.timeZone}
            formatDistance={formatDistance}
          />
        </SectionErrorBoundary>
      </FadeIn>

      <FadeIn delay={0.3}>
        <SectionErrorBoundary name="RangeBufferLowArrivals">
          <RangeBufferLowArrivals
            result={result}
            state={state}
            locale={locale}
            timeZone={result.timeZone}
            formatDistance={formatDistance}
          />
        </SectionErrorBoundary>
      </FadeIn>

      <FadeIn delay={0.35}>
        <SectionErrorBoundary name="RangeBufferSummaryBrief-support">
          <RangeBufferSummaryBrief kind="support" {...summaryProps} />
        </SectionErrorBoundary>
      </FadeIn>

      <FadeIn delay={0.4}>
        <SectionErrorBoundary name="RangeBufferSummaryBrief-accounting">
          <RangeBufferSummaryBrief kind="accounting" {...summaryProps} />
        </SectionErrorBoundary>
      </FadeIn>

      <FadeIn delay={0.45}>
        <SectionErrorBoundary name="RangeBufferMethodology">
          <RangeBufferMethodology
            result={result}
            startDate={start}
            endDate={end}
          />
        </SectionErrorBoundary>
      </FadeIn>
    </PageLayout>
  );
}
