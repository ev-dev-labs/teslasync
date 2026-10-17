import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useUnits } from '@/hooks/useUnits';
import {
  convertDistanceFromSI,
  convertDurationFromSI,
  convertEnergyFromSI,
} from '@/lib/unitConversion';
import type { ShareCardDisplay } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { getGlobalPrecision } from '@/lib/numberFormat';

function finite(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value);
}

export function useShareCardDisplay(): ShareCardDisplay {
  const { precision: displayPrecision, locale: displayLocale } = useNumberFormatting();
  const { t, i18n } = useTranslation();
  const {
    unitPrefs,
    formatDistance,
    formatDuration,
    formatEnergy,
    formatSpeed,
    formatTemperature,
  } = useUnits();
  const locale = unitPrefs.locale || i18n.language || 'en-US';

  const formatNumber = useCallback(
    (value: number | null | undefined, precision = getGlobalPrecision()) =>
      finite(value)
        ? new Intl.NumberFormat(locale, {
          maximumFractionDigits: precision,
        }).format(value)
        : '—',
    [locale, displayPrecision, displayLocale],
  );
  const distanceValue = useCallback(
    (meters: number) => convertDistanceFromSI(meters, unitPrefs.distance),
    [unitPrefs.distance],
  );
  const durationValue = useCallback(
    (seconds: number) => convertDurationFromSI(seconds, unitPrefs.duration),
    [unitPrefs.duration],
  );
  const energyValue = useCallback(
    (wattHours: number) => convertEnergyFromSI(wattHours, unitPrefs.energy),
    [unitPrefs.energy],
  );
  const formatEfficiency = useCallback(
    (whPerKm: number | null | undefined) => {
      if (!finite(whPerKm)) return '—';
      const displayDistance = convertDistanceFromSI(1_000, unitPrefs.distance);
      if (!(displayDistance > 0)) return '—';
      return t('shareCard.units.efficiency', '{{value}} Wh/{{unit}}', {
        value: formatNumber(whPerKm / displayDistance),
        unit: unitPrefs.distance,
      });
    },
    [formatNumber, t, unitPrefs.distance, displayPrecision, displayLocale],
  );
  const formatPercent = useCallback(
    (value: number | null | undefined, precision = getGlobalPrecision()) =>
      finite(value)
        ? t('shareCard.units.percent', '{{value}}%', {
          value: formatNumber(value, precision),
        })
        : '—',
    [formatNumber, t, displayPrecision, displayLocale],
  );
  const formatMonth = useCallback(
    (month: string) => {
      const match = /^(\d{4})-(\d{2})$/.exec(month);
      if (!match) return month;
      return new Intl.DateTimeFormat(locale, {
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)));
    },
    [locale],
  );

  return useMemo(
    () => ({
      distanceUnit: unitPrefs.distance,
      durationUnit: unitPrefs.duration,
      energyUnit: unitPrefs.energy,
      formatNumber,
      formatDistance,
      formatDuration,
      formatEnergy,
      formatSpeed,
      formatTemperature,
      formatEfficiency,
      formatPercent,
      formatMonth,
      distanceValue,
      durationValue,
      energyValue,
    }),
    [
      distanceValue,
      durationValue,
      energyValue,
      formatDistance,
      formatDuration,
      formatEfficiency,
      formatEnergy,
      formatMonth,
      formatNumber,
      formatPercent,
      formatSpeed,
      formatTemperature,
      unitPrefs.distance,
      unitPrefs.duration,
      unitPrefs.energy,
    ],
  );
}
