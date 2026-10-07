/**
 * LiveSignalSourceBreakdown — source-layer distribution contract.
 *
 * This panel is a pure, prop-driven view of `LiveSignalStats` that splits the
 * live snapshot across the layered live-state contract (L1 / stale / L2 /
 * unknown). The facets pinned here:
 *
 *   • ready: renders exactly four stat cards in l1 → stale → l2 → unknown order,
 *     each with the canonical <SourceLayerBadge>, its integer count, its rounded
 *     share, and its human label;
 *   • the proportion bar is the sole role="img"; its accessible name interpolates
 *     the live per-layer counts, it draws one width-proportional segment per
 *     non-zero source (zero-count layers are dropped from the bar but KEPT as
 *     cards), and each segment carries a descriptive title;
 *   • percentages round for display and never divide by zero when the total is 0;
 *   • a malformed / partial snapshot (missing `bySource`) degrades to zeros
 *     instead of throwing (null-safety);
 *   • a degenerate `total` smaller than a facet count is clamped so the bar can
 *     never overflow or print ">100%";
 *   • the four self-sufficient section states (no-vehicle / loading / empty /
 *     error) each render their own affordance without ever blanking the panel
 *     title, and the error state's Retry invokes `onRetry`.
 *
 * react-i18next is mocked to echo each call's English fallback and interpolate
 * `{{token}}` placeholders so the aria-label and copy are deterministic. Renders
 * are wrapped in <MemoryRouter> because the error branch's <QueryError> uses
 * `useNavigate`. `@testing-library/user-event` is not a dependency in this
 * worktree, so the click interaction uses `fireEvent`.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string, opts?: Record<string, unknown>) => {
      let out = fallback ?? _key;
      if (opts) {
        for (const [k, v] of Object.entries(opts)) {
          out = out.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
        }
      }
      return out;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

import { LiveSignalSourceBreakdown } from './LiveSignalSourceBreakdown';
import type {
  LiveSignalStats,
  LiveSourceKey,
  SectionStatus,
} from './liveSignalStats';

type RenderProps = {
  stats: LiveSignalStats;
  status: SectionStatus;
  error: unknown;
  onRetry: () => void;
  noVehicleIcon?: ReactNode;
};

/** Build a well-formed `LiveSignalStats` from a `bySource` bag. `total` is
 *  derived from the counts unless explicitly overridden (used to exercise the
 *  degenerate-total clamp). */
function makeStats(
  bySource: Partial<Record<LiveSourceKey, number>>,
  overrides: Partial<LiveSignalStats> = {},
): LiveSignalStats {
  const full: Record<LiveSourceKey, number> = {
    l1: bySource.l1 ?? 0,
    l2: bySource.l2 ?? 0,
    stale: bySource.stale ?? 0,
    unknown: bySource.unknown ?? 0,
  };
  const total = full.l1 + full.l2 + full.stale + full.unknown;
  return {
    total,
    live: full.l1,
    stale: full.stale,
    legacy: full.l2,
    numeric: 0,
    bySource: full,
    byKind: [],
    freshestAgeMs: null,
    ...overrides,
  };
}

function renderBreakdown(overrides: Partial<RenderProps> = {}) {
  const props: RenderProps = {
    stats: makeStats({ l1: 5, stale: 3, l2: 2, unknown: 0 }),
    status: 'ready',
    error: null,
    onRetry: vi.fn(),
    ...overrides,
  };
  const utils = render(
    <MemoryRouter>
      <LiveSignalSourceBreakdown {...props} />
    </MemoryRouter>,
  );
  return { ...utils, props };
}

/** The stat card wrapping a given human label ('Live · L1', 'Stale', …). */
function cardByLabel(label: string): HTMLElement {
  const el = screen.getByText(label).closest('div.rounded-lg');
  if (!el) throw new Error(`no card container for label "${label}"`);
  return el as HTMLElement;
}

/** Proportional bar (the sole role="img") + its rendered (>0%) segments. */
function getBar(): HTMLElement {
  return screen.getByRole('img');
}
function getSegments(): HTMLElement[] {
  return Array.from(getBar().children) as HTMLElement[];
}

describe('LiveSignalSourceBreakdown', () => {
  it('renders four source cards in l1 → stale → l2 → unknown order with badge, count, share, and label', () => {
    renderBreakdown({ stats: makeStats({ l1: 5, stale: 3, l2: 2, unknown: 0 }) });

    const badges = screen.getAllByTestId('source-layer-badge');
    expect(badges).toHaveLength(4);
    expect(badges.map((b) => b.getAttribute('data-source'))).toEqual([
      'l1',
      'stale',
      'l2',
      'unknown',
    ]);

    // total = 10 → 50% / 30% / 20% / 0%.
    const l1 = cardByLabel('Live · L1');
    expect(within(l1).getByText('5')).toBeInTheDocument();
    expect(within(l1).getByText('50%')).toBeInTheDocument();

    const stale = cardByLabel('Stale');
    expect(within(stale).getByText('3')).toBeInTheDocument();
    expect(within(stale).getByText('30%')).toBeInTheDocument();

    const l2 = cardByLabel('Legacy · L2');
    expect(within(l2).getByText('2')).toBeInTheDocument();
    expect(within(l2).getByText('20%')).toBeInTheDocument();

    const unknown = cardByLabel('Unknown');
    expect(within(unknown).getByText('0')).toBeInTheDocument();
    expect(within(unknown).getByText('0%')).toBeInTheDocument();
  });

  it('exposes the bar to assistive tech with an aria-label reflecting the live per-layer counts', () => {
    renderBreakdown({ stats: makeStats({ l1: 5, stale: 3, l2: 2, unknown: 0 }) });

    expect(getBar()).toHaveAttribute(
      'aria-label',
      'Signal source-layer distribution: 5 live, 3 stale, 2 legacy, 0 unknown',
    );
    // The panel heading is always present so the section is never a blank img.
    expect(
      screen.getByRole('heading', { name: 'Source Layers' }),
    ).toBeInTheDocument();
  });

  it('draws one width-proportional segment per non-zero source with a descriptive title, dropping zero-count layers from the bar only', () => {
    renderBreakdown({ stats: makeStats({ l1: 5, stale: 3, l2: 2, unknown: 0 }) });

    const segs = getSegments();
    // unknown = 0% → absent from the bar (but still a card, asserted above).
    expect(segs).toHaveLength(3);

    expect(segs[0].style.width).toBe('50%');
    expect(segs[0].getAttribute('title')).toBe('Live · L1: 5 (50%)');
    expect(segs[0].className).toContain('bg-emerald-500');

    expect(segs[1].style.width).toBe('30%');
    expect(segs[1].getAttribute('title')).toBe('Stale: 3 (30%)');

    expect(segs[2].style.width).toBe('20%');
    expect(segs[2].getAttribute('title')).toBe('Legacy · L2: 2 (20%)');

    // No segment for the zero-count unknown layer.
    expect(
      segs.some((s) => (s.getAttribute('title') ?? '').startsWith('Unknown')),
    ).toBe(false);
  });

  it('rounds fractional percentages for the cards while the bar keeps full-precision widths', () => {
    // total = 3 → l1 = 33.33% (→33), l2 = 66.67% (→67).
    renderBreakdown({ stats: makeStats({ l1: 1, l2: 2 }) });

    expect(within(cardByLabel('Live · L1')).getByText('33%')).toBeInTheDocument();
    expect(within(cardByLabel('Legacy · L2')).getByText('67%')).toBeInTheDocument();

    const segs = getSegments();
    expect(segs).toHaveLength(2);
    expect(segs[0].style.width).toBe(`${(1 / 3) * 100}%`);
    expect(getBar()).toHaveAttribute(
      'aria-label',
      'Signal source-layer distribution: 1 live, 0 stale, 2 legacy, 0 unknown',
    );
  });

  it('handles a zero total without dividing by zero: no bar segments and every card reads 0 / 0%', () => {
    renderBreakdown({ stats: makeStats({}) });

    expect(getSegments()).toHaveLength(0);
    // Four cards, each an honest "0" count and "0%" share.
    expect(screen.getAllByTestId('source-layer-badge')).toHaveLength(4);
    expect(screen.getAllByText('0%')).toHaveLength(4);
    expect(screen.queryByText(/NaN/)).toBeNull();
    expect(getBar()).toHaveAttribute(
      'aria-label',
      'Signal source-layer distribution: 0 live, 0 stale, 0 legacy, 0 unknown',
    );
  });

  it('is null-safe when the snapshot omits bySource entirely (degrades to zeros, never throws)', () => {
    const malformed = {
      total: 0,
      live: 0,
      stale: 0,
      legacy: 0,
      numeric: 0,
      byKind: [],
      freshestAgeMs: null,
      // bySource intentionally omitted — a partial / malformed payload.
    } as unknown as LiveSignalStats;

    expect(() => renderBreakdown({ stats: malformed })).not.toThrow();

    expect(getSegments()).toHaveLength(0);
    expect(screen.getAllByTestId('source-layer-badge')).toHaveLength(4);
    expect(getBar()).toHaveAttribute(
      'aria-label',
      'Signal source-layer distribution: 0 live, 0 stale, 0 legacy, 0 unknown',
    );
  });

  it('clamps a degenerate total so a facet count above it never overflows the bar or prints ">100%"', () => {
    // total deliberately trails the counts (a stale total vs a fresher bag):
    // raw l1 share = 10/5 = 200% → clamped to 100%.
    renderBreakdown({ stats: makeStats({ l1: 10 }, { total: 5 }) });

    const segs = getSegments();
    expect(segs).toHaveLength(1);
    expect(segs[0].style.width).toBe('100%');

    const l1 = cardByLabel('Live · L1');
    expect(within(l1).getByText('10')).toBeInTheDocument();
    expect(within(l1).getByText('100%')).toBeInTheDocument();
    expect(screen.queryByText(/200%/)).toBeNull();
  });

  it('shows the no-vehicle affordance (with the provided icon) and hides the breakdown, keeping the panel title', () => {
    renderBreakdown({
      status: 'no-vehicle',
      noVehicleIcon: <svg data-testid="radio-icon" />,
    });

    expect(screen.getByTestId('radio-icon')).toBeInTheDocument();
    expect(
      screen.getByText(/Select a vehicle to see how its signals/),
    ).toBeInTheDocument();
    // Breakdown itself is gone…
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryAllByTestId('source-layer-badge')).toHaveLength(0);
    // …but the panel is never blank: its heading survives.
    expect(
      screen.getByRole('heading', { name: 'Source Layers' }),
    ).toBeInTheDocument();
  });

  it('renders a skeleton (not the bar) while loading', () => {
    const { container } = renderBreakdown({ status: 'loading' });

    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryAllByTestId('source-layer-badge')).toHaveLength(0);
    expect(
      screen.getByRole('heading', { name: 'Source Layers' }),
    ).toBeInTheDocument();
  });

  it('renders the empty-state message (not the cards) when there is nothing to classify', () => {
    renderBreakdown({ status: 'empty' });

    expect(
      screen.getByText('No live signals to classify yet.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryAllByTestId('source-layer-badge')).toHaveLength(0);
  });

  it('surfaces an error affordance whose Retry invokes onRetry (failure path + interaction)', () => {
    const onRetry = vi.fn();
    renderBreakdown({ status: 'error', error: new Error('boom'), onRetry });

    // QueryError renders an assertive alert with a Retry CTA.
    expect(screen.getByRole('alert')).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: 'Retry' });

    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);

    // No breakdown, but the panel title still anchors the section.
    expect(screen.queryByRole('img')).toBeNull();
    expect(
      screen.getByRole('heading', { name: 'Source Layers' }),
    ).toBeInTheDocument();
  });
});
