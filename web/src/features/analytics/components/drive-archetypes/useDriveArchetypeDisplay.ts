import { useCallback, useMemo } from 'react';

import { useUnits } from '@/hooks/useUnits';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import {
  convertDistanceFromSI,
  convertDistanceToSI,
  convertEnergyFromSI,
  convertSpeedFromSI,
  convertTempFromSI,
} from '@/lib/unitConversion';
import type { ArchetypeDisplay } from './types';

export function useDriveArchetypeDisplay(timeZone: string): ArchetypeDisplay {
  const {
    unitPrefs,
    formatDistance,
    formatSpeed,
    formatTemperature,
    formatEnergy,
    formatDuration,
  } = useUnits();
  const metersPerDisplayDistance = convertDistanceToSI(1, unitPrefs.distance);

  const distanceValue = useCallback(
    (value: number) => convertDistanceFromSI(value, unitPrefs.distance),
    [unitPrefs.distance],
  );
  const speedValue = useCallback(
    (value: number) => convertSpeedFromSI(value, unitPrefs.speed),
    [unitPrefs.speed],
  );
  const temperatureValue = useCallback(
    (value: number) => convertTempFromSI(value, unitPrefs.temperature),
    [unitPrefs.temperature],
  );
  const energyValue = useCallback(
    (value: number) => convertEnergyFromSI(value, unitPrefs.energy),
    [unitPrefs.energy],
  );
  const efficiencyValue = useCallback(
    (value: number) =>
      convertEnergyFromSI(
        value * metersPerDisplayDistance,
        unitPrefs.energy,
      ),
    [metersPerDisplayDistance, unitPrefs.energy],
  );
  const formatEfficiency = useCallback(
    (value: number | null | undefined, precision?: number) => {
      if (value == null || !Number.isFinite(value)) return '—';
      return `${fmtNumber(
        efficiencyValue(value),
        precision ?? unitPrefs.precision ?? 1,
        unitPrefs.locale,
      )} ${unitPrefs.energy}/${unitPrefs.distance}`;
    },
    [
      efficiencyValue,
      unitPrefs.distance,
      unitPrefs.energy,
      unitPrefs.locale,
      unitPrefs.precision,
    ],
  );
  const formatDateMs = useCallback(
    (milliseconds: number | null) =>
      milliseconds == null
        ? '—'
        : formatDateTime(new Date(milliseconds), {
            locale: unitPrefs.locale,
            tz: timeZone,
          }),
    [timeZone, unitPrefs.locale],
  );
  const formatMonth = useCallback(
    (month: string) => {
      const [year, monthNumber] = month.split('-').map(Number);
      if (
        !Number.isInteger(year)
        || !Number.isInteger(monthNumber)
        || monthNumber! < 1
        || monthNumber! > 12
      ) {
        return '—';
      }
      try {
        return new Intl.DateTimeFormat(unitPrefs.locale, {
          month: 'short',
          year: 'numeric',
          timeZone: 'UTC',
        }).format(new Date(Date.UTC(year!, monthNumber! - 1, 1)));
      } catch {
        return month;
      }
    },
    [unitPrefs.locale],
  );
  const formatHour = useCallback((hour: number) => {
    const minutes = ((Math.round(hour * 60) % 1440) + 1440) % 1440;
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(
      minutes % 60,
    ).padStart(2, '0')}`;
  }, []);

  return useMemo(
    () => ({
      distanceUnit: unitPrefs.distance,
      speedUnit: unitPrefs.speed,
      temperatureUnit: unitPrefs.temperature,
      energyUnit: unitPrefs.energy,
      efficiencyUnit: `${unitPrefs.energy}/${unitPrefs.distance}`,
      locale: unitPrefs.locale,
      distanceValue,
      speedValue,
      temperatureValue,
      energyValue,
      efficiencyValue,
      formatDistance,
      formatSpeed,
      formatTemperature,
      formatEnergy,
      formatDuration,
      formatEfficiency,
      formatDateTime: formatDateMs,
      formatMonth,
      formatHour,
    }),
    [
      distanceValue,
      efficiencyValue,
      energyValue,
      formatDateMs,
      formatDistance,
      formatDuration,
      formatEfficiency,
      formatEnergy,
      formatHour,
      formatMonth,
      formatSpeed,
      formatTemperature,
      speedValue,
      temperatureValue,
      unitPrefs.distance,
      unitPrefs.energy,
      unitPrefs.locale,
      unitPrefs.speed,
      unitPrefs.temperature,
    ],
  );
}
