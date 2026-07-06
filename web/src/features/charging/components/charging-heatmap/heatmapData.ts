import type { ChargingSession } from '@/api/types';

/**
 * Pure aggregation helpers for the Charging Patterns page. Kept free of React
 * so they can be unit-reasoned in isolation and reused across the heatmap grid,
 * the insights panel, and the breakdown charts.
 *
 * Energy is carried through as SI watt-hours (`total_energy_added_wh`) and only
 * formatted at the render boundary via `useUnits()` — never converted here.
 */

/** A single weekday × hour-of-day charging-density bucket. */
export interface HeatCell {
  count: number;
  /** Total energy added during this weekday/hour slot, in SI watt-hours. */
  totalEnergyWh: number;
}

/** Result of {@link buildGrid} — a 7×24 grid plus the busiest slot. */
export interface HeatmapModel {
  /** 7 rows (Sun..Sat) × 24 cols (0..23). */
  grid: HeatCell[][];
  /** Highest single-slot session count (drives the color scale). */
  maxCount: number;
  /** Weekday index (0..6) of the busiest slot. */
  favDay: number;
  /** Hour (0..23) of the busiest slot. */
  favHour: number;
}

function emptyGrid(): HeatCell[][] {
  return Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => ({ count: 0, totalEnergyWh: 0 })),
  );
}

/** Build a 7×24 weekday/hour charging-density grid from raw sessions. */
export function buildGrid(sessions: ChargingSession[]): HeatmapModel {
  const grid = emptyGrid();
  let maxCount = 0;
  let favDay = 0;
  let favHour = 0;

  for (const s of sessions ?? []) {
    const d = new Date(s.started_at);
    if (Number.isNaN(d.getTime())) continue;
    const day = d.getDay();
    const hour = d.getHours();
    const cell = grid[day][hour];
    cell.count += 1;
    cell.totalEnergyWh += s.total_energy_added_wh ?? 0;
    if (cell.count > maxCount) {
      maxCount = cell.count;
      favDay = day;
      favHour = hour;
    }
  }

  return { grid, maxCount, favDay, favHour };
}

/**
 * Heat intensity → rgba fill. The output is a data-driven value consumed by an
 * inline `style` (dynamic values are the sanctioned exception to the no-inline
 * -style rule — a static className cannot express a continuous scale).
 */
export function heatColor(count: number, max: number): string {
  if (count === 0 || max === 0) return 'rgba(0, 240, 255, 0.04)';
  const ratio = count / max;
  if (ratio < 0.25) return 'rgba(0, 240, 255, 0.15)';
  if (ratio < 0.5) return 'rgba(16, 185, 129, 0.4)';
  if (ratio < 0.75) return 'rgba(245, 158, 11, 0.55)';
  return 'rgba(239, 68, 68, 0.75)';
}

/** Legend swatches (low → high), aligned with the {@link heatColor} scale. */
export const HEAT_LEGEND: readonly string[] = [
  'rgba(0, 240, 255, 0.04)',
  'rgba(0, 240, 255, 0.15)',
  'rgba(16, 185, 129, 0.4)',
  'rgba(245, 158, 11, 0.55)',
  'rgba(239, 68, 68, 0.75)',
];

/** A named charging location with its session count. */
export interface LocationDatum {
  name: string;
  count: number;
}

/**
 * Top charging locations by session count. Only places visited ≥ 2 times are
 * surfaced (one-off stops are noise), capped at the 10 most frequent.
 */
export function aggregateLocations(
  sessions: ChargingSession[],
  unknownLabel: string,
): LocationDatum[] {
  const counts: Record<string, number> = {};
  for (const s of sessions ?? []) {
    // Treat null / blank / whitespace-only place names as "unknown" so the
    // locations chart never renders an empty Y-axis label, and trim so that
    // "Home" and "Home " collapse into a single row rather than two.
    const name = s.start_place?.trim() || unknownLabel;
    counts[name] = (counts[name] ?? 0) + 1;
  }
  return Object.entries(counts)
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }));
}

/** Sessions + energy grouped by weekday, ready for a bar chart. */
export interface DayDatum {
  day: string;
  count: number;
  energyWh: number;
}

/** Collapse a built grid into weekday totals (Sun..Sat), preserving order. */
export function aggregateByDayOfWeek(
  model: HeatmapModel,
  dayLabels: readonly string[],
): DayDatum[] {
  return (model?.grid ?? []).map((row, day) => {
    let count = 0;
    let energyWh = 0;
    for (const cell of row) {
      count += cell.count;
      energyWh += cell.totalEnergyWh;
    }
    return { day: dayLabels[day] ?? String(day), count, energyWh };
  });
}

/** Summary numbers derived from a grid for the insights side panel. */
export interface HeatmapInsights {
  busiestDay: number;
  busiestDayCount: number;
  busiestHour: number;
  busiestHourCount: number;
  weekdayCount: number;
  weekendCount: number;
  /** Distinct weekday/hour slots that saw at least one session. */
  activeSlots: number;
}

/** Derive busiest-day / busiest-hour / weekend-split insights from a grid. */
export function deriveInsights(model: HeatmapModel): HeatmapInsights {
  const grid = model?.grid ?? [];
  const dayTotals: number[] = new Array(7).fill(0);
  const hourTotals: number[] = new Array(24).fill(0);
  let activeSlots = 0;

  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const c = grid[day]?.[hour]?.count ?? 0;
      dayTotals[day] += c;
      hourTotals[hour] += c;
      if (c > 0) activeSlots += 1;
    }
  }

  let busiestDay = 0;
  for (let i = 1; i < 7; i++) if (dayTotals[i] > dayTotals[busiestDay]) busiestDay = i;
  let busiestHour = 0;
  for (let i = 1; i < 24; i++) if (hourTotals[i] > hourTotals[busiestHour]) busiestHour = i;

  const weekendCount = dayTotals[0] + dayTotals[6];
  const weekdayCount =
    dayTotals[1] + dayTotals[2] + dayTotals[3] + dayTotals[4] + dayTotals[5];

  return {
    busiestDay,
    busiestDayCount: dayTotals[busiestDay],
    busiestHour,
    busiestHourCount: hourTotals[busiestHour],
    weekdayCount,
    weekendCount,
    activeSlots,
  };
}

/** Zero-padded `HH:00` label for an hour index. */
export function formatHourLabel(hour: number): string {
  return `${hour.toString().padStart(2, '0')}:00`;
}
