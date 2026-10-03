import { useCallback } from 'react';

import { useUnits } from '@/hooks/useUnits';
import { formatDate } from '@/lib/dateFormat';
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
    (monthStartMs: number) => {
      try {
        return new Intl.DateTimeFormat(locale, {
          month: 'short',
          year: 'numeric',
          timeZone: 'UTC',
        }).format(new Date(monthStartMs));
      } catch {
        return formatDate(new Date(monthStartMs), {
          locale: 'en-US',
          tz: 'UTC',
        });
      }
    },
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
