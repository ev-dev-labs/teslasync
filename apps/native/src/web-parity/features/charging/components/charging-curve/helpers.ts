import type {ChargingSession} from '../../../../api/types';

// ── Inlined CurvePoint type (mirror web ./types CurvePoint) ──────────────
// The sibling ./types module is not a converted native target yet, so the
// single shape consumed by generateChargingCurve is inlined here verbatim.
export interface CurvePoint {
  soc: number;
  power: number;
}

// ── Inlined number helper (mirror web lib/numberFormat.fmtNumber) ────────
// Native has no ported numberFormat module, so this reproduces the web
// toLocaleString(min/maxFractionDigits) formatting with an en-US grouping
// fallback (the global locale/precision settings are not wired natively).
// Nullish / non-finite values coerce to 0, matching web safeNumber.
function safe(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtNumber(v: unknown, decimals = 2): string {
  const n = safe(v);
  try {
    return n.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return n.toFixed(decimals);
  }
}

// ── Inlined date helper (mirror web lib/dateFormat.formatDateShort) ───────
// "Apr 4" in the device locale (web uses the browser locale); nullish or
// unparseable input -> em dash, matching the web fallback.
function formatDateShort(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  const d = new Date(value);
  if (isNaN(d.getTime())) {
    return '—';
  }
  return d.toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
}

export function isDcSession(s: ChargingSession): boolean {
  return !!(s.charger_type || (s.peak_power_w && s.peak_power_w > 20_000));
}

export function getChargerLabel(s: ChargingSession): string {
  if (s.charger_type === 'Tesla' || (s.charger_type ?? '').toLowerCase().includes('tesla'))
    return 'Supercharger';
  if (s.charger_type) return 'DC Fast';
  if (s.peak_power_w && s.peak_power_w > 20_000) return 'DC Fast';
  return 'Home / AC';
}

export function durationMinutes(startedAt: string, endedAt: string | null): number {
  if (!endedAt) return 0;
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.round((end - start) / 60000);
}

export function distanceAddedM(s: ChargingSession): number | null {
  if (s.start_odometer_m == null || s.end_odometer_m == null) return null;
  const delta = s.end_odometer_m - s.start_odometer_m;
  return delta > 0 ? delta : null;
}

export function sessionLabel(s: ChargingSession): string {
  const date = formatDateShort(s.started_at);
  const label = getChargerLabel(s);
  const energy = s.total_energy_added_wh != null ? fmtNumber(s.total_energy_added_wh / 1000, 1) : '?';
  return `${date} — ${label} — ${energy} kWh`;
}

/** Simulate a power-vs-SOC curve based on session metadata. */
export function generateChargingCurve(session: ChargingSession): CurvePoint[] {
  const points: CurvePoint[] = [];
  const startSoc = session.start_soc_pct ?? 0;
  const endSoc = session.end_soc_pct ?? 100;
  const peakPower = (session.peak_power_w ?? 11_000) / 1000;
  const dc = isDcSession(session);

  for (let soc = startSoc; soc <= endSoc; soc += 1) {
    let power: number;
    if (dc) {
      if (soc <= 50) {
        power = peakPower;
      } else if (soc <= 80) {
        const taper = 1 - ((soc - 50) / 30) * 0.5;
        power = peakPower * taper;
      } else {
        const drop = 1 - ((soc - 80) / 20) * 0.7;
        power = peakPower * 0.5 * drop;
      }
    } else {
      power = peakPower;
    }
    points.push({soc, power: Math.max(power, 0)});
  }
  return points;
}

export function avg(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}
