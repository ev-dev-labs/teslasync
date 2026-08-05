/**
 * Energy Anatomy model — where a period's traction energy actually went.
 *
 * Decomposes every drive's measured `energyUsedWh` into physical components
 * using drive-level fields only (no per-drive telemetry fetch):
 *
 *   aero     ≈ ½ρ·CdA·v̄²·d / η        (drag grows with the square of speed)
 *   rolling  ≈ Crr·m·g·d / η           (linear in distance)
 *   climate  ≈ k·|T_out − 20 °C|·t     (HVAC scales with temp deviation × time)
 *   other    = measured − (aero + rolling + climate)
 *
 * The three modeled components are **rescaled** to never exceed the measured
 * energy: this is an anatomy of real consumption, not a forward simulation,
 * so the measured total is authoritative and the physics terms only apportion
 * it. Regen is carried as a separate recovered-energy credit. Constants are
 * Model-3-class defaults — the split is honest about being approximate and is
 * presented as shares, where constant error largely cancels.
 *
 * Pure and React-free; also exports the Sankey geometry used by the page so
 * the layout math is unit-testable.
 */

import type { Drive } from '@/types/driving';

/* ── Physics constants (Model-3-class defaults) ── */
const AIR_DENSITY = 1.2; // kg/m³
const CDA = 0.51; // m² (Cd ≈ 0.23 × A ≈ 2.22 m²)
const CRR = 0.009;
const MASS_KG = 1850;
const G = 9.81;
const DRIVETRAIN_EFF = 0.9;
const HVAC_W_PER_DEG = 45; // W per °C of outside deviation from 20 °C
const COMFORT_C = 20;

export interface AnatomyTotals {
  aeroWh: number;
  rollingWh: number;
  climateWh: number;
  otherWh: number;
  /** Measured traction energy — always equals the four components' sum. */
  totalWh: number;
  /** Recovered regen energy (credit flow, not part of totalWh). */
  regenWh: number;
  drives: number;
  distanceM: number;
}

function usable(d: Drive): boolean {
  return (
    d.energyUsedWh != null && Number.isFinite(d.energyUsedWh) && d.energyUsedWh > 0 &&
    Number.isFinite(d.distanceM) && d.distanceM >= 1000 &&
    Number.isFinite(d.durationS) && d.durationS > 0
  );
}

export function computeAnatomy(drives: readonly Drive[]): AnatomyTotals {
  let aero = 0;
  let rolling = 0;
  let climate = 0;
  let other = 0;
  let total = 0;
  let regen = 0;
  let count = 0;
  let distance = 0;

  for (const d of drives) {
    if (!usable(d)) continue;
    count += 1;
    distance += d.distanceM;
    const measured = d.energyUsedWh!;
    total += measured;
    if (d.regenEnergyWh != null && Number.isFinite(d.regenEnergyWh) && d.regenEnergyWh > 0) {
      regen += d.regenEnergyWh;
    }

    const v = d.avgSpeedMps != null && Number.isFinite(d.avgSpeedMps) && d.avgSpeedMps > 0
      ? d.avgSpeedMps
      : d.distanceM / d.durationS;

    // Joules → Wh via /3600.
    let aeroWh = (0.5 * AIR_DENSITY * CDA * v * v * d.distanceM) / DRIVETRAIN_EFF / 3600;
    let rollingWh = (CRR * MASS_KG * G * d.distanceM) / DRIVETRAIN_EFF / 3600;
    let climateWh =
      d.outsideTempAvgC != null && Number.isFinite(d.outsideTempAvgC)
        ? (HVAC_W_PER_DEG * Math.abs(d.outsideTempAvgC - COMFORT_C) * d.durationS) / 3600
        : 0;

    // Anatomy, not simulation: the measured energy is authoritative. When the
    // modeled terms overshoot it (downhill runs, tailwinds, constant error),
    // scale them down proportionally so `other` never goes negative.
    const modeled = aeroWh + rollingWh + climateWh;
    if (modeled > measured && modeled > 0) {
      const scale = measured / modeled;
      aeroWh *= scale;
      rollingWh *= scale;
      climateWh *= scale;
    }

    aero += aeroWh;
    rolling += rollingWh;
    climate += climateWh;
    other += Math.max(0, measured - (aeroWh + rollingWh + climateWh));
  }

  return {
    aeroWh: Math.round(aero),
    rollingWh: Math.round(rolling),
    climateWh: Math.round(climate),
    otherWh: Math.round(other),
    totalWh: Math.round(total),
    regenWh: Math.round(regen),
    drives: count,
    distanceM: distance,
  };
}

/* ── Sankey geometry ─────────────────────────────────────────────── */

export interface SankeyNode {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SankeyLink {
  key: string;
  /** SVG path: cubic bézier ribbon from source edge to target edge. */
  path: string;
  /** Ribbon thickness in px (min-clamped so tiny flows stay visible). */
  thickness: number;
  value: number;
}

export interface SankeyLayout {
  source: SankeyNode;
  targets: SankeyNode[];
  links: SankeyLink[];
  width: number;
  height: number;
}

export interface SankeyFlow {
  key: string;
  value: number;
}

/**
 * Single-source → N-targets Sankey layout in a fixed viewport. Pure geometry:
 * flow heights are proportional to value with a 2 px visibility floor, targets
 * are stacked with even gaps, and each ribbon is a cubic bézier between the
 * source segment and its target. Zero/negative flows are dropped.
 */
export function layoutSankey(
  flows: readonly SankeyFlow[],
  width = 640,
  height = 320,
): SankeyLayout {
  const NODE_W = 14;
  const GAP = 14;
  const positive = flows.filter((f) => Number.isFinite(f.value) && f.value > 0);
  const totalValue = positive.reduce((s, f) => s + f.value, 0);

  const usableH = height - GAP * Math.max(0, positive.length - 1);
  const scale = totalValue > 0 ? usableH / totalValue : 0;

  const thicknesses = positive.map((f) => Math.max(2, f.value * scale));
  const sumThick = thicknesses.reduce((s, t) => s + t, 0);
  const sourceH = Math.min(height, sumThick);
  const sourceY = (height - sourceH) / 2;
  const source: SankeyNode = { key: 'source', x: 0, y: sourceY, width: NODE_W, height: sourceH };

  const targets: SankeyNode[] = [];
  const links: SankeyLink[] = [];
  const stackH = sumThick + GAP * Math.max(0, positive.length - 1);
  let targetY = (height - stackH) / 2;
  let sourceOffset = sourceY;
  const targetX = width - NODE_W;

  positive.forEach((f, i) => {
    const thick = thicknesses[i]!;
    targets.push({ key: f.key, x: targetX, y: targetY, width: NODE_W, height: thick });

    const x0 = NODE_W;
    const x1 = targetX;
    const y0 = sourceOffset + thick / 2;
    const y1 = targetY + thick / 2;
    const cx = (x0 + x1) / 2;
    links.push({
      key: f.key,
      path: `M ${x0} ${y0} C ${cx} ${y0}, ${cx} ${y1}, ${x1} ${y1}`,
      thickness: thick,
      value: f.value,
    });

    sourceOffset += thick;
    targetY += thick + GAP;
  });

  return { source, targets, links, width, height };
}
