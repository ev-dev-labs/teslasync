import { useCallback } from 'react';

import { useUnits } from '@/hooks/useUnits';
import { formatDate, formatMonthYear } from '@/lib/dateFormat';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { getGlobalPrecision } from '@/lib/numberFormat';

export function useOdometerMilestoneDisplay() {
  const { precision: displayPrecision, locale: displayLocale } = useNumberFormatting();
  const { formatDistance, unitPrefs } = useUnits();
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
      ms == null ? '—' : formatDate(new Date(ms), { locale }),
    [locale],
  );
  const formatMonth = useCallback(
    // Month-start markers are UTC-anchored, not display-zone instants.
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
