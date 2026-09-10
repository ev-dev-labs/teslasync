/**
 * Supercharger bill vs pack truth — pure, React-free.
 *
 * Tesla invoices meter energy at the cabinet. Vehicle telemetry is energy
 * into the pack (often a few percent lower). The remainder of the invoice
 * versus energy × rate is idle / congestion / tax — never invented as pack kWh.
 */

export type ChargeBillHonesty = 'live' | 'stale' | 'guessed' | 'missing';

export type ChargeBillReasonId =
  | 'no_invoice'
  | 'cabinet_vs_pack'
  | 'pack_exceeds_bill'
  | 'idle_or_tax'
  | 'fee_type_idle'
  | 'ac_session';

export interface ChargeBillTruthInput {
  chargerType?: string | null;
  measuredEnergyWh?: number | null;
  measuredCost?: number | null;
  billedEnergyWh?: number | null;
  billedCost?: number | null;
  billedRatePerKwh?: number | null;
  billedCurrency?: string | null;
  billedSource?: string | null;
  billedSite?: string | null;
  billedFeeType?: string | null;
}

export interface ChargeBillTruth {
  hasInvoice: boolean;
  dcSession: boolean;
  measuredEnergyWh: number | null;
  billedEnergyWh: number | null;
  energyDeltaWh: number | null;
  energyDeltaPct: number | null;
  measuredCost: number | null;
  billedCost: number | null;
  impliedEnergyCost: number | null;
  unexplainedCost: number | null;
  currency: string | null;
  site: string | null;
  feeType: string | null;
  source: string | null;
  reasons: ChargeBillReasonId[];
  honesty: ChargeBillHonesty;
}

const ENERGY_PCT_FLOOR = 0.5;
const COST_FLOOR = 0.05;

function finite(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonempty(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function isDcCharger(chargerType: string | null | undefined): boolean {
  const ft = chargerType?.toLowerCase() ?? '';
  return ft !== '' && ft !== '<invalid>' && ft !== 'unknown' && ft !== 'ac';
}

export function deriveChargeBillTruth(input: ChargeBillTruthInput): ChargeBillTruth {
  const measuredEnergyWh = finite(input.measuredEnergyWh);
  const billedEnergyWh = finite(input.billedEnergyWh);
  const measuredCost = finite(input.measuredCost);
  const billedCost = finite(input.billedCost);
  const rate = finite(input.billedRatePerKwh);
  const dcSession = isDcCharger(input.chargerType);
  const hasInvoice = billedEnergyWh != null || billedCost != null;
  const feeType = nonempty(input.billedFeeType);
  const site = nonempty(input.billedSite);
  const source = nonempty(input.billedSource);
  const currency = nonempty(input.billedCurrency);

  let energyDeltaWh: number | null = null;
  let energyDeltaPct: number | null = null;
  if (billedEnergyWh != null && measuredEnergyWh != null) {
    energyDeltaWh = billedEnergyWh - measuredEnergyWh;
    if (billedEnergyWh > 0) {
      energyDeltaPct = (energyDeltaWh / billedEnergyWh) * 100;
    }
  }

  const impliedEnergyCost =
    billedEnergyWh != null && rate != null ? (billedEnergyWh / 1000) * rate : null;
  const unexplainedCost =
    billedCost != null && impliedEnergyCost != null ? billedCost - impliedEnergyCost : null;

  const reasons: ChargeBillReasonId[] = [];
  if (!dcSession) reasons.push('ac_session');
  if (!hasInvoice) {
    reasons.push('no_invoice');
  } else {
    if (energyDeltaPct != null && energyDeltaPct >= ENERGY_PCT_FLOOR) {
      reasons.push('cabinet_vs_pack');
    }
    if (energyDeltaPct != null && energyDeltaPct <= -ENERGY_PCT_FLOOR) {
      reasons.push('pack_exceeds_bill');
    }
    if (unexplainedCost != null && unexplainedCost >= COST_FLOOR) {
      reasons.push('idle_or_tax');
    }
    if (feeType && /idle|congestion|tax/i.test(feeType)) {
      reasons.push('fee_type_idle');
    }
  }

  let honesty: ChargeBillHonesty = 'missing';
  if (hasInvoice && reasons.includes('idle_or_tax')) {
    honesty = 'guessed';
  } else if (hasInvoice) {
    honesty = 'live';
  }

  return {
    hasInvoice,
    dcSession,
    measuredEnergyWh,
    billedEnergyWh,
    energyDeltaWh,
    energyDeltaPct,
    measuredCost,
    billedCost,
    impliedEnergyCost,
    unexplainedCost,
    currency,
    site,
    feeType,
    source,
    reasons,
    honesty,
  };
}
