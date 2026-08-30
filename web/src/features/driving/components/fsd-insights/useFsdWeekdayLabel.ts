import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

const DAY_LABELS: Record<number, { key: string; fallback: string }> = {
  0: { key: 'fsd.weekday.sun', fallback: 'Sun' },
  1: { key: 'fsd.weekday.mon', fallback: 'Mon' },
  2: { key: 'fsd.weekday.tue', fallback: 'Tue' },
  3: { key: 'fsd.weekday.wed', fallback: 'Wed' },
  4: { key: 'fsd.weekday.thu', fallback: 'Thu' },
  5: { key: 'fsd.weekday.fri', fallback: 'Fri' },
  6: { key: 'fsd.weekday.sat', fallback: 'Sat' },
};

/**
 * Stable localized label resolver for JS weekday indices (0 = Sunday).
 *
 * Returned callback is memoized on `t`, so the weekday chart's row memo does
 * not recompute on every render.
 */
export function useFsdWeekdayLabel() {
  const { t } = useTranslation();
  return useCallback(
    (weekday: number) => {
      const label = DAY_LABELS[weekday] ?? { key: 'fsd.weekday.unknown', fallback: 'Unknown' };
      return t(label.key, label.fallback);
    },
    [t],
  );
}
