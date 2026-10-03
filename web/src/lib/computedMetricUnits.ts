import {
  convertDistanceFromSI, convertDistanceToSI,
  convertSpeedToSI, convertEnergyFromSI, convertPowerFromSI,
  convertEfficiencyFromSI, convertDurationFromSI,
} from './unitConversion'
import type { UnitKind } from './unitInput'

interface MetricInputUnit {
  kind: UnitKind
  /** The computed registry still exposes legacy units; this bridge is display-only. */
  canonicalFactor: number
}

const METRIC_INPUT_UNITS: Readonly<Record<string, MetricInputUnit>> = {
  mi: { kind: 'distance', canonicalFactor: convertDistanceToSI(1, 'mi') },
  km: { kind: 'distance', canonicalFactor: convertDistanceToSI(1, 'km') },
  mph: { kind: 'speed', canonicalFactor: convertSpeedToSI(1, 'mph') },
  kwh: { kind: 'energy', canonicalFactor: 1 / convertEnergyFromSI(1, 'kWh') },
  kw: { kind: 'power', canonicalFactor: 1 / convertPowerFromSI(1, 'kW') },
  wh_per_mi: { kind: 'efficiency', canonicalFactor: 1 / convertEfficiencyFromSI(1, 'mi') },
  currency_per_mi: { kind: 'currencyPerDistance', canonicalFactor: convertDistanceFromSI(1, 'mi') },
  h: { kind: 'hours', canonicalFactor: 1 / convertDurationFromSI(1, 'h') },
  currency: { kind: 'currency', canonicalFactor: 1 },
  count: { kind: 'count', canonicalFactor: 1 },
  pp: { kind: 'percentagePoints', canonicalFactor: 1 },
  '%': { kind: 'percent', canonicalFactor: 1 },
}

export function computedMetricInputUnit(unit: string | undefined): MetricInputUnit {
  return METRIC_INPUT_UNITS[unit ?? ''] ?? { kind: 'number', canonicalFactor: 1 }
}
