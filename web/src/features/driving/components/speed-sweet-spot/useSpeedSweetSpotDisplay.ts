import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useUnits } from '@/hooks/useUnits';

import {
  convertDistanceFromSI,
  convertDistanceToSI,
  convertSpeedFromSI,
} from '@/lib/unitConversion';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { getGlobalPrecision } from '@/lib/numberFormat';

/** Unit-aware render-boundary helpers for the SI-canonical evidence model. */
export function useSpeedSweetSpotDisplay() {
  const { fmtNumber, precision: displayPrecision, locale: displayLocale } = useNumberFormatting();
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const speedUnit = unitPrefs.speed;
  const efficiencyUnit =
    distanceUnit === 'mi'
      ? t('sweetSpot.whPerMi', 'Wh/mi')
      : t('sweetSpot.whPerKm', 'Wh/km');
  const efficiencyScale = convertDistanceToSI(1, distanceUnit) / 1_000;

  const convertEfficiency = useCallback(
    (whPerKm: number) => whPerKm * efficiencyScale,
    [efficiencyScale],
  );
  const convertBandSpeed = useCallback(
    (speedKph: number) => convertSpeedFromSI(speedKph / 3.6, speedUnit),
    [speedUnit],
  );
  const convertDriveSpeed = useCallback(
    (speedMps: number) => convertSpeedFromSI(speedMps, speedUnit),
    [speedUnit],
  );
  const convertDistance = useCallback(
    (distanceM: number) => convertDistanceFromSI(distanceM, distanceUnit),
    [distanceUnit],
  );

  const formatEfficiency = useCallback(
    (whPerKm: number | null | undefined, precision = getGlobalPrecision()) =>
      whPerKm != null && Number.isFinite(whPerKm)
        ? `${fmtNumber(convertEfficiency(whPerKm), precision)} ${efficiencyUnit}`
        : '—',
    [convertEfficiency, efficiencyUnit, fmtNumber, displayPrecision, displayLocale],
  );
  const formatSignedEfficiency = useCallback(
    (whPerKm: number | null | undefined, precision = getGlobalPrecision()) => {
      if (whPerKm == null || !Number.isFinite(whPerKm)) return '—';
      const converted = convertEfficiency(whPerKm);
      const sign = converted > 0 ? '+' : converted < 0 ? '−' : '';
      return `${sign}${fmtNumber(Math.abs(converted), precision)} ${efficiencyUnit}`;
    },
    [convertEfficiency, efficiencyUnit, fmtNumber, displayPrecision, displayLocale],
  );
  const formatDistance = useCallback(
    (distanceM: number | null | undefined, precision = getGlobalPrecision()) =>
      distanceM != null && Number.isFinite(distanceM)
        ? `${fmtNumber(convertDistance(distanceM), precision)} ${distanceUnit}`
        : '—',
    [convertDistance, distanceUnit, fmtNumber, displayPrecision, displayLocale],
  );
  const formatBand = useCallback(
    (fromKph: number, toKph: number) =>
      t('sweetSpot.band.range', '{{from}}–{{to}} {{unit}}', {
        from: fmtNumber(convertBandSpeed(fromKph)),
        to: fmtNumber(convertBandSpeed(toKph)),
        unit: speedUnit,
      }),
    [convertBandSpeed, speedUnit, t, fmtNumber],
  );
  const formatMonth = useCallback(
    (month: string) => {
      const match = /^(\d{4})-(\d{2})$/.exec(month);
      if (!match) return '—';
      const year = Number(match[1]);
      const monthIndex = Number(match[2]) - 1;
      if (!Number.isFinite(year) || monthIndex < 0 || monthIndex > 11) {
        return '—';
      }
      try {
        return new Intl.DateTimeFormat(unitPrefs.locale, {
          month: 'short',
          year: '2-digit',
          timeZone: 'UTC',
        }).format(new Date(Date.UTC(year, monthIndex, 1, 12)));
      } catch {
        return month;
      }
    },
    [unitPrefs.locale],
  );

  return {
    unitPrefs,
    distanceUnit,
    speedUnit,
    efficiencyUnit,
    convertEfficiency,
    convertBandSpeed,
    convertDriveSpeed,
    convertDistance,
    formatEfficiency,
    formatSignedEfficiency,
    formatDistance,
    formatBand,
    formatMonth,
  };
}
