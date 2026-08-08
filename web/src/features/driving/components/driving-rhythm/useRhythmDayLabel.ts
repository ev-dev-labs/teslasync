import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

const DAY_LABELS: Record<number, { key: string; fallback: string }> = {
  0: { key: 'rhythm.day.sun', fallback: 'Sun' },
  1: { key: 'rhythm.day.mon', fallback: 'Mon' },
  2: { key: 'rhythm.day.tue', fallback: 'Tue' },
  3: { key: 'rhythm.day.wed', fallback: 'Wed' },
  4: { key: 'rhythm.day.thu', fallback: 'Thu' },
  5: { key: 'rhythm.day.fri', fallback: 'Fri' },
  6: { key: 'rhythm.day.sat', fallback: 'Sat' },
};

/** Stable localized label resolver for JS weekday indices. */
export function useRhythmDayLabel() {
  const { t } = useTranslation();
  return useCallback(
    (day: number) => {
      const label = DAY_LABELS[day] ?? {
        key: 'rhythm.day.unknown',
        fallback: 'Unknown',
      };
      return t(label.key, label.fallback);
    },
    [t],
  );
}
