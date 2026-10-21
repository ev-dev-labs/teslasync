import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useUnits } from '@/hooks/useUnits';
import { formatMonthYear } from '@/lib/dateFormat';

import { convertDistanceToSI } from '@/lib/unitConversion';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

/** Unit-aware render-boundary helpers for SI-canonical cold-start evidence. */
export function useColdStartDisplay() {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const units = useUnits();
  const distanceUnit = units.unitPrefs.distance;
  const efficiencyUnit =
    distanceUnit === 'mi'
      ? t('coldStart.whPerMi', 'Wh/mi')
      : t('coldStart.whPerKm', 'Wh/km');

  const toEfficiencyDisplay = useCallback(
    (whPerKm: number) =>
      whPerKm * (convertDistanceToSI(1, distanceUnit) / 1_000),
    [distanceUnit],
  );

  const formatEfficiency = useCallback(
    (whPerKm: number | null | undefined) =>
      whPerKm != null && Number.isFinite(whPerKm)
        ? `${fmtNumber(toEfficiencyDisplay(whPerKm))} ${efficiencyUnit}`
        : '—',
    [toEfficiencyDisplay, efficiencyUnit, fmtNumber],
  );

  const formatMonth = useCallback(
    (month: string) => formatMonthYear(month, { locale: units.unitPrefs.locale, yearStyle: '2-digit' }),
    [units.unitPrefs.locale],
  );

  return {
    ...units,
    efficiencyUnit,
    toEfficiencyDisplay,
    formatEfficiency,
    formatMonth,
  };
}
