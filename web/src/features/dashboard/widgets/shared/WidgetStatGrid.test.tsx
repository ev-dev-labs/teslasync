/**
 * WidgetStatGrid — behaviour, branch, null-safety and a11y coverage for the
 * dashboard's shared stat-grid primitive.
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
 *   - column resolution: explicit `cols`, the `autoCols` fallback (3-/4-/2-up by
 *     divisibility) and the `compact` override that forces a single column;
 *   - a11y: a provided icon is rendered but hidden from the accessibility tree
 *     by StatCard;
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

// i18n passthrough: returns the English default so the empty-state copy is
// asserted verbatim. StatCard's own `t(...)` calls resolve the same way.
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
    expect(container.querySelector('.grid')).toBeNull();
  });

  it('does not throw and still shows the empty state when stats is undefined', () => {
    // Regression guard: `.length` / `.map` on an absent list used to crash.
    expect(() => render(<WidgetStatGrid stats={undefined} />)).not.toThrow();
    expect(screen.getByText('No stats available')).toBeInTheDocument();
  });
});

// ── Mapping ──────────────────────────────────────────────────────────────────

describe('WidgetStatGrid — mapping', () => {
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
});

// ── Trend chip branches ──────────────────────────────────────────────────────

describe('WidgetStatGrid — trend chip branches', () => {
  it('renders a positive (green) chip for an up trend with a value', () => {
    const { container } = render(
      <WidgetStatGrid stats={[makeStat({ label: 'Eff', value: 9, trend: 'up', trendValue: '+12%' })]} />,
    );
    expect(screen.getByText('+12%')).toBeInTheDocument();
    expect(screen.getByText('↑')).toBeInTheDocument();
    expect(container.querySelector('.text-green-600')).not.toBeNull();
  });

  it('renders a negative (red) chip for a down trend with a value', () => {
    const { container } = render(
      <WidgetStatGrid stats={[makeStat({ label: 'Err', value: 3, trend: 'down', trendValue: 'High' })]} />,
    );
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(screen.getByText('↓')).toBeInTheDocument();
    expect(container.querySelector('.text-red-600')).not.toBeNull();
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

  it('renders a provided icon but hides it from the accessibility tree', () => {
    render(
      <WidgetStatGrid
        stats={[makeStat({ label: 'Iconic', value: 1, icon: <svg data-testid="stat-icon" /> })]}
      />,
    );
    const icon = screen.getByTestId('stat-icon');
    expect(icon).toBeInTheDocument();
    expect(icon.closest('span')?.getAttribute('aria-hidden')).toBe('true');
  });
});

// ── Column resolution ────────────────────────────────────────────────────────

describe('WidgetStatGrid — column resolution', () => {
  it('maps explicit cols to the container-query grid classes', () => {
    expect(gridRoot(<WidgetStatGrid stats={makeStats(4)} cols={2} />).className).toContain('grid-cols-2');
    expect(gridRoot(<WidgetStatGrid stats={makeStats(4)} cols={3} />).className).toContain('@sm:grid-cols-3');
    expect(gridRoot(<WidgetStatGrid stats={makeStats(4)} cols={4} />).className).toContain('@sm:grid-cols-4');
  });

  it('auto-selects columns from the item count when cols is omitted', () => {
    // 3 items → 3-up; 4 → 4-up; 5 (indivisible by 3 or 4) → 2-up baseline.
    expect(gridRoot(<WidgetStatGrid stats={makeStats(3)} />).className).toContain('@sm:grid-cols-3');
    expect(gridRoot(<WidgetStatGrid stats={makeStats(4)} />).className).toContain('@sm:grid-cols-4');
    const five = gridRoot(<WidgetStatGrid stats={makeStats(5)} />).className;
    expect(five).toContain('grid-cols-2');
    expect(five).not.toContain('@sm:grid-cols-4');
  });

  it('collapses to a single column (and tighter gap) when compact, overriding cols', () => {
    const cls = gridRoot(<WidgetStatGrid stats={makeStats(4)} cols={4} compact />).className;
    expect(cls).toContain('grid-cols-1');
    expect(cls).toContain('gap-2');
    expect(cls).not.toContain('@sm:grid-cols-4');
  });

  it('uses the roomier gap when not compact', () => {
    expect(gridRoot(<WidgetStatGrid stats={makeStats(2)} />).className).toContain('gap-3');
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
