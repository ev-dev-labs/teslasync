/**
 * WidgetStatGrid — behaviour, branch, null-safety and a11y coverage for the
 * dashboard's shared stat-grid primitive.
 *
 * The grid speaks the spec `stats` / `st` language (widgets-compare.html):
 * a CSS grid with 2/3/4 columns collapsing on narrow containers, 12px row /
 * 14px column gaps, a muted label, an 18px semibold tabular value and a quiet
 * unit. Cells reuse the shared StatCard with its chrome stripped; the spec
 * type scale is applied through parent-scoped selectors so StatCard itself is
 * untouched.
 *
 * What this file pins:
 *   - null-safety: an `undefined` or empty `stats` prop degrades to the shared
 *     EmptyState (never a blank panel, never a crash on `.length` / `.map`) —
 *     the regression this elevation hardens against;
 *   - the map: one StatCard per item, carrying its label, value and optional
 *     unit, with a numeric `0` preserved (not em-dashed);
 *   - the trend ternary's every branch — a chip renders only when BOTH `trend`
 *     and `trendValue` are present, an `up` trend paints positive (green), a
 *     `down` trend negative (red), and neither half alone renders anything;
 *   - the `valueColor` → StatCard `className` pass-through;
 *   - spec layout: a real grid (not flex-wrap) with the staged stat-gap and
 *     column tokens, explicit/automatic column counts and a compact
 *     single-column override;
 *   - spec type scale: the 18px value override and the muted 12px label
 *     override are present on each tile;
 *   - metric tiles omit decorative icons and remain flat inside the widget;
 *   - keys: two stats sharing a label both render without React's duplicate-key
 *     warning (the composite-key fix).
 *
 * Strategy: react-i18next is a passthrough that honours the English default so
 * the empty-state copy ("No stats available") is asserted verbatim. No network,
 * router or query context is touched — the grid composes only presentational
 * shared components.
 */
import { type ReactElement } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { WidgetStatGrid, type StatGridItem } from './WidgetStatGrid';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: unknown) =>
      typeof defaultValue === 'string' ? defaultValue : key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

function makeStat(over: Partial<StatGridItem> = {}): StatGridItem {
  return { label: 'Metric', value: '0', ...over };
}

function makeStats(n: number): StatGridItem[] {
  return Array.from({ length: n }, (_, i) => makeStat({ label: `Metric ${i}`, value: i }));
}

/** Render `ui` and return the grid's root <div> for className assertions. */
function gridRoot(ui: ReactElement): HTMLElement {
  return render(ui).container.firstElementChild as HTMLElement;
}

// ── Empty & null-safety ──────────────────────────────────────────────────────

describe('WidgetStatGrid — empty & null-safety', () => {
  it('shows the shared empty state (never a blank panel) for an empty list', () => {
    const { container } = render(<WidgetStatGrid stats={[]} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('No stats available')).toBeInTheDocument();
    // No grid is rendered — the empty-state branch replaces it entirely.
    expect(container.querySelector('[data-max-per-row]')).toBeNull();
    expect(container.querySelector('.text-2xl')).toBeNull();
  });

  it('does not throw and still shows the empty state when stats is undefined', () => {
    // Regression guard: `.length` / `.map` on an absent list used to crash.
    expect(() => render(<WidgetStatGrid stats={undefined} />)).not.toThrow();
    expect(screen.getByText('No stats available')).toBeInTheDocument();
  });
});

// ── Mapping ──────────────────────────────────────────────────────────────────

describe('WidgetStatGrid — mapping', () => {
  it('uses a chrome-free metric group inside the existing widget panel', () => {
    const { container } = render(<WidgetStatGrid stats={[makeStat()]} />);
    expect(container.querySelector('.\\!bg-transparent')).toBeInTheDocument();
    expect(container.querySelector('.\\!border-0')).toBeInTheDocument();
    // Spec `stats`: a real CSS grid, not the old flex-wrap + 200px-basis tiles.
    expect(container.firstElementChild).toHaveClass('grid', 'min-w-0');
    expect(container.firstElementChild?.className).not.toContain('flex-wrap');
    // No per-tile inline flex styles — the grid track sizes the cells.
    expect(container.firstElementChild?.firstElementChild).not.toHaveAttribute('style');
  });

  it('renders one StatCard per item with label, value and optional unit', () => {
    const stats: StatGridItem[] = [
      makeStat({ label: 'Power', value: 42, unit: 'kW' }),
      makeStat({ label: 'Range', value: '250', unit: 'mi' }),
      makeStat({ label: 'Trips', value: 7 }),
    ];
    const { container } = render(<WidgetStatGrid stats={stats} />);

    expect(screen.getByText('Power')).toBeInTheDocument();
    expect(screen.getByText('Range')).toBeInTheDocument();
    expect(screen.getByText('Trips')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('250')).toBeInTheDocument();
    expect(screen.getByText('kW')).toBeInTheDocument();
    expect(screen.getByText('mi')).toBeInTheDocument();
    // One value node (StatCard's `.text-2xl` metric span) per stat.
    expect(container.querySelectorAll('.text-2xl').length).toBe(3);
  });

  it('preserves a numeric zero instead of degrading to an em-dash', () => {
    render(<WidgetStatGrid stats={[makeStat({ label: 'Idle', value: 0 })]} />);
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.queryByText('—')).toBeNull();
  });

  it('renders a current-value sublabel without implying a comparison trend', () => {
    render(<WidgetStatGrid stats={[makeStat({ value: 4, sublabel: '3 online' })]} />);
    expect(screen.getByText('3 online')).toBeInTheDocument();
    expect(screen.queryByText('no change')).toBeNull();
    expect(screen.queryByText('—')).toBeNull();
  });
});

// ── Spec type scale ──────────────────────────────────────────────────────────

describe('WidgetStatGrid — spec type scale', () => {
  it('re-voices each tile to the After 18px value / muted 12px label', () => {
    const root = gridRoot(<WidgetStatGrid stats={[makeStat()]} />);
    const tileClass = root.firstElementChild?.className ?? '';
    // 18px semibold value (beats StatCard's text-2xl / sm:text-3xl metric).
    expect(tileClass).toContain('text-lg');
    // 12px muted label (the After `.k` at the closest standard step).
    expect(tileClass).toContain('text-xs');
    expect(tileClass).toContain('text-[var(--text-muted)]');
  });
});

// ── Trend chip branches ──────────────────────────────────────────────────────

describe('WidgetStatGrid — trend chip branches', () => {
  it('lets callers express a declining cost as a positive result', () => {
    const { container } = render(
      <WidgetStatGrid stats={[makeStat({ label: 'Cost', value: 3, trend: 'down', trendValue: '12%', trendPositive: true })]} />,
    );
    expect(screen.getByText('↓')).toBeInTheDocument();
    expect(container.querySelector('.text-emerald-700')).toBeInTheDocument();
  });

  it('renders a positive (green) chip for an up trend with a value', () => {
    const { container } = render(
      <WidgetStatGrid stats={[makeStat({ label: 'Eff', value: 9, trend: 'up', trendValue: '+12%' })]} />,
    );
    expect(screen.getByText('+12%')).toBeInTheDocument();
    expect(screen.getByText('↑')).toBeInTheDocument();
    expect(container.querySelector('.text-emerald-700')).not.toBeNull();
  });

  it('renders a negative (red) chip for a down trend with a value', () => {
    const { container } = render(
      <WidgetStatGrid stats={[makeStat({ label: 'Err', value: 3, trend: 'down', trendValue: 'High' })]} />,
    );
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(screen.getByText('↓')).toBeInTheDocument();
    expect(container.querySelector('.text-rose-700')).not.toBeNull();
  });

  it('omits the chip when a trend direction has no accompanying value', () => {
    render(<WidgetStatGrid stats={[makeStat({ label: 'Bare', value: 1, trend: 'up' })]} />);
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.queryByText('↑')).toBeNull();
  });

  it('omits the chip when a trend value has no accompanying direction', () => {
    render(<WidgetStatGrid stats={[makeStat({ label: 'Bare', value: 2, trendValue: 'orphan' })]} />);
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.queryByText('orphan')).toBeNull();
    expect(screen.queryByText('↑')).toBeNull();
    expect(screen.queryByText('↓')).toBeNull();
  });
});

// ── valueColor & icon ────────────────────────────────────────────────────────

describe('WidgetStatGrid — valueColor & icon', () => {
  it('forwards valueColor to the StatCard as a className', () => {
    const { container } = render(
      <WidgetStatGrid stats={[makeStat({ label: 'Hot', value: 5, valueColor: 'text-rose-300' })]} />,
    );
    expect(container.querySelector('.text-rose-300')).not.toBeNull();
  });

  it('omits decorative metric icons from flat tiles', () => {
    render(
      <WidgetStatGrid
        stats={[makeStat({ label: 'Iconic', value: 1, icon: <svg data-testid="stat-icon" /> })]}
      />,
    );
    expect(screen.queryByTestId('stat-icon')).not.toBeInTheDocument();
  });
});

// ── Column resolution ────────────────────────────────────────────────────────

describe('WidgetStatGrid — spec grid layout', () => {
  it('uses the explicit or compatibility column count per row', () => {
    expect(gridRoot(<WidgetStatGrid stats={makeStats(4)} maxPerRow={2} />)).toHaveAttribute('data-max-per-row', '2');
    expect(gridRoot(<WidgetStatGrid stats={makeStats(4)} cols={3} />)).toHaveAttribute('data-max-per-row', '3');
  });

  it('auto-selects a column count from the item count when none is supplied', () => {
    expect(gridRoot(<WidgetStatGrid stats={makeStats(3)} />)).toHaveAttribute('data-max-per-row', '3');
    expect(gridRoot(<WidgetStatGrid stats={makeStats(4)} />)).toHaveAttribute('data-max-per-row', '4');
    // 5 items resolve to 3-up (rows of 3+2); the old grid's 2-up match was the @xs intermediate breakpoint.
    expect(gridRoot(<WidgetStatGrid stats={makeStats(5)} />)).toHaveAttribute('data-max-per-row', '3');
  });

  it('lays out on the staged column token with the spec 12px / 14px gaps', () => {
    const root = gridRoot(<WidgetStatGrid stats={makeStats(4)} />);
    expect(root.className).toContain('grid-cols-1');
    expect(root.className).toContain('@xs:grid-cols-2');
    expect(root.className).toContain('@sm:grid-cols-4');
    // Spec `.stats { gap: 12px 14px }` → staged density.statGap.
    expect(root.className).toContain('gap-x-3.5');
    expect(root.className).toContain('gap-y-3');
  });

  it('uses a single full-width column with a tighter gap when compact', () => {
    const root = gridRoot(<WidgetStatGrid stats={makeStats(4)} cols={4} compact />);
    expect(root).toHaveAttribute('data-max-per-row', '1');
    expect(root.className).toContain('grid-cols-1');
    expect(root.className).toContain('gap-2');
    expect(root.firstElementChild).not.toHaveAttribute('style');
  });

  it('uses the roomier spec gaps when not compact', () => {
    const root = gridRoot(<WidgetStatGrid stats={makeStats(2)} />);
    expect(root.className).toContain('gap-x-3.5');
    expect(root.className).toContain('gap-y-3');
  });
});

// ── Keys ─────────────────────────────────────────────────────────────────────

describe('WidgetStatGrid — keys', () => {
  it('renders both stats sharing a label without a duplicate-key warning', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <WidgetStatGrid
        stats={[makeStat({ label: 'Same', value: 1 }), makeStat({ label: 'Same', value: 2 })]}
      />,
    );

    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();

    const dupKeyWarned = errSpy.mock.calls.some((args) =>
      args.some((a) => typeof a === 'string' && /same key/i.test(a)),
    );
    expect(dupKeyWarned).toBe(false);

    errSpy.mockRestore();
  });
});
