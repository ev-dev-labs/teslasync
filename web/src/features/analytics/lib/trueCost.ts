/**
 * Pure lifetime operating-cost evidence model.
 *
 * The endpoint is a legacy aggregate whose distance field is canonical
 * kilometres and whose energy fields are watt-hours. This model keeps those
 * source units unchanged. Display conversion belongs at the React boundary.
 */

export type TcoAvailability = 'missing' | 'invalid' | 'valid';
export type TcoDisposition = 'savings' | 'loss' | 'balanced' | 'unavailable';
export type TcoMonthlyDisposition =
  | 'invalid_row'
  | 'invalid_month'
  | 'duplicate_month'
  | 'eligible';
export type TcoIdentityStatus =
  | 'balances'
  | 'outside_tolerance'
  | 'unavailable';

export interface TcoMetric {
  value: number | null;
  availability: TcoAvailability;
}

export interface TcoDateMetric {
  value: string | null;
  availability: TcoAvailability;
}

export interface TcoTopLevelMetrics {
  vehicleId: TcoMetric;
  totalChargingCost: TcoMetric;
  totalWh: TcoMetric;
  totalSessions: TcoMetric;
  totalKm: TcoMetric;
  monthsOfDriveSpan: TcoMetric;
  costPerKmEv: TcoMetric;
  costPerKmIce: TcoMetric;
  equivalentGasCost: TcoMetric;
  totalFuelDelta: TcoMetric;
  monthlyFuelDelta: TcoMetric;
  maintenanceHeuristic: TcoMetric;
  gasPrice: TcoMetric;
  gasEfficiencyMpg: TcoMetric;
  baseCostPerKwh: TcoMetric;
  firstDate: TcoDateMetric;
  lastDate: TcoDateMetric;
}

export interface TcoMonthlyFields {
  evCost: TcoMetric;
  gasCost: TcoMetric;
  energyWh: TcoMetric;
  apiSavings: TcoMetric;
  apiCumulative: TcoMetric;
}

export interface TcoMonthlyDirectoryRow extends TcoMonthlyFields {
  sourceIndex: number;
  month: string | null;
  disposition: TcoMonthlyDisposition;
  derivedFuelDelta: number | null;
  derivedCumulativeDelta: number | null;
}

export interface TcoMonthlyAccounting {
  arrayAvailability: TcoAvailability;
  returnedRows: number;
  invalidRowRows: number;
  invalidMonthRows: number;
  duplicateMonthRows: number;
  eligibleRows: number;
  evCostSupportRows: number;
  gasCostSupportRows: number;
  energySupportRows: number;
  apiSavingsSupportRows: number;
  apiCumulativeSupportRows: number;
}

export interface TcoDriveSpan {
  available: boolean;
  firstDate: string | null;
  lastDate: string | null;
  spanDays: number | null;
  totalKm: number | null;
}

export interface TcoEvidenceGates {
  recordedSpend: boolean;
  recordedEnergy: boolean;
  costedSessions: boolean;
  positiveDistance: boolean;
  fuelComparison: boolean;
  monthlyComparison: boolean;
  maintenanceHeuristic: boolean;
  scenarioAnalysis: boolean;
  monthlyFuelRate: boolean;
}

export interface TcoBreakEven {
  gasPricePerConfiguredUnit: number | null;
  comparisonMpg: number | null;
}

export interface TcoSensitivityRow {
  priceFactor: 0.8 | 1 | 1.2;
  mpgFactor: 0.8 | 1 | 1.2;
  modeledGasCost: number;
  fuelDelta: number;
  disposition: Exclude<TcoDisposition, 'unavailable'>;
}

export interface TcoIdentity {
  id: string;
  expected: number | null;
  observed: number | null;
  residual: number | null;
  tolerance: number;
  unit: 'currency' | 'Wh' | 'currency_per_km';
  status: TcoIdentityStatus;
}

export interface TrueCostAnalysis {
  payloadAvailability: TcoAvailability;
  metrics: TcoTopLevelMetrics;
  monthly: readonly TcoMonthlyDirectoryRow[];
  eligibleMonthly: readonly TcoMonthlyDirectoryRow[];
  monthlyAccounting: TcoMonthlyAccounting;
  derivedMonthlyFuelDelta: number | null;
  gapCount: number | null;
  driveSpan: TcoDriveSpan;
  zeroEnvelope: boolean;
  gates: TcoEvidenceGates;
  fuelDisposition: TcoDisposition;
  combinedDisposition: TcoDisposition;
  combinedFuelAndMaintenance: number | null;
  breakEven: TcoBreakEven;
  sensitivity: readonly TcoSensitivityRow[];
  identities: readonly TcoIdentity[];
}

type UnknownRecord = Record<string, unknown>;
type Validator = (value: number) => boolean;

const PRICE_FACTORS = [0.8, 1, 1.2] as const;
const MPG_FACTORS = [0.8, 1, 1.2] as const;
const CURRENCY_TOLERANCE = 0.02;
const PER_KM_TOLERANCE = 0.0002;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function metric(
  record: UnknownRecord | null,
  key: string,
  validator: Validator,
): TcoMetric {
  if (!record || !(key in record) || record[key] == null) {
    return { value: null, availability: 'missing' };
  }
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || !validator(value)) {
    return { value: null, availability: 'invalid' };
  }
  return { value, availability: 'valid' };
}

const finite: Validator = () => true;
const nonnegative: Validator = (value) => value >= 0;
const positive: Validator = (value) => value > 0;
const nonnegativeInteger: Validator = (value) =>
  value >= 0 && Number.isInteger(value);
const positiveInteger: Validator = (value) =>
  value > 0 && Number.isInteger(value);

function validDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function dateMetric(record: UnknownRecord | null, key: string): TcoDateMetric {
  if (!record || !(key in record) || record[key] == null || record[key] === '') {
    return { value: null, availability: 'missing' };
  }
  return validDate(record[key])
    ? { value: record[key], availability: 'valid' }
    : { value: null, availability: 'invalid' };
}

function validMonth(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function monthOrdinal(month: string): number {
  return Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
}

function monthlyFields(row: UnknownRecord | null): TcoMonthlyFields {
  return {
    evCost: metric(row, 'ev_cost', nonnegative),
    gasCost: metric(row, 'equiv_gas_cost', nonnegative),
    energyWh: metric(row, 'energy_wh', nonnegative),
    apiSavings: metric(row, 'savings', finite),
    apiCumulative: metric(row, 'cumulative_savings', finite),
  };
}

function emptyFields(): TcoMonthlyFields {
  return monthlyFields(null);
}

function disposition(value: number | null): TcoDisposition {
  if (value == null) return 'unavailable';
  if (Math.abs(value) <= CURRENCY_TOLERANCE) return 'balanced';
  return value > 0 ? 'savings' : 'loss';
}

function identity(
  id: string,
  expected: number | null,
  observed: number | null,
  tolerance: number,
  unit: TcoIdentity['unit'],
): TcoIdentity {
  if (expected == null || observed == null) {
    return {
      id,
      expected,
      observed,
      residual: null,
      tolerance,
      unit,
      status: 'unavailable',
    };
  }
  const residual = observed - expected;
  return {
    id,
    expected,
    observed,
    residual,
    tolerance,
    unit,
    status: Math.abs(residual) <= tolerance
      ? 'balances'
      : 'outside_tolerance',
  };
}

function sumSupported(
  rows: readonly TcoMonthlyDirectoryRow[],
  field: keyof TcoMonthlyFields,
): number | null {
  const values = rows
    .map((row) => row[field].value)
    .filter((value): value is number => value != null);
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0)
    : null;
}

function allRowsSupport(
  rows: readonly TcoMonthlyDirectoryRow[],
  field: keyof TcoMonthlyFields,
  accounting: TcoMonthlyAccounting,
): boolean {
  return rows.length > 0
    && accounting.invalidRowRows === 0
    && accounting.invalidMonthRows === 0
    && accounting.duplicateMonthRows === 0
    && rows.every((row) => row[field].value != null);
}

function analyzeMonthly(value: unknown): {
  rows: TcoMonthlyDirectoryRow[];
  eligible: TcoMonthlyDirectoryRow[];
  accounting: TcoMonthlyAccounting;
  gapCount: number | null;
  derivedTotal: number | null;
} {
  const source = Array.isArray(value) ? value : [];
  const arrayAvailability: TcoAvailability = value == null
    ? 'missing'
    : Array.isArray(value)
      ? 'valid'
      : 'invalid';
  const seenMonths = new Set<string>();
  const rows: TcoMonthlyDirectoryRow[] = [];

  source.forEach((candidate, sourceIndex) => {
    if (!isRecord(candidate)) {
      rows.push({
        sourceIndex,
        month: null,
        disposition: 'invalid_row',
        ...emptyFields(),
        derivedFuelDelta: null,
        derivedCumulativeDelta: null,
      });
      return;
    }
    const fields = monthlyFields(candidate);
    const month = validMonth(candidate.month) ? candidate.month : null;
    const terminalDisposition: TcoMonthlyDisposition = month == null
      ? 'invalid_month'
      : seenMonths.has(month)
        ? 'duplicate_month'
        : 'eligible';
    if (month != null) seenMonths.add(month);
    rows.push({
      sourceIndex,
      month,
      disposition: terminalDisposition,
      ...fields,
      derivedFuelDelta:
        fields.evCost.value != null && fields.gasCost.value != null
          ? fields.gasCost.value - fields.evCost.value
          : null,
      derivedCumulativeDelta: null,
    });
  });

  const sortedEligible = rows
    .filter((row) => row.disposition === 'eligible' && row.month != null)
    .sort((left, right) => (left.month ?? '').localeCompare(right.month ?? ''));
  let cumulative = 0;
  let deltaSupport = 0;
  const eligible = sortedEligible.map((row) => {
    if (row.derivedFuelDelta == null) return { ...row };
    cumulative += row.derivedFuelDelta;
    deltaSupport += 1;
    return { ...row, derivedCumulativeDelta: cumulative };
  });
  const eligibleBySource = new Map(
    eligible.map((row) => [row.sourceIndex, row]),
  );
  const directory = rows.map((row) => eligibleBySource.get(row.sourceIndex) ?? row);
  const first = eligible[0]?.month ?? null;
  const last = eligible[eligible.length - 1]?.month ?? null;
  const gapCount = first && last
    ? Math.max(0, monthOrdinal(last) - monthOrdinal(first) + 1 - eligible.length)
    : null;

  return {
    rows: directory,
    eligible,
    accounting: {
      arrayAvailability,
      returnedRows: source.length,
      invalidRowRows: rows.filter((row) => row.disposition === 'invalid_row').length,
      invalidMonthRows: rows.filter((row) => row.disposition === 'invalid_month').length,
      duplicateMonthRows: rows.filter((row) => row.disposition === 'duplicate_month').length,
      eligibleRows: eligible.length,
      evCostSupportRows: eligible.filter((row) => row.evCost.value != null).length,
      gasCostSupportRows: eligible.filter((row) => row.gasCost.value != null).length,
      energySupportRows: eligible.filter((row) => row.energyWh.value != null).length,
      apiSavingsSupportRows: eligible.filter((row) => row.apiSavings.value != null).length,
      apiCumulativeSupportRows: eligible.filter((row) => row.apiCumulative.value != null).length,
    },
    gapCount,
    derivedTotal: deltaSupport > 0 ? cumulative : null,
  };
}

function driveSpan(metrics: TcoTopLevelMetrics): TcoDriveSpan {
  const first = metrics.firstDate.value;
  const last = metrics.lastDate.value;
  const km = metrics.totalKm.value;
  if (!first || !last || km == null || km <= 0 || first > last) {
    return {
      available: false,
      firstDate: first,
      lastDate: last,
      spanDays: null,
      totalKm: km,
    };
  }
  return {
    available: true,
    firstDate: first,
    lastDate: last,
    spanDays:
      (Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`))
      / 86_400_000,
    totalKm: km,
  };
}

function buildIdentities(
  metrics: TcoTopLevelMetrics,
  eligible: readonly TcoMonthlyDirectoryRow[],
  accounting: TcoMonthlyAccounting,
  derivedMonthlyFuelDelta: number | null,
  maintenanceSupported: boolean,
): TcoIdentity[] {
  const ev = metrics.totalChargingCost.value;
  const gas = metrics.equivalentGasCost.value;
  const km = metrics.totalKm.value;
  const months = metrics.monthsOfDriveSpan.value;
  const monthlyTolerance = CURRENCY_TOLERANCE * (eligible.length + 1);
  const finalRow = eligible[eligible.length - 1];

  return [
    identity(
      'fuel_total',
      gas != null && ev != null ? gas - ev : null,
      metrics.totalFuelDelta.value,
      CURRENCY_TOLERANCE,
      'currency',
    ),
    identity(
      'maintenance_heuristic',
      maintenanceSupported && months != null ? months * 50 : null,
      maintenanceSupported ? metrics.maintenanceHeuristic.value : null,
      2.51,
      'currency',
    ),
    identity(
      'monthly_ev_total',
      metrics.totalChargingCost.value,
      allRowsSupport(eligible, 'evCost', accounting)
        ? sumSupported(eligible, 'evCost')
        : null,
      monthlyTolerance,
      'currency',
    ),
    identity(
      'monthly_energy_total',
      metrics.totalWh.value,
      allRowsSupport(eligible, 'energyWh', accounting)
        ? sumSupported(eligible, 'energyWh')
        : null,
      CURRENCY_TOLERANCE * (eligible.length + 1),
      'Wh',
    ),
    identity(
      'monthly_gas_total',
      metrics.equivalentGasCost.value,
      allRowsSupport(eligible, 'gasCost', accounting)
        ? sumSupported(eligible, 'gasCost')
        : null,
      monthlyTolerance,
      'currency',
    ),
    identity(
      'monthly_final_cumulative',
      derivedMonthlyFuelDelta,
      finalRow?.apiCumulative.value ?? null,
      monthlyTolerance,
      'currency',
    ),
    identity(
      'cost_per_km_ev',
      ev != null && km != null && km > 0 ? ev / km : null,
      metrics.costPerKmEv.value,
      PER_KM_TOLERANCE,
      'currency_per_km',
    ),
    identity(
      'cost_per_km_ice',
      gas != null && km != null && km > 0 ? gas / km : null,
      metrics.costPerKmIce.value,
      PER_KM_TOLERANCE,
      'currency_per_km',
    ),
  ];
}

/** Analyze one untrusted GET /analytics/tco response without mutating it. */
export function analyzeTrueCost(input: unknown): TrueCostAnalysis {
  const record = isRecord(input) ? input : null;
  const payloadAvailability: TcoAvailability = input == null
    ? 'missing'
    : record
      ? 'valid'
      : 'invalid';
  const metrics: TcoTopLevelMetrics = {
    vehicleId: metric(record, 'vehicle_id', positiveInteger),
    totalChargingCost: metric(record, 'total_charging_cost', nonnegative),
    totalWh: metric(record, 'total_wh', nonnegative),
    totalSessions: metric(record, 'total_sessions', nonnegativeInteger),
    totalKm: metric(record, 'total_km', nonnegative),
    monthsOfDriveSpan: metric(record, 'months_of_ownership', positive),
    costPerKmEv: metric(record, 'cost_per_km_ev', nonnegative),
    costPerKmIce: metric(record, 'cost_per_km_ice', nonnegative),
    equivalentGasCost: metric(record, 'equivalent_gas_cost', nonnegative),
    totalFuelDelta: metric(record, 'total_savings', finite),
    monthlyFuelDelta: metric(record, 'monthly_savings', finite),
    maintenanceHeuristic: metric(
      record,
      'maintenance_savings_estimate',
      nonnegative,
    ),
    gasPrice: metric(record, 'gas_price', positive),
    gasEfficiencyMpg: metric(record, 'gas_efficiency_mpg', positive),
    baseCostPerKwh: metric(record, 'base_cost_per_kwh', positive),
    firstDate: dateMetric(record, 'first_date'),
    lastDate: dateMetric(record, 'last_date'),
  };
  const monthly = analyzeMonthly(record?.monthly_breakdown);
  const span = driveSpan(metrics);
  const hasValidMonthlyEvidence = monthly.eligible.some((row) =>
    row.evCost.value != null
    || row.gasCost.value != null
    || row.energyWh.value != null
    || row.apiSavings.value != null
    || row.apiCumulative.value != null);
  const zeroEnvelope = metrics.totalSessions.value === 0
    && metrics.totalKm.value === 0
    && !hasValidMonthlyEvidence;
  const costedSessions = (metrics.totalSessions.value ?? 0) > 0;
  const positiveDistance = (metrics.totalKm.value ?? 0) > 0;
  const fuelComparison = costedSessions
    && positiveDistance
    && metrics.totalChargingCost.value != null
    && metrics.equivalentGasCost.value != null
    && metrics.totalFuelDelta.value != null;
  const monthlyComparison = monthly.eligible.some((row) =>
    row.evCost.value != null && row.gasCost.value != null);
  const maintenanceHeuristic = !zeroEnvelope
    && positiveDistance
    && span.available
    && metrics.monthsOfDriveSpan.value != null
    && metrics.maintenanceHeuristic.value != null;
  const scenarioAnalysis = fuelComparison
    && metrics.gasPrice.value != null
    && metrics.gasEfficiencyMpg.value != null
    && metrics.equivalentGasCost.value != null
    && metrics.equivalentGasCost.value > 0;
  const gates: TcoEvidenceGates = {
    recordedSpend: costedSessions && metrics.totalChargingCost.value != null,
    recordedEnergy: costedSessions && metrics.totalWh.value != null,
    costedSessions,
    positiveDistance,
    fuelComparison,
    monthlyComparison,
    maintenanceHeuristic,
    scenarioAnalysis,
    monthlyFuelRate: fuelComparison && metrics.monthlyFuelDelta.value != null,
  };

  const ev = metrics.totalChargingCost.value;
  const gas = metrics.equivalentGasCost.value;
  const price = metrics.gasPrice.value;
  const mpg = metrics.gasEfficiencyMpg.value;
  const breakEven: TcoBreakEven = {
    gasPricePerConfiguredUnit:
      scenarioAnalysis && ev != null && gas != null && price != null
        ? price * (ev / gas)
        : null,
    comparisonMpg:
      scenarioAnalysis && ev != null && ev > 0 && gas != null && mpg != null
        ? mpg * (gas / ev)
        : null,
  };
  const sensitivity: TcoSensitivityRow[] =
    scenarioAnalysis && gas != null && ev != null
      ? PRICE_FACTORS.flatMap((priceFactor) =>
        MPG_FACTORS.map((mpgFactor) => {
          const modeledGasCost = gas * (priceFactor / mpgFactor);
          const fuelDelta = modeledGasCost - ev;
          return {
            priceFactor,
            mpgFactor,
            modeledGasCost,
            fuelDelta,
            disposition: disposition(fuelDelta) as Exclude<
              TcoDisposition,
              'unavailable'
            >,
          };
        }))
      : [];
  const combinedFuelAndMaintenance =
    fuelComparison
    && maintenanceHeuristic
    && metrics.totalFuelDelta.value != null
    && metrics.maintenanceHeuristic.value != null
      ? metrics.totalFuelDelta.value + metrics.maintenanceHeuristic.value
      : null;

  return {
    payloadAvailability,
    metrics,
    monthly: monthly.rows,
    eligibleMonthly: monthly.eligible,
    monthlyAccounting: monthly.accounting,
    derivedMonthlyFuelDelta: monthly.derivedTotal,
    gapCount: monthly.gapCount,
    driveSpan: span,
    zeroEnvelope,
    gates,
    fuelDisposition: disposition(
      fuelComparison ? metrics.totalFuelDelta.value : null,
    ),
    combinedDisposition: disposition(combinedFuelAndMaintenance),
    combinedFuelAndMaintenance,
    breakEven,
    sensitivity,
    identities: buildIdentities(
      metrics,
      monthly.eligible,
      monthly.accounting,
      monthly.derivedTotal,
      maintenanceHeuristic,
    ),
  };
}
