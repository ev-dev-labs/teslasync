/**
 * CostHeatmap (charging-list · optimizer) — behaviour + hardening contract.
 *
 * CostHeatmap is the weekly cost visualisation of the Charging Optimizer
 * section: a 7×24 weekday/hour grid whose cells are tinted from cheap→expensive
 * by the average cost/kWh of the sessions that landed in that slot, plus a
 * cheap↔expensive legend. It is purely presentational — the parent
 * (OptimizerSection) hands it the pre-aggregated `weekly_heatmap` array and the
 * peak cost/kWh that anchors the colour scale — so these tests render it
 * directly (no QueryClient / Router) and pin:
 *
 *   - the exported `heatFill` scale: exact rgba at both ends + midpoint, and its
 *     clamp/`safeNumber` guards (out-of-range + NaN can never emit bad colour);
 *   - structure + a11y: the grid is a single labelled `role="img"`, all seven
 *     weekday rows + the hour axis render, and exactly 7×24 = 168 title-bearing
 *     cells exist (a cell is never dropped); the header icon is decorative;
 *   - the continuous colour scale: the priciest slot gets the "hot" fill, a
 *     quarter-cost slot a distinct mid fill, and an empty slot the faint base;
 *   - the tooltip: a populated cell reports "<day> <hour>:00 — N sessions,
 *     <currency>/kWh" using the real `useFormatting` boundary, an empty cell
 *     reports only "<day> <hour>:00";
 *   - the peak fallback: `peakCostPerKwh <= 0` falls back to the 0.30 default max
 *     so the scale still spans the grid;
 *   - the empty branch: `[]` / `undefined` heatmap renders a labelled
 *     `role="status"` EmptyState (never a blank panel) while still showing the
 *     panel title, and never crashes;
 *   - dirty-data hardening: NaN/undefined/null cells are neutralised to a finite
 *     "0" so no "NaN" ever leaks into a tooltip or an inline colour.
 *
 * `react-i18next` is stubbed so `t(key, fallback)` resolves to its English
 * fallback deterministically (mirrors the sibling charging-heatmap /
 * charging-curve tests). The globally-stubbed `useSettings` (src/test-setup.ts —
 * currency `$`, precision 2, locale en-US) lets the real `useFormatting` run
 * against deterministic prefs.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { CostHeatmap, heatFill } from './CostHeatmap';
import type { OptimizerHeatmapEntry } from '@/types/charging';

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

/** Strip whitespace so rgba serialisation differences don't break equality. */
const norm = (s: string) => s.replace(/\s+/g, '');

/** All 168 title-bearing heat cells, in DOM order (day 0 hours 0..23, day 1 …). */
const heatCells = (container: HTMLElement) =>
  container.querySelectorAll<HTMLElement>('div[title]');

/** Row-major index of the (day, hour) cell among all title-bearing cells. */
const cellIndex = (day: number, hour: number) => day * 24 + hour;

const entry = (
  day: number,
  hour: number,
  sessions: number,
  avg_cost_per_kwh: number,
): OptimizerHeatmapEntry => ({ day, hour, sessions, avg_cost_per_kwh });

/** A representative heatmap: a priciest slot, a quarter-cost slot, a cheap slot. */
const sampleHeatmap: OptimizerHeatmapEntry[] = [
  entry(1, 9, 4, 0.3), // Mon 09:00 — busiest + priciest → intensity 1
  entry(3, 14, 1, 0.15), // Wed 14:00 — quarter cost → intensity 0.5
  entry(6, 22, 2, 0.06), // Sat 22:00 — cheap → low intensity
];

describe('heatFill — colour scale primitive', () => {
  it('paints a warm rgba fill that cools from expensive (red) to cheap (green)', () => {
    // intensity 1 → full red, no green/blue; intensity 0 → the cool base.
    expect(heatFill(1, 0.6)).toBe('rgba(239, 0, 0, 0.6)');
    expect(heatFill(0, 0.6)).toBe('rgba(0, 187, 100, 0.6)');
    // Midpoint interpolates each channel and rounds (0.5·239=120, 0.5·187≈94).
    expect(heatFill(0.5, 0.6)).toBe('rgba(120, 94, 50, 0.6)');
  });

  it('clamps out-of-range inputs and neutralises NaN/undefined to a finite 0', () => {
    // Over-range intensity + alpha clamp to 1, not overflow past red / opacity 1.
    expect(heatFill(2, 5)).toBe('rgba(239, 0, 0, 1)');
    // Negative intensity + alpha clamp to 0 (the coolest fill, fully transparent).
    expect(heatFill(-1, -0.5)).toBe('rgba(0, 187, 100, 0)');
    // NaN / undefined → 0 via safeNumber, so no "NaN" ever reaches the string.
    expect(heatFill(NaN, NaN)).toBe('rgba(0, 187, 100, 0)');
    expect(heatFill(undefined as unknown as number, undefined as unknown as number)).toBe(
      'rgba(0, 187, 100, 0)',
    );
  });
});

describe('CostHeatmap — structure & accessibility', () => {
  it('renders the panel title, a labelled role="img" grid, weekdays and the hour axis', () => {
    render(<CostHeatmap heatmap={sampleHeatmap} peakCostPerKwh={0.3} />);

    // The panel keeps its title even alongside the grid.
    expect(
      screen.getByRole('heading', { name: 'Charging Cost Heatmap' }),
    ).toBeInTheDocument();

    // The whole visualization is one image with a text alternative.
    expect(
      screen.getByRole('img', {
        name: 'Average charging cost per kWh by weekday and hour of day',
      }),
    ).toBeInTheDocument();

    // Every weekday row label is present (Sun..Sat).
    for (const day of ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']) {
      expect(screen.getByText(day)).toBeInTheDocument();
    }

    // The hour axis spans 0..23 (labels shown every 3rd hour).
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('21')).toBeInTheDocument();
  });

  it('renders exactly 7×24 = 168 title-bearing cells and a decorative header icon', () => {
    const { container } = render(<CostHeatmap heatmap={sampleHeatmap} peakCostPerKwh={0.3} />);

    expect(heatCells(container)).toHaveLength(168);

    // The clock glyph is decorative — screen readers announce the aria-label.
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('CostHeatmap — tooltips', () => {
  it('reports "<day> <hour>:00 — N sessions, <currency>/kWh" for a populated cell', () => {
    const { container } = render(<CostHeatmap heatmap={sampleHeatmap} peakCostPerKwh={0.3} />);
    const cells = heatCells(container);

    // Mon 09:00: 4 sessions @ $0.300/kWh (formatCurrency → $ + 3dp).
    expect(cells[cellIndex(1, 9)].getAttribute('title')).toBe(
      'Mon 9:00 — 4 sessions, $0.300/kWh',
    );
    // Wed 14:00: the quarter-cost slot.
    expect(cells[cellIndex(3, 14)].getAttribute('title')).toBe(
      'Wed 14:00 — 1 sessions, $0.150/kWh',
    );
  });

  it('reports only "<day> <hour>:00" for an empty cell', () => {
    const { container } = render(<CostHeatmap heatmap={sampleHeatmap} peakCostPerKwh={0.3} />);
    expect(heatCells(container)[cellIndex(2, 3)].getAttribute('title')).toBe('Tue 3:00');
  });
});

describe('CostHeatmap — colour scale', () => {
  it('maps slot cost onto the shared heatFill scale (hot / mid / empty base)', () => {
    const { container } = render(<CostHeatmap heatmap={sampleHeatmap} peakCostPerKwh={0.3} />);
    const cells = heatCells(container);

    // Priciest slot: cost === peak → intensity 1, alpha grows with 4 sessions.
    expect(norm(cells[cellIndex(1, 9)].style.backgroundColor)).toBe(
      norm(heatFill(1, Math.min(0.9, 0.15 + 4 * 0.12))),
    );
    // Quarter-cost slot: a distinct mid fill, not the hot one.
    expect(norm(cells[cellIndex(3, 14)].style.backgroundColor)).toBe(
      norm(heatFill(0.5, Math.min(0.9, 0.15 + 1 * 0.12))),
    );
    expect(norm(cells[cellIndex(3, 14)].style.backgroundColor)).not.toBe(
      norm(heatFill(1, 0.63)),
    );
    // Untouched slot: the faint base fill (never tinted).
    expect(norm(cells[cellIndex(0, 0)].style.backgroundColor)).toBe(norm('rgba(255,255,255,0.02)'));
  });

  it('falls back to the 0.30 default max when peakCostPerKwh is not positive', () => {
    // With no positive peak, a $0.30 slot must still reach full intensity.
    const { container } = render(
      <CostHeatmap heatmap={[entry(1, 9, 2, 0.3)]} peakCostPerKwh={0} />,
    );
    expect(norm(heatCells(container)[cellIndex(1, 9)].style.backgroundColor)).toBe(
      norm(heatFill(1, Math.min(0.9, 0.15 + 2 * 0.12))),
    );
  });
});

describe('CostHeatmap — legend', () => {
  it('renders Cheap/Expensive bookends and one swatch per legend stop', () => {
    const { container } = render(<CostHeatmap heatmap={sampleHeatmap} peakCostPerKwh={0.3} />);

    expect(screen.getByText('Cheap')).toBeInTheDocument();
    expect(screen.getByText('Expensive')).toBeInTheDocument();

    const swatches = container.querySelectorAll<HTMLElement>('.w-3.h-3');
    const stops = [0.15, 0.3, 0.5, 0.7, 0.9];
    expect(swatches).toHaveLength(stops.length);
    swatches.forEach((swatch, i) => {
      expect(norm(swatch.style.backgroundColor)).toBe(norm(heatFill(stops[i], 0.6)));
    });
  });
});

describe('CostHeatmap — empty & null-safety', () => {
  it('renders a labelled role="status" EmptyState (never a blank panel) for []', () => {
    const { container } = render(<CostHeatmap heatmap={[]} peakCostPerKwh={0.3} />);

    // Title stays; the grid is replaced by the empty state, not hidden away.
    expect(screen.getByRole('heading', { name: 'Charging Cost Heatmap' })).toBeInTheDocument();
    expect(
      screen.getByText('The charging cost heatmap will appear after more charging sessions.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    // No grid, no cells.
    expect(screen.queryByRole('img')).toBeNull();
    expect(heatCells(container)).toHaveLength(0);
  });

  it('does not crash on an undefined heatmap and shows the empty state', () => {
    let container!: HTMLElement;
    expect(() => {
      container = render(
        <CostHeatmap heatmap={undefined as unknown as OptimizerHeatmapEntry[]} peakCostPerKwh={0.3} />,
      ).container;
    }).not.toThrow();

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(heatCells(container)).toHaveLength(0);
  });
});

describe('CostHeatmap — dirty-data hardening', () => {
  it('neutralises NaN/undefined/null cells so no "NaN" leaks into a tooltip or colour', () => {
    const dirty = [
      entry(1, 9, NaN as unknown as number, undefined as unknown as number), // both fields dirty
      entry(2, 10, 3, NaN as unknown as number), // sessions valid, cost dirty
      null as unknown as OptimizerHeatmapEntry, // an entirely null entry
    ];

    const { container } = render(
      <CostHeatmap heatmap={dirty} peakCostPerKwh={NaN} />,
    );

    // Still a full grid — a dirty cell never drops the visualization.
    expect(heatCells(container)).toHaveLength(168);

    // NaN sessions → 0 → the slot renders as empty (no session/cost text).
    const nanCell = heatCells(container)[cellIndex(1, 9)];
    expect(nanCell.getAttribute('title')).toBe('Mon 9:00');
    expect(norm(nanCell.style.backgroundColor)).toBe(norm('rgba(255,255,255,0.02)'));

    // Valid sessions but NaN cost → cost 0 → "$0.000", intensity 0, no NaN colour.
    const costCell = heatCells(container)[cellIndex(2, 10)];
    expect(costCell.getAttribute('title')).toBe('Tue 10:00 — 3 sessions, $0.000/kWh');
    expect(norm(costCell.style.backgroundColor)).toBe(
      norm(heatFill(0, Math.min(0.9, 0.15 + 3 * 0.12))),
    );
    expect(costCell.style.backgroundColor).not.toContain('NaN');

    // Crucially, nothing anywhere in the DOM reads "NaN".
    expect(container.textContent).not.toContain('NaN');
  });
});
