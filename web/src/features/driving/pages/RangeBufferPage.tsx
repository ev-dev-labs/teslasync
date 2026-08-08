import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDrives } from '@/api/hooks/useDriving';
import { RangePicker, VehicleSelect } from '@/components/forms';
import { Grid, PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useRangeState } from '@/hooks/useRangeState';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { useTimezone } from '@/lib/timezone';
import type { Drive } from '@/types/driving';

import {
  RangeBufferAccounting,
  RangeBufferDestinationDirectory,
  RangeBufferDistanceProfile,
  RangeBufferDistribution,
  RangeBufferDriveContext,
  RangeBufferEvidenceSupport,
  RangeBufferHourProfile,
  RangeBufferKpiBand,
  RangeBufferLowArrivals,
  RangeBufferMethodology,
  RangeBufferMonthTrend,
  RangeBufferThresholdSensitivity,
  RangeBufferWeekdayProfile,
  type RangeBufferQueryState,
} from '../components/range-buffer';
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
  const {
    start,
    end,
    startInstant,
    endInstantExclusive,
    setRange,
  } = useRangeState({
    persistKey: 'range-buffer.range',
    defaultPresetId: 'all',
    timezone: selectedTimeZone,
  });
  const drivesQuery = useDrives(vehicleIdStr, {
    start: startInstant,
    end: endInstantExclusive,
    limit: DRIVE_WINDOW_LIMIT,
  });
  const [nowMs] = useState(() => Date.now());
  const [thresholdPct, setThresholdPct] = useState(
    DEFAULT_RANGE_BUFFER_THRESHOLD_PCT,
  );
  const hasCachedData =
    vehicleId != null && drivesQuery.data !== undefined;
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

  return (
    <PageContainer
      title={t('rangeBuffer.title', 'Range Buffer')}
      subtitle={t(
        'rangeBuffer.subtitle',
        'Observed arrival SoC distribution, context, and evidence coverage in the vehicle timezone',
      )}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <VehicleSelect />
          <RangePicker
            value={{ start, end }}
            onChange={setRange}
            align="end"
            triggerTestId="range-buffer-range"
          />
        </div>
      }
    >
      <FadeIn>
        <RangeBufferKpiBand
          result={result}
          state={state}
          locale={locale}
          thresholdPct={thresholdPct}
          onThresholdChange={setThresholdPct}
        />
      </FadeIn>

      <FadeIn delay={0.05}>
        <Grid cols={TWO_COLUMNS} gap={4}>
          <RangeBufferDistribution result={result} state={state} />
          <RangeBufferMonthTrend
            result={result}
            state={state}
            locale={locale}
          />
        </Grid>
      </FadeIn>

      <FadeIn delay={0.1}>
        <Grid cols={TWO_COLUMNS} gap={4}>
          <RangeBufferThresholdSensitivity
            result={result}
            state={state}
          />
          <RangeBufferWeekdayProfile
            result={result}
            state={state}
            timeZone={result.timeZone}
          />
        </Grid>
      </FadeIn>

      <FadeIn delay={0.15}>
        <Grid cols={TWO_COLUMNS} gap={4}>
          <RangeBufferHourProfile
            result={result}
            state={state}
            timeZone={result.timeZone}
          />
          <RangeBufferDistanceProfile
            result={result}
            state={state}
            formatDistance={formatDistance}
          />
        </Grid>
      </FadeIn>

      <FadeIn delay={0.2}>
        <RangeBufferDriveContext
          result={result}
          state={state}
          locale={locale}
          formatDistance={formatDistance}
        />
      </FadeIn>

      <FadeIn delay={0.25}>
        <RangeBufferDestinationDirectory
          result={result}
          state={state}
          locale={locale}
          timeZone={result.timeZone}
          formatDistance={formatDistance}
        />
      </FadeIn>

      <FadeIn delay={0.3}>
        <RangeBufferLowArrivals
          result={result}
          state={state}
          locale={locale}
          timeZone={result.timeZone}
          formatDistance={formatDistance}
        />
      </FadeIn>

      <FadeIn delay={0.35}>
        <RangeBufferEvidenceSupport
          result={result}
          state={state}
          locale={locale}
        />
      </FadeIn>

      <FadeIn delay={0.4}>
        <RangeBufferAccounting result={result} state={state} />
      </FadeIn>

      <FadeIn delay={0.45}>
        <RangeBufferMethodology
          result={result}
          startDate={start}
          endDate={end}
        />
      </FadeIn>
    </PageContainer>
  );
}
