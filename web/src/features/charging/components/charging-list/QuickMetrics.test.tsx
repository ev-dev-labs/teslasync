/**
 * QuickMetrics — behaviour, a11y, regression + null-safety cover.
 *
 * <QuickMetrics stats /> is the six-tile "quick glance" strip at the top of the
 * charging list: three charge-type counts (Home / Supercharger / DC Fast, each
 * an <AnimatedNumber> with a decorative lucide glyph), plus Total Time
 * (formatDuration), a "Monthly Avg" cost (totalCost / 12 via <Currency>) and a
 * "Per Session" energy average (totalEnergy / count via fmtWithUnit). When
 * `stats` is null the whole panel collapses to a single <EmptyState>.
 *
 * What is pinned here:
 *   • RENDER      — all six tiles wired to the right prop fields + formatter,
 *     and every tile label present.
 *   • A11Y        — the three charger glyphs are decorative and MUST be hidden
 *     from assistive tech (aria-hidden) so the visible labels are the sole
 *     accessible names.
 *   • EMPTY       — a null `stats` renders the EmptyState (role=status) and none
 *     of the metric tiles.
 *   • REGRESSION  — a zero `count` used to divide totalEnergy → Infinity; the
 *     per-session tile now guards it and reads a clean "0.00 kWh".
 *   • NULL-SAFETY — a partial payload degrades counts→0, duration→"—",
 *     cost→"$0", per-session→"0.00 kWh" with no NaN/undefined/Infinity leak.
 *   • EDGE        — sub-hour, multi-hour, and negative (clock-skew) durations.
 *
 * The real GlassPanel / AnimatedNumber / Currency / EmptyState render;
 * Currency's "$" comes from the global useSettings mock in test-setup. Only
 * react-i18next is mocked to the English fallback (repo convention) and
 * requestAnimationFrame is collapsed so <AnimatedNumber> settles on its final
 * value synchronously after render.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';

import { QuickMetrics } from './QuickMetrics';
import type { ChargingStats } from './helpers';

// English-fallback i18n with {{placeholder}} interpolation (repo convention).
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const interpolate = (tpl: string, vars?: Record<string, unknown>) =>
    vars ? tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (k in vars ? String(vars[k]) : `{{${k}}}`)) : tpl;
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, second?: unknown, third?: unknown) => {
        if (typeof second === 'string') {
          const vars = third && typeof third === 'object' ? (third as Record<string, unknown>) : undefined;
          return interpolate(second, vars);
        }
        return key;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

beforeEach(() => {
  // Collapse <AnimatedNumber>'s ease-out onto its final frame so the rendered
  // value is deterministic and available synchronously after render().
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
    cb(1e9);
    return 1;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function makeStats(overrides: Partial<ChargingStats> = {}): ChargingStats {
  return {
    totalEnergy: 840, // 840 / 42 sessions → 20.00 kWh per session
    totalCost: 1200, // 1200 / 12 → $100 monthly avg
    totalDuration: 150, // 150 min → "2h 30m"
    avgPower: 48.5,
    avgCostPerKwh: 0.234,
    homeCount: 10,
    scCount: 18,
    dcCount: 14,
    count: 42,
    ...overrides,
  };
}

describe('QuickMetrics — populated grid', () => {
  it('wires every tile to the correct field + formatter', () => {
    const { container } = render(<QuickMetrics stats={makeStats()} />);

    // Three charge-type counts via <AnimatedNumber> (rAF collapsed to final).
    expect(screen.getByText('10')).toBeInTheDocument(); // homeCount
    expect(screen.getByText('18')).toBeInTheDocument(); // scCount
    expect(screen.getByText('14')).toBeInTheDocument(); // dcCount

    // Total Time: 150 min → 2h 30m.
    expect(screen.getByText('2h 30m')).toBeInTheDocument();
    // Monthly Avg: 1200 / 12 = 100 → "$100" (precision 0, "$" from settings).
    expect(screen.getByText('$100')).toBeInTheDocument();
    // Per Session: 840 / 42 = 20 → "20.00 kWh".
    expect(screen.getByText('20.00 kWh')).toBeInTheDocument();

    // No arithmetic ever leaks to the DOM.
    expect(container.textContent).not.toContain('NaN');
  });

  it('labels each tile and keeps the decorative charger icons out of the a11y tree', () => {
    const { container } = render(<QuickMetrics stats={makeStats()} />);

    for (const label of ['Home', 'Supercharger', 'DC Fast', 'Total Time', 'Monthly Avg', 'Per Session']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    // The Home / Bolt / Zap glyphs duplicate their adjacent text labels, so they
    // must be hidden from assistive tech to avoid polluting the accessible name.
    const icons = Array.from(container.querySelectorAll('svg'));
    expect(icons).toHaveLength(3);
    for (const svg of icons) {
      expect(svg.getAttribute('aria-hidden')).toBe('true');
    }
  });
});

describe('QuickMetrics — empty state', () => {
  it('renders the EmptyState placeholder (and no metric tiles) when stats is null', () => {
    render(<QuickMetrics stats={null} />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('No charging metrics available yet')).toBeInTheDocument();

    // None of the six metric tiles are mounted.
    expect(screen.queryByText('Per Session')).toBeNull();
    expect(screen.queryByText('Home')).toBeNull();
  });
});

describe('QuickMetrics — regression + null safety', () => {
  it('guards the per-session divide so a zero-count fleet never leaks Infinity/NaN', () => {
    // Pre-fix `totalEnergy / count` divided 840 / 0 → Infinity before reaching
    // fmtWithUnit; the tile now short-circuits to a clean zero.
    const { container } = render(
      <QuickMetrics stats={makeStats({ count: 0, totalEnergy: 840, totalCost: 0 })} />,
    );

    expect(screen.getByText('0.00 kWh')).toBeInTheDocument();
    expect(container.textContent).not.toContain('Infinity');
    expect(container.textContent).not.toContain('NaN');
  });

  it('degrades a partial stats payload to zeros / em-dash without leaking NaN or undefined', () => {
    // A truthy-but-empty object exercises the field-level `?? 0` guards: it is
    // NOT null, so the grid renders — every field must fall back safely.
    const { container } = render(<QuickMetrics stats={{} as unknown as ChargingStats} />);

    // The three counts each collapse to a standalone "0".
    expect(screen.getAllByText('0')).toHaveLength(3);
    // Missing duration → formatDuration(undefined) → em-dash.
    expect(screen.getByText('—')).toBeInTheDocument();
    // Missing cost → (0 / 12) → "$0"; missing energy/count → "0.00 kWh".
    expect(screen.getByText('$0')).toBeInTheDocument();
    expect(screen.getByText('0.00 kWh')).toBeInTheDocument();

    expect(container.textContent).not.toContain('NaN');
    expect(container.textContent).not.toContain('undefined');
    expect(container.textContent).not.toContain('Infinity');
  });
});

describe('QuickMetrics — duration formatting', () => {
  it('formats sub-hour and multi-hour totals and falls back to em-dash for negatives', () => {
    const { rerender } = render(<QuickMetrics stats={makeStats({ totalDuration: 45 })} />);
    expect(screen.getByText('45m')).toBeInTheDocument();

    rerender(<QuickMetrics stats={makeStats({ totalDuration: 125 })} />);
    expect(screen.getByText('2h 5m')).toBeInTheDocument();

    // formatDuration guards `minutes < 0` (clock-skew) → em-dash. Every other
    // tile is valid, so the duration tile is the sole em-dash in the tree.
    rerender(<QuickMetrics stats={makeStats({ totalDuration: -10 })} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
