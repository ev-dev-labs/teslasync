/**
 * CostHeatmap (charging-list · optimizer) — behaviour + hardening contract.
 *
 * Pins all 168 weekday/hour cells, populated tooltips, theme-aware continuous
 * cost fills, the legend, peak fallback, empty states and dirty-data guards.
 * The shared disclosure/table alternative preserves every slot and exposes
 * currency-formatted values without relying on color or hover. Both contained
 * scroll regions are reachable using the keyboard.
 *
 * `react-i18next` is stubbed so `t(key, fallback)` resolves to its English
 * fallback deterministically (mirrors the sibling charging-heatmap /
 * charging-curve tests). The globally-stubbed `useSettings` (src/test-setup.ts —
 * currency `$`, precision 2, locale en-US) lets the real `useFormatting` run
 * against deterministic prefs.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { chartTokens } from '@/lib/tokens';

import { CostHeatmap, heatFill } from './CostHeatmap';
import type { OptimizerHeatmapEntry } from '@/types/charging';

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown, options?: { title?: string }) =>
        typeof fallback === 'string'
          ? fallback.replace('{{title}}', options?.title ?? '')
          : key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

/** Strip whitespace so CSS colour serialisation doesn't break equality. */
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
  it('mixes restrained theme-aware cost series into the neutral surface', () => {
    expect(heatFill(1, 0.6)).toBe(
      `color-mix(in srgb, color-mix(in srgb, ${chartTokens.series[1]} 0%, ${chartTokens.series[3]}) 60%, var(--surface-2))`,
    );
    expect(heatFill(0, 0.6)).toContain(`${chartTokens.series[1]} 100%`);
    expect(heatFill(0.5, 0.6)).toContain(`${chartTokens.series[1]} 50%`);
  });

  it('clamps out-of-range inputs and neutralises NaN/undefined to a finite 0', () => {
    // Over-range intensity + alpha clamp to 1.
    expect(heatFill(2, 5)).toBe(heatFill(1, 1));
    // Negative intensity + alpha clamp to the neutral surface.
    expect(heatFill(-1, -0.5)).toBe(heatFill(0, 0));
    // NaN / undefined → 0 via safeNumber, so no "NaN" ever reaches the string.
    expect(heatFill(NaN, NaN)).toBe(heatFill(0, 0));
    expect(heatFill(undefined as unknown as number, undefined as unknown as number)).toBe(
      heatFill(0, 0),
    );
  });
});

describe('CostHeatmap — structure & accessibility', () => {
  it('keeps contained scrolling keyboard reachable and exposes every slot in the shared table', async () => {
    const user = userEvent.setup();
    const { container } = render(<CostHeatmap heatmap={sampleHeatmap} peakCostPerKwh={0.3} />);
    const chartScroll = screen.getByRole('region', {
      name: 'Average charging cost per kWh by weekday and hour of day',
    });
    expect(chartScroll).toHaveAttribute('tabindex', '0');
    expect(chartScroll).toHaveClass('max-w-full', 'overflow-x-auto', 'overscroll-x-contain');
    await user.tab();
    expect(chartScroll).toHaveFocus();
    await user.tab();
    const disclosure = screen.getByRole('button', { name: 'Charging Cost Heatmap — data table' });
    expect(disclosure).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    await user.tab();
    const tableScroll = screen.getAllByRole('region', { name: 'Charging Cost Heatmap — data table' })
      .find((region) => region.tabIndex === 0);
    expect(tableScroll).toHaveFocus();
    expect(tableScroll).toHaveClass('max-h-96', 'overflow-auto', 'overscroll-contain');
    const table = screen.getByRole('table', {
      name: 'Average charging cost per kWh by weekday and hour of day',
    });
    await user.tab();
    expect(table).toHaveFocus();
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(168);
    rows.forEach((row, index) => {
      expect(within(row).getByRole('rowheader')).toHaveTextContent(
        ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][Math.floor(index / 24)],
      );
      expect(within(row).getAllByRole('cell')[0]).toHaveTextContent(`${index % 24}:00`);
    });
    expect(within(rows[cellIndex(1, 9)]).getAllByRole('cell').map((cell) => cell.textContent))
      .toEqual(['9:00', '4', '$0.30/kWh']);
    expect(within(rows[cellIndex(0, 0)]).getAllByRole('cell').map((cell) => cell.textContent))
      .toEqual(['0:00', '0', '—']);
    expect(rows[167]).toHaveTextContent('Sat23:00');
    expect(heatCells(container)).toHaveLength(168);
  });

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
      'Mon 9:00 — 4 sessions, $0.30/kWh',
    );
    // Wed 14:00: the quarter-cost slot.
    expect(cells[cellIndex(3, 14)].getAttribute('title')).toBe(
      'Wed 14:00 — 1 sessions, $0.15/kWh',
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
    expect(norm(cells[cellIndex(0, 0)].style.backgroundColor)).toBe('var(--surface-2)');
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
    expect(norm(nanCell.style.backgroundColor)).toBe('var(--surface-2)');

    // Valid sessions but NaN cost → cost 0 → "$0.000", intensity 0, no NaN colour.
    const costCell = heatCells(container)[cellIndex(2, 10)];
    expect(costCell.getAttribute('title')).toBe('Tue 10:00 — 3 sessions, $0.00/kWh');
    expect(norm(costCell.style.backgroundColor)).toBe(
      norm(heatFill(0, Math.min(0.9, 0.15 + 3 * 0.12))),
    );
    expect(costCell.style.backgroundColor).not.toContain('NaN');

    // Crucially, nothing anywhere in the DOM reads "NaN".
    expect(container.textContent).not.toContain('NaN');
  });
});
