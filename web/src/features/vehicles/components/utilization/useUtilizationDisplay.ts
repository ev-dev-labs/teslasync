import { useCallback, useMemo } from 'react';

import { useUnits } from '@/hooks/useUnits';
import { useDateFormat } from '@/hooks/useDateFormat';
import {formatDayKey} from '@/lib/dateFormat'
import {formatDurationSecondsAsMinutes} from '@/lib/dateConvert';
import { convertDistanceFromSI } from '@/lib/unitConversion';

export function useUtilizationDisplay() {
  const { locale } = useDateFormat();
  const { unitPrefs, formatDistance, formatEnergy } = useUnits();
  const distanceUnit = unitPrefs.distance;

  const toDisplayDistance = useCallback(
    (meters: number) => convertDistanceFromSI(meters, distanceUnit),
    [distanceUnit],
  );
  const formatDay = useCallback(
    (day: string | null | undefined) => formatDayKey(day, { style: 'long', locale }),
    [locale],
  );
  const formatDayShort = useCallback(
    (day: string | null | undefined) => formatDayKey(day, { style: 'short', locale }),
    [locale],
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
