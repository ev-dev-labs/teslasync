/**
 * Drive DNA — deterministic generative-art engine.
 *
 * Turns a single drive's telemetry into a unique, reproducible visual
 * "fingerprint": a radial genome bloom where every petal is one telemetry
 * sample and its geometry/colour encode how the car was actually driven.
 *
 * Encoding (all derived purely from the data, so the same drive always
 * renders the same art — no randomness):
 *   - angle      : progress through the drive (0..2π)
 *   - radius     : instantaneous speed (faster => reaches further out)
 *   - hue        : power flow — regen (negative kW) is cool/emerald,
 *                  hard draw (positive kW) is warm/rose
 *   - saturation : |power| magnitude (effort)
 *   - lightness  : battery state of charge at that moment
 *   - ringRadius : elevation band (concentric terrain rings)
 *
 * Everything is null-safe: missing signals collapse to neutral values so a
 * sparse drive still produces coherent art instead of NaN geometry.
 */
import type { DriveTelemetryPoint } from '@/types/driving';

export interface DNAPetal {
  /** Polar angle in radians (0 = 3 o'clock, grows clockwise). */
  angle: number;
  /** Inner radius (viewBox units) — where the petal starts. */
  r0: number;
  /** Outer radius (viewBox units) — driven by speed. */
  r1: number;
  /** HSL colour string encoding power / SoC. */
  color: string;
  /** Stroke width — effort (|power|). */
  width: number;
  /** 0..1 opacity — recency-weighted so the drive reads as a journey. */
  opacity: number;
}

export interface DNARing {
  /** Radius of the concentric terrain ring. */
  r: number;
  /** Faint colour keyed to the elevation band. */
  color: string;
}

export interface DriveGenome {
  petals: DNAPetal[];
  rings: DNARing[];
  /** Dominant background halo hue (average efficiency mood). */
  haloColor: string;
  /** Short human traits, e.g. ["Spirited", "Mountainous", "Cold-start"]. */
  traits: string[];
  /** Deterministic 12-char signature (a shareable "gene sequence"). */
  signature: string;
  /** Summary stats surfaced next to the art. */
  stats: {
    points: number;
    topSpeedKph: number | null;
    climbM: number | null;
    regenShare: number | null; // 0..1 fraction of samples in regen
    coldStart: boolean;
  };
}

const VIEWBOX = 100; // square viewBox side; art is centred at (50,50)
const CENTER = VIEWBOX / 2;

function num(v: number | null | undefined, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** FNV-1a 32-bit hash → stable base36 signature from the drive's shape. */
function signatureOf(points: DriveTelemetryPoint[]): string {
  let h = 0x811c9dc5;
  for (const p of points) {
    // Quantise the meaningful channels so tiny float noise stays stable.
    const parts = [
      Math.round(num(p.speed)),
      Math.round(num(p.power) / 5),
      Math.round(num(p.soc)),
      Math.round(num(p.elevation) / 10),
    ];
    for (const part of parts) {
      h ^= part & 0xffff;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return (h >>> 0).toString(36).padStart(7, '0').slice(0, 7).toUpperCase();
}

/**
 * Build a full genome from a drive's telemetry. Returns coherent (empty-art)
 * output for an empty/degenerate series rather than throwing.
 */
export function generateDriveDNA(raw: readonly DriveTelemetryPoint[] | undefined): DriveGenome {
  const points = (raw ?? []).filter(Boolean);
  const n = points.length;

  const empty: DriveGenome = {
    petals: [],
    rings: [],
    haloColor: 'hsl(210, 30%, 20%)',
    traits: [],
    signature: '0000000',
    stats: { points: 0, topSpeedKph: null, climbM: null, regenShare: null, coldStart: false },
  };
  if (n < 2) return empty;

  // ---- Pass 1: ranges for normalisation --------------------------------
  let maxSpeed = 0;
  let minElev = Infinity;
  let maxElev = -Infinity;
  let regenSamples = 0;
  let sumEffort = 0;
  let firstOutside: number | null = null;
  let climb = 0;
  let prevElev: number | null = null;

  for (const p of points) {
    const s = num(p.speed);
    if (s > maxSpeed) maxSpeed = s;
    const e = p.elevation;
    if (typeof e === 'number' && Number.isFinite(e)) {
      if (e < minElev) minElev = e;
      if (e > maxElev) maxElev = e;
      if (prevElev != null && e > prevElev) climb += e - prevElev;
      prevElev = e;
    }
    const pw = num(p.power);
    if (pw < -1) regenSamples += 1;
    sumEffort += Math.abs(pw);
    if (firstOutside == null && typeof p.outsideTemp === 'number') firstOutside = p.outsideTemp;
  }
  if (!Number.isFinite(minElev)) {
    minElev = 0;
    maxElev = 0;
  }
  const elevSpan = Math.max(1, maxElev - minElev);
  const speedSpan = Math.max(1, maxSpeed);
  const avgEffort = sumEffort / n;

  // ---- Pass 2: petals ---------------------------------------------------
  const petals: DNAPetal[] = points.map((p, i) => {
    const t = i / (n - 1); // 0..1 journey progress
    const angle = t * Math.PI * 2 - Math.PI / 2; // start at 12 o'clock
    const speedNorm = clamp(num(p.speed) / speedSpan, 0, 1);
    const r0 = 10;
    const r1 = r0 + speedNorm * (CENTER - 14);

    const power = num(p.power);
    // Hue: regen (power<0) → emerald ~150°, coasting → cyan ~190°,
    // hard draw (power>0) → rose ~350°. Map power [-avg..+2avg] onto hue.
    const powerNorm = clamp((power + avgEffort) / (3 * avgEffort + 1), 0, 1);
    const hue = 150 + powerNorm * (350 - 150);
    const sat = 55 + clamp(Math.abs(power) / (avgEffort * 2 + 1), 0, 1) * 40;
    const light = 40 + clamp(num(p.soc, 50) / 100, 0, 1) * 35;

    return {
      angle,
      r0,
      r1,
      color: `hsl(${Math.round(hue)}, ${Math.round(sat)}%, ${Math.round(light)}%)`,
      width: 0.4 + clamp(Math.abs(power) / (avgEffort * 2 + 1), 0, 1) * 1.4,
      opacity: 0.35 + t * 0.55, // brighten toward the end of the drive
    };
  });

  // ---- Terrain rings (elevation bands) ---------------------------------
  const ringCount = clamp(Math.round((maxElev - minElev) / 60), 0, 5);
  const rings: DNARing[] = Array.from({ length: ringCount }, (_, k) => {
    const frac = (k + 1) / (ringCount + 1);
    return {
      r: 12 + frac * (CENTER - 14),
      color: `hsla(${Math.round(200 - frac * 60)}, 45%, 55%, 0.12)`,
    };
  });

  // ---- Traits + halo ----------------------------------------------------
  const regenShare = regenSamples / n;
  const coldStart = firstOutside != null && firstOutside < 5;
  const traits: string[] = [];
  if (maxSpeed > 33) traits.push('Spirited'); // >~120 km/h
  else if (maxSpeed < 14) traits.push('Gentle');
  if (climb > 150) traits.push('Mountainous');
  if (regenShare > 0.35) traits.push('Regen-rich');
  if (coldStart) traits.push('Cold-start');
  if (avgEffort < 8000) traits.push('Efficient');
  if (traits.length === 0) traits.push('Balanced');

  const haloHue = 150 + clamp(1 - regenShare, 0, 1) * 60; // greener when regen-heavy
  const haloColor = `hsl(${Math.round(haloHue)}, 40%, 16%)`;

  return {
    petals,
    rings,
    haloColor,
    traits,
    signature: signatureOf(points),
    stats: {
      points: n,
      topSpeedKph: maxSpeed > 0 ? Math.round(maxSpeed * 3.6) : null,
      climbM: elevSpan > 1 ? Math.round(climb) : null,
      regenShare,
      coldStart,
    },
  };
}

/** Convert a petal to an SVG line segment from centre outward. */
export function petalLine(p: DNAPetal): { x1: number; y1: number; x2: number; y2: number } {
  return {
    x1: CENTER + Math.cos(p.angle) * p.r0,
    y1: CENTER + Math.sin(p.angle) * p.r0,
    x2: CENTER + Math.cos(p.angle) * p.r1,
    y2: CENTER + Math.sin(p.angle) * p.r1,
  };
}

export const DNA_VIEWBOX = VIEWBOX;
export const DNA_CENTER = CENTER;
