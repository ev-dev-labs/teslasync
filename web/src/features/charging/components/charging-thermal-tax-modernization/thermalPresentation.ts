import type { ThermalTaxSample, ThermalPhase } from '../../lib/chargingThermalTax';

/** Presentation evidence only. Never changes the specialist's operands or summary. */
export function heaterEvidence(samples: readonly ThermalTaxSample[]) {
  const timed = samples.filter(sample => Number.isFinite(new Date(sample.ts).getTime()));
  const readings = timed.filter(sample =>
    sample.battery_heater_power_w != null && Number.isFinite(sample.battery_heater_power_w));
  const timestamps = new Set(readings.map(sample => new Date(sample.ts).getTime()));
  return {
    hasPeak: readings.length > 0,
    hasIntegral: timestamps.size >= 2,
    incomplete: readings.length < timed.length,
  };
}

/** Nulls are gaps, not measurements of zero. Raw watts stay raw watts. */
export function thermalPowerRows(samples: readonly ThermalTaxSample[], locale: string) {
  return samples
    .map(sample => {
      const ac = finiteNumber(sample.ac_charging_power_w);
      const dc = finiteNumber(sample.dc_charging_power_w);
      return {
        tMs: new Date(sample.ts).getTime(),
        heaterW: finitePower(sample.battery_heater_power_w),
        chargeW: ac == null && dc == null ? null : Math.max(0, (ac ?? 0) + (dc ?? 0)),
      };
    })
    .filter(row => Number.isFinite(row.tMs))
    .sort((a, b) => a.tMs - b.tMs)
    .map(row => ({
      time: new Date(row.tMs).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
      heaterW: row.heaterW,
      chargeW: row.chargeW,
    }));
}

function finitePower(value: number | null): number | null {
  const finite = finiteNumber(value);
  return finite != null ? Math.max(0, finite) : null;
}

function finiteNumber(value: number | null): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}

/** Disclose uncertainty on the original phase; do not resegment or drop it. */
export function phaseHasMissingHeater(phase: ThermalPhase, samples: readonly ThermalTaxSample[]) {
  return samples.some(sample => {
    const timestamp = new Date(sample.ts).getTime();
    return timestamp >= phase.startMs && timestamp <= phase.endMs
      && (sample.battery_heater_power_w == null || !Number.isFinite(sample.battery_heater_power_w));
  });
}
