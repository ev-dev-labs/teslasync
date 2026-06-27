/**
 * Native parity port of
 * web/src/features/vehicles/components/vehicle-detail/helpers.ts.
 *
 * Pure TypeScript utility / type logic with no runtime DOM, browser, React,
 * Recharts, Leaflet, or web-UI dependency — every export is platform-agnostic
 * and is ported faithfully so it is fully React Native compatible. These helpers
 * back the vehicle-detail panels: a `StateResponse` shape, a battery-SoC color
 * ramp, the canonical Pascal tire-pressure thresholds + Pa→kPa converter +
 * pressure→variant mapper, and a minutes→"Hh Mm" duration formatter.
 *
 * Platform dependency swaps (each documented in the parity sidecar):
 *   * `import type { VehicleState } from '@/api/types'` -> the already-ported
 *     native `../../../../api/types` (type-only import; identical shape).
 *   * `export { deriveVehicleStatus as deriveStatus, statusVariant } from
 *     '@/api/types'` -> re-exported verbatim from the native
 *     `../../../../api/types`, which already exports both symbols, preserving the
 *     web file's exact public surface (incl. the `deriveStatus` alias).
 *   * `import { fmtInt } from '@/lib/numberFormat'` -> the native web-parity tree
 *     ships no numberFormat module, so — following the established sibling
 *     convention (QuickStatsGrid/BatteryRangePanel inline the numberFormat
 *     helpers they need) — `safeNumber` + `fmtInt` are inlined here
 *     field-for-field. Web `fmtInt(v)` === `fmtNumber(v, 0)` ===
 *     `safeNumber(v).toLocaleString(locale, {min/maxFractionDigits: 0})` with an
 *     en-US fallback on a bad locale tag. numberFormat's module-default locale is
 *     'en-US' (mutated by useSettings at runtime); `durationStr` only ever formats
 *     `minutes % 60` (0-59), where no locale yields grouping separators, so the
 *     integer rendering is identical to the web for every reachable input.
 */

import type {VehicleState} from '../../../../api/types';

export {
  deriveVehicleStatus as deriveStatus,
  statusVariant,
} from '../../../../api/types';

export interface StateResponse {
  state: VehicleState;
  live: boolean;
}

export function batteryColor(level: number): string {
  if (level > 60) return '#10b981';
  if (level > 25) return '#f59e0b';
  return '#ef4444';
}

// --- Inlined mirror of web @/lib/numberFormat (no native module) ------------

// Mirror of web @/lib/numberFormat `safeNumber`: 0 for nullish / NaN / Infinity.
function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

// Mirror of web @/lib/numberFormat `fmtInt` === `fmtNumber(v, 0)`: a
// locale-grouped integer (zero fraction digits). numberFormat's module-default
// global locale is 'en-US'; the web `fmtNumber` try/catch only guards a
// user-supplied locale tag, so with this hardcoded-valid constant the call can
// never throw and the defensive branch is intentionally elided.
function fmtInt(v: unknown): string {
  return safeNumber(v).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

/**
 * Backend tire-pressure SI baseline is Pascals
 * (UnitKindPressure ToSI). All comparisons live in Pa to keep one
 * canonical source of truth shared by `TirePressurePanel` and
 * `TirePressureSection`. Display conversion to kPa (frontend SI floor)
 * and then to the user's pressure preference happens at the renderer.
 */
export const TIRE_PRESSURE_PA = Object.freeze({
  /** Below this is critical-low (≈ 30.0 psi / 2.068 bar). */
  LOW_CRITICAL: 206_800,
  /** Below this is warning-low (≈ 35.0 psi / 2.413 bar). */
  LOW_WARNING: 241_300,
  /** Above this is warning-high (≈ 45.0 psi / 3.103 bar). */
  HIGH_WARNING: 310_300,
  /** Above this is critical-high (≈ 50.0 psi / 3.447 bar). */
  HIGH_CRITICAL: 344_700,
} as const);

/** 1 kPa = 1000 Pa. Frontend `formatPressure` expects kPa input. */
export function paToKpa(pa: number | null | undefined): number | null {
  if (pa == null || !Number.isFinite(pa)) return null;
  return pa / 1000;
}

/**
 * Map a backend SI pressure value (Pa) to a tire-pressure UI variant.
 * Returns 'neutral' for unknown values, 'success' inside the safe band,
 * 'warning' inside the soft band, and 'danger' outside the critical band.
 */
export function tirePressureVariant(
  pa: number | null | undefined,
): 'success' | 'warning' | 'danger' | 'neutral' {
  if (pa == null || !Number.isFinite(pa)) return 'neutral';
  if (pa < TIRE_PRESSURE_PA.LOW_CRITICAL || pa > TIRE_PRESSURE_PA.HIGH_CRITICAL)
    return 'danger';
  if (pa < TIRE_PRESSURE_PA.LOW_WARNING || pa > TIRE_PRESSURE_PA.HIGH_WARNING)
    return 'warning';
  return 'success';
}

export function durationStr(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = fmtInt(minutes % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
