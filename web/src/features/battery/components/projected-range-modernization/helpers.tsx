import type { ReactNode } from 'react';
import { Car, Shield, Snowflake, Zap } from 'lucide-react';
import type { EfficiencyBucket, RangeScenario } from '@/api/hooks/useAnalytics';
import { severityTokens } from '@/lib/tokens';

/** Retained public helper for existing consumers; production cells use semantic tones. */
export function effColor(whKm: number): string {
  if (whKm <= 155) return 'bg-neon-green';
  if (whKm <= 180) return 'bg-emerald-500';
  if (whKm <= 210) return 'bg-neon-amber';
  return 'bg-red-500';
}

export function matrixTone(whKm: number): string {
  if (whKm <= 155) return severityTokens.success.bg;
  if (whKm <= 180) return severityTokens.info.bg;
  if (whKm <= 210) return severityTokens.warn.bg;
  return severityTokens.critical.bg;
}

export function scenarioIcon(scenario: RangeScenario): ReactNode {
  if ((scenario.extras ?? []).includes('sentry')) return <Shield className="h-4 w-4" aria-hidden="true" />;
  if ((scenario.temp_c ?? 0) < 0) return <Snowflake className="h-4 w-4" aria-hidden="true" />;
  if ((scenario.speed_kmh ?? 0) > 90) return <Car className="h-4 w-4" aria-hidden="true" />;
  return <Zap className="h-4 w-4" aria-hidden="true" />;
}

export function interpolateRange(
  matrix: EfficiencyBucket[], speedKmh: number, tempC: number,
  batteryPct: number, capacityWh: number,
): { effWhKm: number; rangeKm: number } {
  const tempBucket = tempC < 0 ? 'freezing' : tempC < 10 ? 'cold' : tempC < 25 ? 'mild' : 'hot';
  const speedBucket = speedKmh < 50 ? 'city' : speedKmh < 90 ? 'suburban' : 'highway';
  const match = matrix.find(bucket => bucket.temp_bucket === tempBucket && bucket.speed_bucket === speedBucket);
  let eff = match?.wh_km ?? (155 + (speedKmh - 35) * 0.5 + Math.max(0, 20 - tempC) * 1.5);
  if (!Number.isFinite(eff) || eff <= 0) eff = 170;
  const safePct = Number.isFinite(batteryPct) ? Math.min(Math.max(batteryPct, 0), 100) : 0;
  const safeCapacity = Number.isFinite(capacityWh) && capacityWh > 0 ? capacityWh : 0;
  const rangeKm = (safeCapacity * (safePct / 100)) / eff;
  return {
    effWhKm: Math.round(eff * 10) / 10,
    rangeKm: Math.round(Math.max(rangeKm, 0) * 10) / 10,
  };
}
