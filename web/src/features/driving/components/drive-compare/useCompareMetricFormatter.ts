import { useCallback } from 'react';

import { useUnits } from '@/hooks/useUnits';

import { convertDistanceFromSI } from '@/lib/unitConversion';

import type { CompareMetricKey } from '../../lib/driveCompare';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export type CompareMetricFormatter = (key: CompareMetricKey, value: number | null) => string;

/** Unit-aware formatter shared by the scorecard and full comparison grid. */
export function useCompareMetricFormatter(): CompareMetricFormatter {
  const { fmtNumber, fmtPercent } = useNumberFormatting();
  const {
    formatDistance,
    formatDuration,
    formatEnergy,
    formatSpeed,
    formatTemperature,
    unitPrefs,
  } = useUnits();

  return useCallback<CompareMetricFormatter>((key, value) => {
    if (value == null) return '—';
    switch (key) {
      case 'distanceM':
        return formatDistance(value);
      case 'durationS':
        return formatDuration(value);
      case 'avgSpeedMps':
      case 'maxSpeedMps':
        return formatSpeed(value);
      case 'energyUsedWh':
        return formatEnergy(value);
      case 'whPerKm': {
        const displayDistancePerKm = convertDistanceFromSI(1_000, unitPrefs.distance);
        const consumption = displayDistancePerKm > 0 ? value / displayDistancePerKm : value;
        return `${fmtNumber(consumption)} Wh/${unitPrefs.distance}`;
      }
      case 'regenShare':
        return fmtPercent(value * 100);
      case 'socUsed':
        return fmtPercent(value);
      case 'outsideTempAvgC':
        return formatTemperature(value);
      case 'score':
        return `${fmtNumber(value)}/100`;
    }
  }, [
    formatDistance,
    formatDuration,
    formatEnergy,
    formatSpeed,
    formatTemperature,
    unitPrefs.distance, fmtNumber, fmtPercent,
  ]);
}
