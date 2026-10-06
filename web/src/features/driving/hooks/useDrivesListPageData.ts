import { useMemo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useSavedViewUrl } from '@/hooks/useSavedViewUrl';
import { useRangeState } from '@/hooks/useRangeState';
import { useDrives } from '@/api/hooks/useDriving';
import { useFsdInsightsRange } from '@/api/hooks/useAnalytics';
import { useFormatting } from '@/hooks/useFormatting';
import { useUnits } from '@/hooks/useUnits';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDataState } from '@/hooks/useDataState';
import { useCrossTabRefresh } from '@/hooks/useCrossTabRefresh';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useTimezone } from '@/lib/timezone';
import { calendarRangeToInstants } from '@/lib/dateRange';
import type { Drive } from '@/types/driving';
import type { DriveFsdInsight } from '@/types/fsd';
import { convertDistanceFromSI, convertSpeedFromSI, convertTempFromSI, convertPowerFromSI } from '@/lib/unitConversion';
import { priorPeriod, shiftDayKey } from '@/lib/drivesAggregation';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { DRIVES_FETCH_LIMIT, FSD_MAX_RANGE_DAYS, inclusiveDateKeySpan } from '../components/drives-orchestrator/drivesListConstants';

export function useDrivesListPageData() {
  const { fmtNumber, fmtInt, fmtCompact } = useNumberFormatting();
  const { t } = useTranslation();
  const navigate = useNavigate();
  usePageTitle(t('drives.title', 'Drive History'));
  const savedView = useSavedViewUrl();
  const desktopEvidence = useMediaQuery('(min-width: 1024px)');

  /* Data hooks */
  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;

  /* Selected range. Read before the data hook because it scopes the request:
   * the API applies a 50-row default page, so filtering client-side alone
   * capped this page at the 50 newest drives regardless of the chosen range
   * or page size. */
  const { start: startDate, end: endDate } = useRangeState({
    persistKey: 'drives.list.range',
  });
  const priorRange = useMemo(() => priorPeriod(startDate, endDate), [startDate, endDate]);

  /* Fetch window. It has to reach back over the prior period as well, because
   * the delta comparison below is computed from drives that fall *before* the
   * selected range. Both ends are padded by a day: the API filters on UTC
   * while this page buckets drives by the vehicle's local day, so an exact
   * window would drop rows the tz-aware filter should keep. */
  const fetchWindow = useMemo(() => ({
    start: shiftDayKey(priorRange?.start ?? startDate, -1) ?? undefined,
    end: shiftDayKey(endDate, 1) ?? undefined,
    limit: DRIVES_FETCH_LIMIT,
  }), [priorRange, startDate, endDate]);

  const drivesQuery = useDrives(vehicleIdStr, fetchWindow);
  const { data: drives, refetch: refetchDrives } = drivesQuery;
  const hasDrivePayload = Array.isArray(drives);
  /* Refresh failures retain rows. Initial failures stay in source-local
   * recovery panels so the independent FSD source remains reachable. */
  const drivesState = useDataState(drivesQuery, { provenance: 'historical' });
  const isDrivesLoading = drivesState.status === 'initial';
  const [previewDrive, setPreviewDrive] = useState<Drive | null>(null);

  /* Single source of truth for the vehicle + date window every scoped read and
   * every export on this page must agree on. `scopedPath` renders it as
   * sorted, URL-encoded snake_case params and strips any accidental
   * `/api/v1` prefix, so a download link can never drift from the filters the
   * user can see. */
  const exportScope = useMemo(() => ({
    vehicleId: vehicleId ?? null,
    start: startDate,
    end: endDate,
    filters: { format: 'csv' },
  }), [vehicleId, startDate, endDate]);

  /* A full page back means the range almost certainly holds more drives than
   * one request can carry. Say so rather than silently showing a subset. */
  const truncated = (drives?.length ?? 0) >= DRIVES_FETCH_LIMIT;

  /* Active vehicle's IANA timezone — every "what day is this drive?"
 * decision on this page must use this rather than the browser's local
 * zone, otherwise late-night drives appear under the wrong day in the
 * grouped list, the chart shows ghost bars on the next UTC day, and
 * the period stats undercount/overcount drives near the boundary. */
  const tz = useTimezone('vehicle');
  const fsdRange = useMemo(
    () => calendarRangeToInstants({
      startDate,
      endDate,
      timezone: tz,
    }),
    [startDate, endDate, tz],
  );
  const fsdRangeSupported = inclusiveDateKeySpan(startDate, endDate) <= FSD_MAX_RANGE_DAYS;
  const fsdQuery = useFsdInsightsRange(
    fsdRangeSupported ? vehicleIdStr : undefined,
    fsdRange.startInstant,
    fsdRange.endInstantExclusive,
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
    (whPerKm: number) => unitPrefs.distance === 'mi' ? whPerKm * 1.609344 : whPerKm,
    [unitPrefs.distance],
  );
  const { formatEnergyCost, costPerKwh, formatCurrency } = useFormatting();

  return {
    fmtNumber, fmtInt, fmtCompact, t, navigate, savedView, desktopEvidence,
    vehicleId, startDate, endDate, priorRange, drives, drivesQuery,
    refetchDrives, hasDrivePayload, drivesState, isDrivesLoading,
    previewDrive, setPreviewDrive, exportScope, truncated, tz,
    fsdRangeSupported, refetchFsd, fsdState, fsdDataAvailable, fsdByDriveID,
    handlePullToRefresh, unitPrefs, formatEnergy, toDistanceDisplay,
    distanceUnit, speedUnit, efficiencyUnit, toSpeedDisplay,
    toTemperatureDisplay, toPowerDisplay, toEfficiencyDisplay,
    formatEnergyCost, costPerKwh, formatCurrency,
  };
}
