import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useUnits } from '@/hooks/useUnits';
import { fmtNumber } from '@/lib/numberFormat';
import { convertDistanceToSI } from '@/lib/unitConversion';

/** Unit-aware render-boundary helpers for SI-canonical cold-start evidence. */
export function useColdStartDisplay() {
  const { t } = useTranslation();
  const units = useUnits();
  const distanceUnit = units.unitPrefs.distance;
  const efficiencyUnit =
    distanceUnit === 'mi'
      ? t('coldStart.whPerMi', 'Wh/mi')
      : t('coldStart.whPerKm', 'Wh/km');

  const convertEfficiency = useCallback(
    (whPerKm: number) =>
      whPerKm * (convertDistanceToSI(1, distanceUnit) / 1_000),
    [distanceUnit],
  );

  const formatEfficiency = useCallback(
    (whPerKm: number | null | undefined) =>
      whPerKm != null && Number.isFinite(whPerKm)
        ? `${fmtNumber(convertEfficiency(whPerKm), 0)} ${efficiencyUnit}`
        : '—',
    [convertEfficiency, efficiencyUnit],
  );

  const formatMonth = useCallback(
    (month: string) => {
      const match = /^(\d{4})-(\d{2})$/.exec(month);
      if (!match) return '—';
      const year = Number(match[1]);
      const monthIndex = Number(match[2]) - 1;
      if (!Number.isFinite(year) || monthIndex < 0 || monthIndex > 11) return '—';
      try {
        return new Intl.DateTimeFormat(units.unitPrefs.locale, {
          month: 'short',
          year: '2-digit',
          timeZone: 'UTC',
        }).format(new Date(Date.UTC(year, monthIndex, 1, 12)));
      } catch {
        return month;
      }
    },
    [units.unitPrefs.locale],
  );

  return {
    ...units,
    efficiencyUnit,
    convertEfficiency,
    formatEfficiency,
    formatMonth,
  };
}
