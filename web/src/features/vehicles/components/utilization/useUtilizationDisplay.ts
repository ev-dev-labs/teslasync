import { useCallback, useMemo } from 'react';

import { useUnits } from '@/hooks/useUnits';
import {
  formatDayKey,
  formatDurationSecondsAsMinutes,
} from '@/lib/dateFormat';
import { convertDistanceFromSI } from '@/lib/unitConversion';

export function useUtilizationDisplay() {
  const { unitPrefs, formatDistance, formatEnergy } = useUnits();
  const distanceUnit = unitPrefs.distance;

  const toDisplayDistance = useCallback(
    (meters: number) => convertDistanceFromSI(meters, distanceUnit),
    [distanceUnit],
  );
  const formatDay = useCallback(
    (day: string) => formatDayKey(day, { style: 'long' }),
    [],
  );
  const formatDayShort = useCallback(
    (day: string) => formatDayKey(day, { style: 'short' }),
    [],
  );
  const formatDuration = useCallback(
    (seconds: number | null | undefined) =>
      formatDurationSecondsAsMinutes(seconds),
    [],
  );

  return useMemo(
    () => ({
      distanceUnit,
      formatDay,
      formatDayShort,
      formatDistance,
      formatDuration,
      formatEnergy,
      toDisplayDistance,
    }),
    [
      distanceUnit,
      formatDay,
      formatDayShort,
      formatDistance,
      formatDuration,
      formatEnergy,
      toDisplayDistance,
    ],
  );
}
