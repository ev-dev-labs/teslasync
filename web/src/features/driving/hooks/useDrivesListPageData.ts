import { useMemo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useSavedViewUrl } from '@/hooks/useSavedViewUrl';
import { useRangeState } from '@/hooks/useRangeState';
import { useDriveGridOverview } from '@/api/hooks/useDriveGrid';
import { useFsdInsightsRange } from '@/api/hooks/useAnalytics';
import { useFormatting } from '@/hooks/useFormatting';
import { useUnits } from '@/hooks/useUnits';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDataState } from '@/hooks/useDataState';
import { useCrossTabRefresh } from '@/hooks/useCrossTabRefresh';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useDateFormat } from '@/hooks/useDateFormat';
import { calendarRangeToInstants } from '@/lib/dateRange';
import type { Drive } from '@/types/driving';
import type { DriveFsdInsight } from '@/types/fsd';
import { convertDistanceFromSI, convertSpeedFromSI, convertTempFromSI, convertPowerFromSI, convertEfficiencyFromSI } from '@/lib/unitConversion';
import { isAllTimeRange } from '@/lib/datePresets';
import { priorPeriod } from '@/lib/drivesAggregation';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { FSD_MAX_RANGE_DAYS, inclusiveDateKeySpan } from '../components/drives-orchestrator/drivesListConstants';

export function useDrivesListPageData() {
  const { fmtNumber, fmtInt, fmtCompact, locale, precision } = useNumberFormatting();
  const { t } = useTranslation();
  const navigate = useNavigate();
  usePageTitle(t('drives.title', 'Drive History'));
  const savedView = useSavedViewUrl();
  const desktopEvidence = useMediaQuery('(min-width: 1024px)');

  /* Data hooks */
  const { vehicleId, vehicle } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;

  const { tz } = useDateFormat();
  const { start: startDate, end: endDate, startInstant, endInstantExclusive, presetId: rangePresetId } = useRangeState({
    persistKey: 'drives.list.range',
  });
  // All time has no meaningful prior window: mirroring an equal-length
  // range before "2015-01-01 → today" yields a nonsense pre-history
  // window (e.g. 2003–2014), so the comparison is skipped instead.
  const isAllTime = useMemo(
    () => isAllTimeRange(startDate, endDate, rangePresetId),
    [startDate, endDate, rangePresetId],
  );
  const priorRange = useMemo(
    () => (isAllTime ? null : priorPeriod(startDate, endDate)),
    [isAllTime, startDate, endDate],
  );

  const gridScope = useMemo(() => ({ start: startInstant, end: endInstantExclusive, timezone: tz }), [startInstant, endInstantExclusive, tz]);
  const priorStart = useMemo(() => {
    if (!priorRange) return undefined;
    if (rangePresetId === 'live' || rangePresetId === '6h' || rangePresetId === '24h') {
      const start = Date.parse(startInstant);
      return new Date(start - (Date.parse(endInstantExclusive) - start)).toISOString();
    }
    return calendarRangeToInstants({ startDate: priorRange.start, endDate: priorRange.end, timezone: tz }).startInstant;
  }, [priorRange, rangePresetId, startInstant, endInstantExclusive, tz]);
  const drivesQuery = useDriveGridOverview(vehicleId ?? null, gridScope, priorStart);
  const { refetch: refetchDrives } = drivesQuery;
  const drivesState = useDataState(drivesQuery, { provenance: 'historical' });
  const hasDrivePayload = drivesState.data != null;
  const isDrivesLoading = drivesState.status === 'initial';
  const [previewDrive, setPreviewDrive] = useState<Drive | null>(null);

  /* Single source of truth for the vehicle + date window every scoped read and
   * every export on this page must agree on. `scopedPath` renders it as
   * sorted, URL-encoded snake_case params and strips any accidental
   * `/api/v1` prefix, so a download link can never drift from the filters the
   * user can see. */
  const exportScope = useMemo(() => ({
    vehicleId: vehicleId ?? null,
    start: startInstant,
    end: endInstantExclusive,
    filters: { format: 'csv' },
  }), [vehicleId, startInstant, endInstantExclusive]);
  const fsdRangeSupported = inclusiveDateKeySpan(startDate, endDate) <= FSD_MAX_RANGE_DAYS;
  const fsdQuery = useFsdInsightsRange(
    fsdRangeSupported ? vehicleIdStr : undefined,
    startInstant,
    endInstantExclusive,
    tz,
  );
  const { refetch: refetchFsd } = fsdQuery;
  const fsdState = useDataState(fsdQuery, { provenance: 'historical' });
  const fsdDataAvailable = vehicleIdStr != null
    && fsdRangeSupported
    && fsdState.data?.drive_analytics != null;
  const fsdByDriveID = useMemo(
    () => new Map<number, DriveFsdInsight>(
      (fsdState.data?.drive_analytics?.contributing_drives ?? [])
        .map((insight) => [insight.drive_id, insight]),
    ),
    [fsdState.data],
  );

  /* A deliberate pull-to-refresh covers both the primary drive list and its
   * FSD enrichment, locally and in other tabs. */
  const { refresh: refreshAcrossTabs } = useCrossTabRefresh({
    queryKeys: [['drives'], ['analytics', 'fsd']],
  });
  const handlePullToRefresh = useCallback(async () => {
    refreshAcrossTabs();
    const refreshes: Promise<unknown>[] = [refetchDrives()];
    if (vehicleIdStr != null && fsdRangeSupported) {
      refreshes.push(refetchFsd());
    }
    await Promise.all(refreshes);
  }, [
    fsdRangeSupported,
    refetchFsd,
    refreshAcrossTabs,
    refetchDrives,
    vehicleIdStr,
  ]);

  /* Unit conversion */
  const { unitPrefs, formatEnergy } = useUnits();
  const toDistanceDisplay = useCallback(
    (v: number) => convertDistanceFromSI(v, unitPrefs.distance),
    [unitPrefs.distance],
  );
  const distanceUnit = unitPrefs.distance;
  const speedUnit = unitPrefs.speed;
  const efficiencyUnit = unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';
  const toSpeedDisplay = useCallback(
    (v: number) => convertSpeedFromSI(v, unitPrefs.speed),
    [unitPrefs.speed],
  );
  const toTemperatureDisplay = useCallback(
    (value: number) => convertTempFromSI(value, unitPrefs.temperature),
    [unitPrefs.temperature],
  );
  const toPowerDisplay = useCallback(
    (value: number) => convertPowerFromSI(value, unitPrefs.power),
    [unitPrefs.power],
  );
  const toEfficiencyDisplay = useCallback(
    (whPerKm: number) => convertEfficiencyFromSI(whPerKm, unitPrefs.distance),
    [unitPrefs.distance],
  );
  const { formatEnergyCost, costPerKwh, formatCurrency } = useFormatting();

  return {
    fmtNumber, fmtInt, fmtCompact, locale, precision, t, navigate, savedView, desktopEvidence,
    vehicleId, vehicleName: vehicle?.displayName, startDate, endDate, priorRange, isAllTime, drivesQuery,
    refetchDrives, hasDrivePayload, drivesState, isDrivesLoading,
    previewDrive, setPreviewDrive, exportScope, gridScope, tz,
    fsdRangeSupported, refetchFsd, fsdState, fsdDataAvailable, fsdByDriveID,
    handlePullToRefresh, unitPrefs, formatEnergy, toDistanceDisplay,
    distanceUnit, speedUnit, efficiencyUnit, toSpeedDisplay,
    toTemperatureDisplay, toPowerDisplay, toEfficiencyDisplay,
    formatEnergyCost, costPerKwh, formatCurrency,
  };
}
