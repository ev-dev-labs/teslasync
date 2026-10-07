import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useUnits } from '@/hooks/useUnits';
import { formatDayKey } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import { convertDistanceToSI } from '@/lib/unitConversion';

export function useEfficiencyTargetDisplay() {
  const { t, i18n } = useTranslation();
  const { unitPrefs, formatDistance } = useUnits();
  const distanceUnit = unitPrefs.distance === 'mi' ? 'mi' : 'km';
  const efficiencyScale = convertDistanceToSI(1, distanceUnit) / 1000;
  const efficiencyUnit =
    distanceUnit === 'mi'
      ? t('effTarget.whPerMi', 'Wh/mi')
      : t('effTarget.whPerKm', 'Wh/km');

  const convertEfficiency = useCallback(
    (whPerKm: number) => whPerKm * efficiencyScale,
    [efficiencyScale],
  );
  const formatEfficiency = useCallback(
    (whPerKm: number | null, precision = 0) =>
      whPerKm == null
        ? '—'
        : `${fmtNumber(
            convertEfficiency(whPerKm),
            precision,
            unitPrefs.locale,
          )} ${efficiencyUnit}`,
    [convertEfficiency, efficiencyUnit, unitPrefs.locale],
  );
  const formatSignedEfficiency = useCallback(
    (whPerKm: number | null, precision = 0) => {
      if (whPerKm == null) return '—';
      const sign = whPerKm > 0 ? '+' : whPerKm < 0 ? '−' : '';
      return `${sign}${fmtNumber(
        Math.abs(convertEfficiency(whPerKm)),
        precision,
        unitPrefs.locale,
      )} ${efficiencyUnit}`;
    },
    [convertEfficiency, efficiencyUnit, unitPrefs.locale],
  );
  const formatWeek = useCallback(
    (weekStart: string) =>
      formatDayKey(weekStart, {
        style: 'short',
        locale: i18n.language,
      }),
    [i18n.language],
  );

  return useMemo(
    () => ({
      convertEfficiency,
      efficiencyUnit,
      formatDistance,
      formatEfficiency,
      formatSignedEfficiency,
      formatWeek,
    }),
    [
      convertEfficiency,
      efficiencyUnit,
      formatDistance,
      formatEfficiency,
      formatSignedEfficiency,
      formatWeek,
    ],
  );
}
