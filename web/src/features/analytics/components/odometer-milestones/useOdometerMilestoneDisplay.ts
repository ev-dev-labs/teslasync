import { useCallback } from 'react';

import { useUnits } from '@/hooks/useUnits';
import { useDateFormat } from '@/hooks/useDateFormat';
import {formatMonthYear} from '@/lib/dateConvert';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { getGlobalPrecision } from '@/lib/numberFormat';

export function useOdometerMilestoneDisplay() {
  const { precision: displayPrecision, locale: displayLocale } = useNumberFormatting();
  const { formatDistance, unitPrefs } = useUnits();
  const { formatDate } = useDateFormat();
  const { distance: distanceUnit, locale } = unitPrefs;

  const formatDistanceKm = useCallback(
    (km: number | null | undefined, precision = getGlobalPrecision()) =>
      formatDistance(km == null ? null : km * 1_000, { precision }),
    [formatDistance, displayPrecision, displayLocale],
  );
  const toDisplayDistance = useCallback(
    (km: number) => convertDistanceFromSI(km * 1_000, distanceUnit),
    [distanceUnit],
  );
  const formatDateMs = useCallback(
    (ms: number | null | undefined) =>
      ms == null ? '—' : formatDate(new Date(ms)),
    [formatDate],
  );
  const formatMonth = useCallback(
    // Calendar markers encode the already-grouped month, not an observed instant.
    (monthStartMs: number) => formatMonthYear(new Date(monthStartMs), { locale, tz: 'UTC' }),
    [locale],
  );

  return {
    distanceUnit,
    formatDateMs,
    formatDistanceKm,
    formatMonth,
    toDisplayDistance,
  };
}
