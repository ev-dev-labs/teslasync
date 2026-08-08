import { useCallback } from 'react';

import { useUnits } from '@/hooks/useUnits';
import { fmtNumber, fmtPercent } from '@/lib/numberFormat';
import { convertDistanceFromSI } from '@/lib/unitConversion';

import type { CompareMetricKey } from '../../lib/driveCompare';

export type CompareMetricFormatter = (key: CompareMetricKey, value: number | null) => string;

/** Unit-aware formatter shared by the scorecard and full comparison grid. */
export function useCompareMetricFormatter(): CompareMetricFormatter {
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
        return formatDistance(value, { precision: 1 });
      case 'durationS':
        return formatDuration(value, { precision: 0 });
      case 'avgSpeedMps':
      case 'maxSpeedMps':
        return formatSpeed(value, { precision: 0 });
      case 'energyUsedWh':
        return formatEnergy(value, { precision: 1 });
      case 'whPerKm': {
        const displayDistancePerKm = convertDistanceFromSI(1_000, unitPrefs.distance);
        const consumption = displayDistancePerKm > 0 ? value / displayDistancePerKm : value;
        return `${fmtNumber(consumption, 0)} Wh/${unitPrefs.distance}`;
      }
      case 'regenShare':
        return fmtPercent(value * 100, 0);
      case 'socUsed':
        return fmtPercent(value, 0);
      case 'outsideTempAvgC':
        return formatTemperature(value, { precision: 0 });
      case 'score':
        return `${fmtNumber(value, 0)}/100`;
    }
  }, [
    formatDistance,
    formatDuration,
    formatEnergy,
    formatSpeed,
    formatTemperature,
    unitPrefs.distance,
  ]);
}
