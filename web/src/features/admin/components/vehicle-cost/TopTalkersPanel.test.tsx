/**
 * TopTalkersPanel — behaviour + hardening coverage.
 *
 * TopTalkersPanel is a pure, prop-driven section that owns its own async
 * chrome. The behaviour locked in here:
 *
 *   1. State-invariant chrome — the "Top talkers" heading + its decorative
 *      (aria-hidden) Flame glyph and the subtitle caption render in EVERY
 *      status, because the header lives outside the per-section state switch.
 *   2. Self-sufficient states with the documented precedence
 *      (error > first-load skeleton > empty > data):
 *        • loading  → an accessible `role="status"` skeleton block, bars withheld.
 *        • error    → a retriable QueryError; the Retry CTA invokes `onRetry`.
 *        • empty    → guidance copy + the caller icon, no bars.
 *        • data     → one labelled listitem per vehicle.
 *   3. Derivation passed to <MetricBar> — value, max (fleet total when known,
 *      else the biggest talker so a single-vehicle window still fills the bar),
 *      the colour cycled through the colour-blind-safe palette, and the
 *      "count · share%" sublabel with integer counts.
 *   4. Hardening — null-safe inputs (undefined talkers / rows / name never
 *      crash or render blanks) and the share clamp (a vehicle whose window
 *      count outruns the reported fleet total reads 100%, never >100%).
 *   5. a11y — the bars are a labelled list with one listitem per bucket.
 *
 * <MetricBar> is stubbed to a prop-capturing element so the derived contract
 * (value/max/colour/sublabel) is asserted precisely without coupling to its
 * framer-motion internals; it has its own tests. The feedback children
 * (Skeleton / EmptyState / QueryError) render for real so the branch wiring is
 * exercised end-to-end. react-i18next is stubbed to the English fallback so
 * assertions read on copy, and useOnlineStatus is pinned online so QueryError
 * stays on its retriable "Can't reach server" branch. Network is never touched.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ComponentProps, ReactNode } from 'react';

import type { VehicleCostBar } from './helpers';

// ── i18n: resolve the English fallback (2nd arg) so assertions read on copy. ──
vi.mock('react-i18next', () => {
  const t = (key: string, fallback?: unknown): string =>
    typeof fallback === 'string' ? fallback : key;
  return {
    useTranslation: () => ({ t, i18n: { language: 'en', changeLanguage: vi.fn() } }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
    initReactI18next: { type: '3rdParty', init: () => undefined },
  };
});

// ── keep QueryError on its online "Can't reach server" branch (enabled Retry). ──
vi.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));

// ── Stub MetricBar to a prop-capturing element. Keeps the assertions on
//    TopTalkersPanel's OWN derivation contract precise (exact value / max /
//    colour / sublabel) and avoids re-testing MetricBar's animation internals. ──
vi.mock('@/components/data-display', () => ({
  MetricBar: ({
    label,
    value,
    max,
    color,
    sublabel,
  }: {
    label: string;
    value: number;
    max: number;
    color: string;
    sublabel?: string;
  }) => (
    <div
      data-testid="metric-bar"
      data-label={label}
      data-value={value}
      data-max={max}
      data-color={color}
      data-sublabel={sublabel ?? ''}
    />
  ),
}));

import { TopTalkersPanel } from './TopTalkersPanel';

// The colour-blind-safe series palette the component cycles through
// (chartTokens.series). Kept here so the colour assertions are self-documenting.
const SERIES = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];

// ── Fixtures ────────────────────────────────────────────────────────────────

function bar(overrides: Partial<VehicleCostBar> = {}): VehicleCostBar {
  return {
    vehicle_id: 1,
    name: 'Model 3',
    bytes: 0,
    rows: 0,
    rate: 0,
    failures: 0,
    ...overrides,
  };
}

type PanelProps = ComponentProps<typeof TopTalkersPanel>;

function renderPanel(overrides: Partial<PanelProps> = {}) {
  const props: PanelProps = {
    talkers: [],
    totalRows: 0,
    loading: false,
    error: null,
    onRetry: vi.fn(),
    ...overrides,
  };
  const utils = render(
    <MemoryRouter>
      <TopTalkersPanel {...props} />
    </MemoryRouter>,
  );
  return { ...utils, props };
}

/** Read the captured MetricBar stubs in DOM (= rank) order. */
function readBars() {
  return screen.getAllByTestId('metric-bar').map((el) => ({
    label: el.getAttribute('data-label'),
    value: el.getAttribute('data-value'),
    max: el.getAttribute('data-max'),
    color: el.getAttribute('data-color'),
    sublabel: el.getAttribute('data-sublabel'),
  }));
}

// ── State-invariant chrome ───────────────────────────────────────────────────

describe('TopTalkersPanel — chrome', () => {
  it('renders the heading with a decorative icon and the subtitle in every status', () => {
    const statuses = [
      { loading: true, error: null, talkers: [] as VehicleCostBar[] },
      { loading: false, error: new Error('boom'), talkers: [] as VehicleCostBar[] },
      { loading: false, error: null, talkers: [] as VehicleCostBar[] },
      { loading: false, error: null, talkers: [bar({ vehicle_id: 1, name: 'A', rows: 5 })] },
    ];

    for (const s of statuses) {
      const { unmount } = renderPanel(s);

      const heading = screen.getByRole('heading', { name: /top talkers/i });
      expect(heading).toBeInTheDocument();

      // The Flame glyph is presentational — it must not pollute the accessible
      // name, so it carries aria-hidden.
      const icon = heading.querySelector('svg');
      expect(icon?.getAttribute('aria-hidden')).toBe('true');

      // The subtitle frames the panel in every branch.
      expect(screen.getByText('Share of total rows ingested')).toBeInTheDocument();

      unmount();
    }
  });
});

// ── Loading ──────────────────────────────────────────────────────────────────

describe('TopTalkersPanel — loading', () => {
  it('shows an accessible skeleton block and withholds the bars on first load', () => {
    const { container } = renderPanel({ loading: true, talkers: [] });

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status).toHaveAccessibleName('Loading');
    // One pulsing Skeleton per placeholder row, and no bars yet.
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(5);
    expect(screen.queryByTestId('metric-bar')).toBeNull();
  });

  it('keeps the bars visible during a background refetch (loading with rows)', () => {
    const { container } = renderPanel({
      loading: true,
      totalRows: 100,
      talkers: [bar({ vehicle_id: 1, name: 'A', rows: 60 })],
    });

    // items.length > 0 → the `loading && empty` skeleton guard is skipped.
    expect(container.querySelector('.animate-pulse')).toBeNull();
    expect(screen.getByTestId('metric-bar')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });
});

// ── Error ────────────────────────────────────────────────────────────────────

describe('TopTalkersPanel — error', () => {
  it('surfaces a retriable error and invokes onRetry when Retry is clicked', () => {
    const onRetry = vi.fn();
    renderPanel({ error: new Error('network down'), onRetry });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^retry$/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    // The error affordance pre-empts the data list.
    expect(screen.queryByTestId('metric-bar')).toBeNull();
  });

  it('prioritises the error state over both loading and stale data', () => {
    const { container } = renderPanel({
      error: new Error('still broken'),
      loading: true,
      totalRows: 100,
      talkers: [bar({ vehicle_id: 1, name: 'A', rows: 60 })],
    });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(container.querySelector('.animate-pulse')).toBeNull();
    expect(screen.queryByTestId('metric-bar')).toBeNull();
  });
});

// ── Empty ────────────────────────────────────────────────────────────────────

describe('TopTalkersPanel — empty', () => {
  it('renders the empty guidance with a decorative icon and no bars', () => {
    renderPanel({ loading: false, talkers: [] });

    expect(
      screen.getByText('No vehicles have ingested signals yet.'),
    ).toBeInTheDocument();
    // EmptyState announces itself as a status region.
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByTestId('metric-bar')).toBeNull();
  });
});

// ── Derivation (populated) ───────────────────────────────────────────────────

describe('TopTalkersPanel — derivation', () => {
  it('scales every bar to the fleet total and formats the "count · share%" sublabel', () => {
    renderPanel({
      totalRows: 10_000,
      talkers: [
        bar({ vehicle_id: 11, name: 'Track pack', rows: 6_000 }),
        bar({ vehicle_id: 22, name: 'Daily driver', rows: 3_000 }),
        bar({ vehicle_id: 33, name: 'Garage queen', rows: 1_000 }),
      ],
    });

    const bars = readBars();
    expect(bars).toHaveLength(3);
    expect(bars.map((b) => b.label)).toEqual(['Track pack', 'Daily driver', 'Garage queen']);
    expect(bars.map((b) => b.value)).toEqual(['6000', '3000', '1000']);
    // max is the fleet total for every bar so the widths are comparable.
    expect(bars.map((b) => b.max)).toEqual(['10000', '10000', '10000']);
    // Integer counts (no spurious decimals) + one-decimal share of the total.
    expect(bars.map((b) => b.sublabel)).toEqual([
      '6,000 · 60.0%',
      '3,000 · 30.0%',
      '1,000 · 10.0%',
    ]);
  });

  it('falls back to the biggest talker for the scale when the fleet total is 0', () => {
    renderPanel({
      totalRows: 0,
      talkers: [
        bar({ vehicle_id: 1, name: 'Heaviest', rows: 400 }),
        bar({ vehicle_id: 2, name: 'Lighter', rows: 100 }),
      ],
    });

    const bars = readBars();
    // max === biggest talker (400): the leader fills the bar at 100%.
    expect(bars.map((b) => b.max)).toEqual(['400', '400']);
    expect(bars[0].sublabel).toBe('400 · 100.0%');
    expect(bars[1].sublabel).toBe('100 · 25.0%');
  });

  it('cycles the colour palette and wraps back to the first colour after eight bars', () => {
    const talkers = Array.from({ length: 9 }, (_, i) =>
      bar({ vehicle_id: i + 1, name: `V${i}`, rows: 9 - i }),
    );

    renderPanel({ totalRows: 100, talkers });

    const bars = readBars();
    expect(bars).toHaveLength(9);
    expect(bars[0].color).toBe(SERIES[0]);
    expect(bars[1].color).toBe(SERIES[1]);
    // series[8 % 8] === series[0] — the palette wraps.
    expect(bars[8].color).toBe(SERIES[0]);
    expect(bars[0].color).not.toBe(bars[1].color);
  });
});

// ── Hardening (null-safety + clamp) ──────────────────────────────────────────

describe('TopTalkersPanel — hardening', () => {
  it('coalesces missing rows/name and clamps the share to 100%', () => {
    renderPanel({
      totalRows: 1_000,
      talkers: [
        // rows (5000) outrun the reported fleet total (1000) → clamp to 100%.
        bar({ vehicle_id: 1, name: 'Firehose', rows: 5_000 }),
        // malformed row: undefined rows + missing name must not crash or blank.
        bar({ vehicle_id: 2, name: undefined as unknown as string, rows: undefined as unknown as number }),
      ],
    });

    const bars = readBars();
    expect(bars[0].sublabel).toBe('5,000 · 100.0%'); // clamped, not 500%
    expect(bars[1].value).toBe('0'); // rows ?? 0
    expect(bars[1].label).toBe('—'); // name ?? '—'
    expect(bars[1].sublabel).toBe('0 · 0.0%');
  });

  it('renders the empty state instead of crashing when talkers/totalRows are undefined', () => {
    renderPanel({
      talkers: undefined as unknown as VehicleCostBar[],
      totalRows: undefined as unknown as number,
      loading: false,
    });

    expect(
      screen.getByText('No vehicles have ingested signals yet.'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('metric-bar')).toBeNull();
  });
});

// ── Accessibility ────────────────────────────────────────────────────────────

describe('TopTalkersPanel — accessibility', () => {
  it('exposes the bars as a labelled list with one listitem per vehicle', () => {
    renderPanel({
      totalRows: 100,
      talkers: [
        bar({ vehicle_id: 1, name: 'A', rows: 60 }),
        bar({ vehicle_id: 2, name: 'B', rows: 40 }),
      ],
    });

    const list = screen.getByRole('list', { name: /top talkers ranked by ingested rows/i });
    expect(list).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });
});
