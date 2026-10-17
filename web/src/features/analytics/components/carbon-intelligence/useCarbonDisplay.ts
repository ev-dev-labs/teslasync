import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useUnits } from '@/hooks/useUnits';
import { convertEnergyFromSI } from '@/lib/unitConversion';
import type { CarbonDisplay } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { getGlobalPrecision } from '@/lib/numberFormat';

function isFiniteNumber(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value);
}

export function useCarbonDisplay(): CarbonDisplay {
  const { precision: displayPrecision, locale: displayLocale } = useNumberFormatting();
  const { t, i18n } = useTranslation();
  const { unitPrefs, formatDistance, formatEnergy } = useUnits();
  const locale = unitPrefs.locale || i18n.language || 'en-US';
  const energyUnit = unitPrefs.energy;

  const formatNumber = useCallback(
    (value: number | null | undefined, precision = getGlobalPrecision()) =>
      isFiniteNumber(value)
        ? new Intl.NumberFormat(locale, {
          minimumFractionDigits: precision,
          maximumFractionDigits: precision,
        }).format(value)
        : '—',
    [locale, displayPrecision, displayLocale],
  );
  const energyValue = useCallback(
    (wattHours: number) => convertEnergyFromSI(wattHours, energyUnit),
    [energyUnit],
  );
  const formatKg = useCallback(
    (kilograms: number | null | undefined, precision = getGlobalPrecision()) =>
      isFiniteNumber(kilograms)
        ? t('carbon.units.kgCo2', '{{value}} kg CO₂', {
          value: formatNumber(kilograms, precision),
        })
        : '—',
    [formatNumber, t, displayPrecision, displayLocale],
  );
  const formatSignedKg = useCallback(
    (kilograms: number | null | undefined, precision = getGlobalPrecision()) => {
      if (!isFiniteNumber(kilograms)) return '—';
      const sign = kilograms > 0 ? '+' : '';
      return t('carbon.units.signedKgCo2', '{{sign}}{{value}} kg CO₂', {
        sign,
        value: formatNumber(kilograms, precision),
      });
    },
    [formatNumber, t, displayPrecision, displayLocale],
  );
  const formatIntensity = useCallback(
    (intensity: number | null | undefined, precision = getGlobalPrecision()) =>
      isFiniteNumber(intensity)
        ? t('carbon.units.intensity', '{{value}} g CO₂/kWh', {
          value: formatNumber(intensity, precision),
        })
        : '—',
    [formatNumber, t, displayPrecision, displayLocale],
  );
  const formatPercent = useCallback(
    (percentage: number | null | undefined, precision = getGlobalPrecision()) =>
      isFiniteNumber(percentage)
        ? t('carbon.units.percent', '{{value}}%', {
          value: formatNumber(percentage, precision),
        })
        : '—',
    [formatNumber, t, displayPrecision, displayLocale],
  );
  const formatHour = useCallback(
    (hour: number | null | undefined) =>
      isFiniteNumber(hour)
        ? t('carbon.units.clockHour', '{{hour}}:00', {
          hour: String(hour).padStart(2, '0'),
        })
        : '—',
    [t],
  );
  const formatMonth = useCallback(
    (month: string) => {
      const match = /^(\d{4})-(\d{2})$/.exec(month);
      if (!match) return month;
      const year = Number(match[1]);
      const monthIndex = Number(match[2]) - 1;
      return new Intl.DateTimeFormat(locale, {
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(Date.UTC(year, monthIndex, 1)));
    },
    [locale],
  );

  return useMemo(
    () => ({
      energyUnit,
      energyValue,
      formatDistance,
      formatEnergy,
      formatKg,
      formatSignedKg,
      formatIntensity,
      formatPercent,
      formatNumber,
      formatHour,
      formatMonth,
    }),
    [
      energyUnit,
      energyValue,
      formatDistance,
      formatEnergy,
      formatHour,
      formatIntensity,
      formatKg,
      formatMonth,
      formatNumber,
      formatPercent,
      formatSignedKg,
    ],
  );
}
