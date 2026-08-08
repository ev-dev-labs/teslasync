import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useFormatting } from '@/hooks/useFormatting';
import { useUnits } from '@/hooks/useUnits';
import {
  convertDistanceFromSI,
  convertEnergyFromSI,
} from '@/lib/unitConversion';
import type { TrueCostDisplay } from './types';

function finite(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value);
}

export function useTrueCostDisplay(): TrueCostDisplay {
  const { i18n } = useTranslation();
  const { unitPrefs, formatDistance, formatEnergy } = useUnits();
  const { formatCurrency: currency } = useFormatting();
  const locale = unitPrefs.locale || i18n.language || 'en-US';
  const distanceUnit = unitPrefs.distance;
  const energyUnit = unitPrefs.energy;

  const formatNumber = useCallback(
    (value: number | null | undefined, precision = 2) =>
      finite(value)
        ? new Intl.NumberFormat(locale, {
          minimumFractionDigits: 0,
          maximumFractionDigits: precision,
        }).format(value)
        : '—',
    [locale],
  );
  const formatCurrency = useCallback(
    (value: number | null | undefined, precision = 2) =>
      finite(value) ? currency(value, precision) : '—',
    [currency],
  );
  const formatSignedCurrency = useCallback(
    (value: number | null | undefined, precision = 2) => {
      if (!finite(value)) return '—';
      return `${value > 0 ? '+' : ''}${currency(value, precision)}`;
    },
    [currency],
  );
  const distanceValueKm = useCallback(
    (kilometres: number) =>
      convertDistanceFromSI(kilometres * 1000, distanceUnit),
    [distanceUnit],
  );
  const formatDistanceKm = useCallback(
    (kilometres: number | null | undefined) =>
      finite(kilometres)
        ? formatDistance(kilometres * 1000, { precision: 1 })
        : '—',
    [formatDistance],
  );
  const costPerDistanceValue = useCallback(
    (costPerKm: number) =>
      costPerKm / convertDistanceFromSI(1000, distanceUnit),
    [distanceUnit],
  );
  const formatCostPerDistance = useCallback(
    (costPerKm: number | null | undefined) =>
      finite(costPerKm)
        ? currency(costPerDistanceValue(costPerKm), 4)
        : '—',
    [costPerDistanceValue, currency],
  );
  const energyValue = useCallback(
    (wattHours: number) => convertEnergyFromSI(wattHours, energyUnit),
    [energyUnit],
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

  return useMemo(() => ({
    distanceUnit,
    energyUnit,
    formatNumber,
    formatCurrency,
    formatSignedCurrency,
    formatDistanceKm,
    distanceValueKm,
    costPerDistanceValue,
    formatCostPerDistance,
    formatEnergy,
    energyValue,
    formatMonth,
  }), [
    costPerDistanceValue,
    distanceUnit,
    distanceValueKm,
    energyUnit,
    energyValue,
    formatCostPerDistance,
    formatCurrency,
    formatDistanceKm,
    formatEnergy,
    formatMonth,
    formatNumber,
    formatSignedCurrency,
  ]);
}
