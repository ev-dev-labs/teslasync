/**
 * Battery Care model — grades charging habits against pack-longevity
 * guidance: avoid living at 100%, avoid deep discharges, keep DC fast
 * charging occasional, and spend most time inside the 20–80% band.
 *
 * Inputs are the existing `ChargingSession` records plus drives (for
 * discharge floors). Pure and React-free.
 */

import type { ChargingSession } from '@/types/charging';
import type { Drive } from '@/types/driving';

export interface CareBreakdown {
  /** Sessions charged to ≥ this threshold count as "full charges". */
  fullChargePct: number;
  /** Share of sessions ending ≥ fullChargePct, 0–1. */
  fullChargeShare: number | null;
  /** Share of drives arriving < 10%, 0–1. */
  deepDischargeShare: number | null;
  /** Share of charging ENERGY delivered by DC fast charging, 0–1. */
  dcEnergyShare: number | null;
  /** Share of session-end SoCs landing inside 20–80%, 0–1. */
  bandFinishShare: number | null;
  sessionsAnalyzed: number;
  drivesAnalyzed: number;
}

export interface CareScore extends CareBreakdown {
  /**
   * 0–100 composite. Starts at 100 and pays for each habit:
   *   −30 × full-charge share, −30 × deep-discharge share,
   *   −20 × DC energy share, −20 × (1 − band-finish share).
   * Null until at least 5 sessions AND 5 drives exist.
   */
  score: number | null;
}

/** True for DC fast charging (Supercharger / CCS) session types. */
export function isDcSession(chargerType: string | null): boolean {
  if (!chargerType) return false;
  const t = chargerType.toLowerCase();
  return t.includes('dc') || t.includes('super') || t.includes('fast') || t.includes('ccs');
}

function share(hits: number, total: number): number | null {
  return total > 0 ? hits / total : null;
}

export function computeBatteryCare(
  sessions: readonly ChargingSession[],
  drives: readonly Drive[],
  fullChargePct = 95,
): CareScore {
  const withEnd = sessions.filter(
    (s) => s.end_soc_pct != null && Number.isFinite(s.end_soc_pct),
  );
  const fullCharges = withEnd.filter((s) => s.end_soc_pct! >= fullChargePct).length;
  const bandFinishes = withEnd.filter(
    (s) => s.end_soc_pct! >= 20 && s.end_soc_pct! <= 80,
  ).length;

  let dcWh = 0;
  let totalWh = 0;
  for (const s of sessions) {
    const wh = Number.isFinite(s.total_energy_added_wh) ? Math.max(0, s.total_energy_added_wh) : 0;
    totalWh += wh;
    if (isDcSession(s.charger_type)) dcWh += wh;
  }

  const arrivals = drives.filter(
    (d) => d.endBatteryPct != null && Number.isFinite(d.endBatteryPct),
  );
  const deep = arrivals.filter((d) => d.endBatteryPct! < 10).length;

  const breakdown: CareBreakdown = {
    fullChargePct,
    fullChargeShare: share(fullCharges, withEnd.length),
    deepDischargeShare: share(deep, arrivals.length),
    dcEnergyShare: totalWh > 0 ? dcWh / totalWh : null,
    bandFinishShare: share(bandFinishes, withEnd.length),
    sessionsAnalyzed: withEnd.length,
    drivesAnalyzed: arrivals.length,
  };

  let score: number | null = null;
  if (withEnd.length >= 5 && arrivals.length >= 5) {
    const s =
      100 -
      30 * (breakdown.fullChargeShare ?? 0) -
      30 * (breakdown.deepDischargeShare ?? 0) -
      20 * (breakdown.dcEnergyShare ?? 0) -
      20 * (1 - (breakdown.bandFinishShare ?? 0));
    score = Math.round(Math.min(100, Math.max(0, s)));
  }

  return { ...breakdown, score };
}
