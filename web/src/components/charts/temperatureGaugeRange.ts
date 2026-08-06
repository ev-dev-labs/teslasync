/**
 * @module components/charts/temperatureGaugeRange
 *
 * Correct gauge bounds for temperature readings.
 *
 * Temperature is an **interval** scale: °C and °F have different origins, so
 * `value / max` is not preserved across a unit conversion. Feeding a gauge a
 * converted reading against a fixed (or even converted) `max` while the
 * implicit floor stays at zero therefore produces a different arc for the same
 * physical temperature depending on the user's unit preference:
 *
 *   20 °C on a 0→50 °C ring  = 40.0%
 *   68 °F on a 0→122 °F ring = 55.7%   ← same temperature, different arc
 *
 * The offset only cancels when **both** ends are converted and the gauge
 * measures `(v - min) / (max - min)`, which is what `RadialGauge`'s `min` prop
 * enables. This helper exists so callers cannot convert one end and forget the
 * other — the whole range is produced in one call.
 *
 * It also fixes a second, more visible failure: a 0-floored ring cannot render
 * sub-zero temperatures at all. Every below-freezing outside temperature
 * clamps to an empty ring in °C while the same reading shows a partial arc in
 * °F. Ambient gauges therefore default to a floor below freezing.
 */

/** Floor for ambient / cabin gauges, in °C. Below any realistic cabin reading. */
export const AMBIENT_TEMP_MIN_C = -20;

/** Ceiling for ambient / cabin gauges, in °C. Above any realistic cabin reading. */
export const AMBIENT_TEMP_MAX_C = 50;

export interface TemperatureGaugeRange {
  min: number;
  max: number;
}

/**
 * Builds `{ min, max }` for a temperature `RadialGauge`, both ends converted
 * with the caller's display converter.
 *
 * Spread it directly onto the gauge:
 *
 * ```tsx
 * <RadialGauge
 *   value={toDisplay(motorTempC)}
 *   {...temperatureGaugeRange(toDisplay, { maxC: 150 })}
 * />
 * ```
 *
 * @param toDisplay Converts a °C scalar into the user's display unit.
 * @param minC Floor in °C. Defaults to 0, the right choice for component
 *   temperatures (motor, inverter, battery) which do not run below freezing in
 *   practice. Pass {@link AMBIENT_TEMP_MIN_C} for anything that measures
 *   outside air.
 * @param maxC Ceiling in °C.
 */
export function temperatureGaugeRange(
  toDisplay: (celsius: number) => number,
  { minC = 0, maxC }: { minC?: number; maxC: number },
): TemperatureGaugeRange {
  return { min: toDisplay(minC), max: toDisplay(maxC) };
}

/**
 * {@link temperatureGaugeRange} preset for ambient / cabin readings, which can
 * legitimately be below freezing and would otherwise clamp to an empty ring.
 */
export function ambientTemperatureGaugeRange(
  toDisplay: (celsius: number) => number,
): TemperatureGaugeRange {
  return temperatureGaugeRange(toDisplay, {
    minC: AMBIENT_TEMP_MIN_C,
    maxC: AMBIENT_TEMP_MAX_C,
  });
}
