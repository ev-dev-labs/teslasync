/**
 * HeatmapGrid (charging-heatmap) — behaviour + hardening contract.
 *
 * HeatmapGrid is the hero visualization of the Charging Patterns page: a 7×24
 * weekday/hour density grid with a hover detail popover and a colour-scale
 * legend. It is purely presentational — it takes a pre-built {@link HeatmapModel}
 * and a boundary `formatEnergy` formatter from the page, so these tests render
 * it directly (no QueryClient / Router) and pin:
 *
 *   - structure + a11y: the whole grid is a single labelled `role="img"`, all
 *     seven weekday rows and all 24 hour-header columns render, and exactly
 *     7×24 = 168 title-bearing cells exist (a cell is never dropped);
 *   - the continuous colour scale: the busiest slot gets the "hot" fill and an
 *     empty slot the faint base fill, driven by the shared `heatColor` scale;
 *   - the hover popover: mousing a non-empty cell reveals the weekday/hour line
 *     plus the "N sessions · <energy>" detail and calls `formatEnergy` with the
 *     cell's exact SI watt-hours; mousing out hides it again; an EMPTY cell
 *     shows no popover and never calls the formatter;
 *   - the legend: "Less"/"More" bookends plus one decorative (`aria-hidden`)
 *     swatch per `HEAT_LEGEND` stop;
 *   - hardening: a malformed model (missing grid/maxCount) still renders all 168
 *     cells instead of crashing, and a dirty cell missing `totalEnergyWh` is
 *     neutralised to a finite "0" energy so no "NaN" ever leaks into the popover.
 *
 * `react-i18next` is stubbed so `t(key, fallback)` resolves to its English
 * fallback deterministically (mirrors the sibling charging-curve tests). The
 * repo does not ship `@testing-library/user-event`, so pointer interaction uses
 * `fireEvent.mouseEnter` / `mouseLeave` — the established convention here.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { HeatmapGrid } from './HeatmapGrid';
import {
  heatColor,
  HEAT_LEGEND,
  type HeatCell,
  type HeatmapModel,
} from './heatmapData';

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

/** kWh formatter that mimics the real display boundary (SI Wh → kWh, 2dp). */
const makeFormatEnergy = () =>
  vi.fn((wh: number) => `${(wh / 1000).toFixed(2)} kWh`);

/** A fully-zeroed 7×24 grid, ready to have specific slots overwritten. */
function emptyModel(): HeatmapModel {
  const grid: HeatCell[][] = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => ({ count: 0, totalEnergyWh: 0 })),
  );
  return { grid, maxCount: 0, favDay: 0, favHour: 0 };
}

/** Row-major index of the (day, hour) cell among all title-bearing cells. */
const cellIndex = (day: number, hour: number) => day * 24 + hour;

/** All 168 heat cells, in DOM order (day 0 hours 0..23, day 1 …). */
const heatCells = (container: HTMLElement) =>
  container.querySelectorAll<HTMLElement>('div[title]');

/** Normalise rgba serialisation so whitespace differences don't break equality. */
const norm = (s: string) => s.replace(/\s+/g, '');

describe('HeatmapGrid — structure & accessibility', () => {
  it('renders a labelled role="img" grid with all weekdays and hour columns', () => {
    render(<HeatmapGrid model={emptyModel()} formatEnergy={makeFormatEnergy()} />);

    // The whole visualization is a single image with a text alternative.
    expect(
      screen.getByRole('img', {
        name: 'Charging sessions by weekday and hour of day',
      }),
    ).toBeInTheDocument();

    // Every weekday row label is present (Sun..Sat).
    for (const day of ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']) {
      expect(screen.getByText(day)).toBeInTheDocument();
    }

    // The hour-of-day header row spans 0..23.
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('23')).toBeInTheDocument();
  });

  it('renders exactly 7×24 = 168 title-bearing cells with SI-agnostic tooltips', () => {
    const model = emptyModel();
    model.grid[1][9] = { count: 4, totalEnergyWh: 40_000 };
    const { container } = render(
      <HeatmapGrid model={model} formatEnergy={makeFormatEnergy()} />,
    );

    const cells = heatCells(container);
    expect(cells).toHaveLength(168);
    // The native title carries weekday + zero-padded hour + the i18n "sessions"
    // word for the populated Monday-09:00 slot.
    expect(cells[cellIndex(1, 9)].getAttribute('title')).toBe('Mon 09:00 — 4 sessions');
    // …and "0 sessions" for an untouched slot.
    expect(cells[cellIndex(2, 3)].getAttribute('title')).toBe('Tue 03:00 — 0 sessions');
  });
});

describe('HeatmapGrid — colour scale', () => {
  it('maps slot density onto the shared heatColor scale (hot / mid / empty)', () => {
    const model = emptyModel();
    model.grid[1][9] = { count: 4, totalEnergyWh: 40_000 }; // busiest → hot
    model.grid[3][14] = { count: 1, totalEnergyWh: 5_000 }; // quarter → mid
    model.maxCount = 4;

    const { container } = render(
      <HeatmapGrid model={model} formatEnergy={makeFormatEnergy()} />,
    );
    const cells = heatCells(container);

    // Busiest slot: ratio 1 → hottest stop.
    expect(norm(cells[cellIndex(1, 9)].style.backgroundColor)).toBe(norm(heatColor(4, 4)));
    // Quarter-density slot: distinct mid stop, not the hot one.
    expect(norm(cells[cellIndex(3, 14)].style.backgroundColor)).toBe(norm(heatColor(1, 4)));
    expect(norm(cells[cellIndex(3, 14)].style.backgroundColor)).not.toBe(
      norm(heatColor(4, 4)),
    );
    // Empty slot: faintest base fill.
    expect(norm(cells[cellIndex(0, 0)].style.backgroundColor)).toBe(norm(heatColor(0, 4)));
  });
});

describe('HeatmapGrid — hover detail popover', () => {
  it('reveals weekday/hour + "N sessions · energy" and calls formatEnergy on hover', () => {
    const model = emptyModel();
    model.grid[1][9] = { count: 4, totalEnergyWh: 40_000 };
    model.maxCount = 4;
    const formatEnergy = makeFormatEnergy();

    const { container } = render(<HeatmapGrid model={model} formatEnergy={formatEnergy} />);
    const cell = heatCells(container)[cellIndex(1, 9)];

    // No popover until the pointer arrives.
    expect(screen.queryByText('Mon 09:00')).toBeNull();

    fireEvent.mouseEnter(cell);

    // The popover shows the slot header and the session/energy detail line.
    expect(screen.getByText('Mon 09:00')).toBeInTheDocument();
    expect(screen.getByText('4 sessions · 40.00 kWh')).toBeInTheDocument();
    // Energy is formatted from the cell's exact SI watt-hours, never converted here.
    expect(formatEnergy).toHaveBeenCalledWith(40_000);

    // Mousing out tears the popover back down.
    fireEvent.mouseLeave(cell);
    expect(screen.queryByText('Mon 09:00')).toBeNull();
  });

  it('shows no popover and never formats energy when hovering an empty slot', () => {
    const model = emptyModel();
    model.grid[1][9] = { count: 4, totalEnergyWh: 40_000 };
    model.maxCount = 4;
    const formatEnergy = makeFormatEnergy();

    const { container } = render(<HeatmapGrid model={model} formatEnergy={formatEnergy} />);
    const emptyCell = heatCells(container)[cellIndex(2, 3)];

    fireEvent.mouseEnter(emptyCell);

    // count === 0 → the detail popover is suppressed entirely.
    expect(screen.queryByText('Tue 03:00')).toBeNull();
    // …and the formatter is only ever invoked for a rendered popover.
    expect(formatEnergy).not.toHaveBeenCalled();
  });
});

describe('HeatmapGrid — legend', () => {
  it('renders Less/More bookends and one decorative swatch per HEAT_LEGEND stop', () => {
    const { container } = render(
      <HeatmapGrid model={emptyModel()} formatEnergy={makeFormatEnergy()} />,
    );

    expect(screen.getByText('Less')).toBeInTheDocument();
    expect(screen.getByText('More')).toBeInTheDocument();

    const swatches = container.querySelectorAll<HTMLElement>('span[aria-hidden="true"]');
    expect(swatches).toHaveLength(HEAT_LEGEND.length);
    swatches.forEach((swatch, i) => {
      // Swatches are purely decorative and paint the exact scale colours.
      expect(swatch).toHaveAttribute('aria-hidden', 'true');
      expect(norm(swatch.style.backgroundColor)).toBe(norm(HEAT_LEGEND[i]));
    });
  });
});

describe('HeatmapGrid — hardening', () => {
  it('renders all 168 cells (never a blank panel) for a malformed model', () => {
    // A partial model missing grid/maxCount must not crash the grid — the
    // null-safe reads fall back to an all-empty render.
    const malformed = {} as unknown as HeatmapModel;

    let container!: HTMLElement;
    expect(() => {
      container = render(
        <HeatmapGrid model={malformed} formatEnergy={makeFormatEnergy()} />,
      ).container;
    }).not.toThrow();

    expect(heatCells(container)).toHaveLength(168);
    expect(screen.getByRole('img')).toBeInTheDocument();
    // Every slot paints the faint base fill (heatColor(0, 0)).
    expect(norm(heatCells(container)[cellIndex(0, 0)].style.backgroundColor)).toBe(
      norm(heatColor(0, 0)),
    );
  });

  it('neutralises a cell missing totalEnergyWh to a finite "0" energy (no NaN leak)', () => {
    const model = emptyModel();
    // Dirty upstream cell: a count but no energy field at all.
    model.grid[2][10] = { count: 2 } as HeatCell;
    model.maxCount = 2;
    const formatEnergy = makeFormatEnergy();

    const { container } = render(<HeatmapGrid model={model} formatEnergy={formatEnergy} />);

    fireEvent.mouseEnter(heatCells(container)[cellIndex(2, 10)]);

    // The `?? 0` guard means the formatter sees 0, not undefined → "0.00 kWh".
    expect(screen.getByText('2 sessions · 0.00 kWh')).toBeInTheDocument();
    expect(formatEnergy).toHaveBeenCalledWith(0);
    // Crucially, no "NaN" ever reaches the DOM.
    expect(container.textContent).not.toContain('NaN');
  });
});
