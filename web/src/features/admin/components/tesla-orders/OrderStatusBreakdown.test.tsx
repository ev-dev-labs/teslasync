/**
 * OrderStatusBreakdown unit suite.
 *
 * Exercises the panel's full behaviour surface — never a smoke render, never
 * the real network:
 *
 *   • State-invariant chrome — the "Order Status" heading + its decorative
 *     (aria-hidden) PieChart glyph render in EVERY status because the header
 *     lives outside the per-section state switch (design-language §8).
 *   • loading — skeleton placeholder; the proportion bar + stat grid withheld.
 *   • error   — retriable QueryError; the Retry CTA invokes `onRetry`.
 *   • empty   — guidance copy + caller icon, no bar/grid.
 *   • ready   — the labelled proportion bar with one segment per non-empty
 *               bucket (widths ∝ share), and the five-card grid with each
 *               bucket's count, rounded percentage, and canonical `<Badge>`.
 *   • rounding — the card percentage uses Math.round (67% / 33%, not raw).
 *   • bar hygiene — a zero-count entry that slips into `buckets` is skipped
 *                   (the `pct <= 0` guard) and an unknown bucket key is skipped
 *                   without throwing (the `!meta` guard — a crash fix).
 *   • null-safety — undefined `buckets` / `byBucket` / `total` coalesce to
 *                   []/0 (the `?? []`, `?? {}`-access, `?? 0` hardening) so the
 *                   grid still renders five "0" cards instead of crashing.
 *
 * Follows the repo convention (see DeliveryOutlookPanel.test.tsx): `@/i18n`
 * loaded for real fallbacks, `fireEvent` for interaction (user-event is not a
 * dependency here), and a `MemoryRouter` wrapper because the error branch's
 * `<QueryError>` reaches for `useNavigate`.
 */
import '@/i18n';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ComponentProps } from 'react';

import { OrderStatusBreakdown } from './OrderStatusBreakdown';
import type {
  OrderStats,
  OrderStatusBucket,
  OrderBucketCount,
} from './teslaOrderStats';

function makeStats(overrides: Partial<OrderStats> = {}): OrderStats {
  const byBucket: Record<OrderStatusBucket, number> = {
    inProgress: 4,
    ready: 2,
    delivered: 3,
    cancelled: 1,
    other: 0,
  };
  const buckets: OrderBucketCount[] = [
    { bucket: 'inProgress', count: 4 },
    { bucket: 'ready', count: 2 },
    { bucket: 'delivered', count: 3 },
    { bucket: 'cancelled', count: 1 },
  ];
  return {
    total: 10,
    byBucket,
    buckets,
    delivered: 3,
    ready: 2,
    inProgress: 4,
    cancelled: 1,
    upgradable: 2,
    models: 2,
    withVin: 5,
    nextDelivery: null,
    ...overrides,
  };
}

type PanelProps = ComponentProps<typeof OrderStatusBreakdown>;

function renderPanel(overrides: Partial<PanelProps> = {}) {
  const props: PanelProps = {
    stats: makeStats(),
    status: 'ready',
    error: null,
    onRetry: vi.fn(),
    ...overrides,
  };
  const utils = render(
    <MemoryRouter>
      <OrderStatusBreakdown {...props} />
    </MemoryRouter>,
  );
  return { ...utils, props };
}

/** The proportion bar is exposed as a labelled `role="img"` region. */
function getBar() {
  return screen.getByRole('img', { name: 'Order status distribution' });
}

describe('OrderStatusBreakdown — state-invariant chrome', () => {
  it('renders the "Order Status" heading with a decorative icon in every status', () => {
    const statuses = ['loading', 'error', 'empty', 'ready'] as const;

    for (const status of statuses) {
      const { unmount } = renderPanel({
        status,
        error: status === 'error' ? new Error('boom') : null,
      });

      const heading = screen.getByRole('heading', { name: /order status/i });
      expect(heading).toBeInTheDocument();

      // The PieChart glyph is presentational — it must stay out of the
      // accessible name, so it carries aria-hidden.
      const icon = heading.querySelector('svg');
      expect(icon).not.toBeNull();
      expect(icon?.getAttribute('aria-hidden')).toBe('true');

      unmount();
    }
  });
});

describe('OrderStatusBreakdown — loading', () => {
  it('renders a skeleton placeholder and withholds the bar + stat grid', () => {
    const { container } = renderPanel({ status: 'loading' });

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    // Neither the proportion bar nor any bucket badge should be present.
    expect(
      screen.queryByRole('img', { name: /distribution/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Delivered')).toBeNull();
  });
});

describe('OrderStatusBreakdown — error', () => {
  it('surfaces a retriable error and invokes onRetry when Retry is clicked', () => {
    const onRetry = vi.fn();
    renderPanel({ status: 'error', error: new Error('kaboom'), onRetry });

    expect(screen.getByRole('alert')).toBeInTheDocument();

    const retry = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retry);

    expect(onRetry).toHaveBeenCalledTimes(1);
    // The distribution must not render behind the error affordance.
    expect(
      screen.queryByRole('img', { name: /distribution/i }),
    ).not.toBeInTheDocument();
  });
});

describe('OrderStatusBreakdown — empty', () => {
  it('renders the empty affordance with the caller icon + guidance copy and no grid', () => {
    renderPanel({
      status: 'empty',
      emptyIcon: <svg data-testid="empty-icon" aria-hidden="true" />,
    });

    expect(
      screen.getByText('No orders to classify yet.'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('empty-icon')).toBeInTheDocument();
    expect(screen.queryByText('Cancelled')).toBeNull();
    expect(
      screen.queryByRole('img', { name: /distribution/i }),
    ).not.toBeInTheDocument();
  });
});

describe('OrderStatusBreakdown — ready (populated)', () => {
  it('draws one proportion segment per non-empty bucket with share-proportional widths', () => {
    renderPanel();

    const bar = getBar();
    // inProgress/ready/delivered/cancelled are non-empty; "other" (0) is not.
    expect(bar.children).toHaveLength(4);

    const widths = Array.from(bar.children).map(
      (el) => (el as HTMLElement).style.width,
    );
    // 4/10, 2/10, 3/10, 1/10 of a 10-order account.
    expect(widths).toEqual(['40%', '20%', '30%', '10%']);
  });

  it('renders every bucket card with its label, count and rounded percentage', () => {
    renderPanel();

    // All five canonical badges — including the zero-count "Other".
    for (const label of [
      'In Progress',
      'Ready · In Transit',
      'Delivered',
      'Cancelled',
      'Other',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    // Counts (Text) are distinct from percentages (Caption, "%"-suffixed).
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();

    // Percentages: 40 / 20 / 30 / 10 / 0.
    expect(screen.getByText('40%')).toBeInTheDocument();
    expect(screen.getByText('30%')).toBeInTheDocument();
    expect(screen.getByText('0%')).toBeInTheDocument();
  });
});

describe('OrderStatusBreakdown — ready (percentage rounding)', () => {
  it('rounds thirds to whole percents (67% / 33%) rather than truncating', () => {
    renderPanel({
      stats: makeStats({
        total: 3,
        byBucket: {
          inProgress: 2,
          ready: 0,
          delivered: 1,
          cancelled: 0,
          other: 0,
        },
        buckets: [
          { bucket: 'inProgress', count: 2 },
          { bucket: 'delivered', count: 1 },
        ],
      }),
    });

    expect(screen.getByText('67%')).toBeInTheDocument();
    expect(screen.getByText('33%')).toBeInTheDocument();
  });
});

describe('OrderStatusBreakdown — bar hygiene', () => {
  it('skips a zero-count entry that slips into buckets (pct <= 0 guard)', () => {
    renderPanel({
      stats: makeStats({
        total: 5,
        buckets: [
          { bucket: 'inProgress', count: 5 },
          { bucket: 'ready', count: 0 },
        ],
      }),
    });

    const bar = getBar();
    expect(bar.children).toHaveLength(1);
    expect((bar.children[0] as HTMLElement).style.width).toBe('100%');
  });

  it('skips an unknown bucket key without throwing (the !meta crash guard)', () => {
    renderPanel({
      stats: makeStats({
        total: 6,
        buckets: [
          { bucket: 'bogus' as OrderStatusBucket, count: 3 },
          { bucket: 'delivered', count: 3 },
        ],
      }),
    });

    const bar = getBar();
    // The unknown segment is dropped; only the recognised one survives.
    expect(bar.children).toHaveLength(1);
    expect((bar.children[0] as HTMLElement).style.width).toBe('50%');
  });
});

describe('OrderStatusBreakdown — null-safety hardening', () => {
  it('coalesces undefined buckets/byBucket/total to []/0 instead of crashing', () => {
    const malformed = {
      ...makeStats(),
      buckets: undefined,
      byBucket: undefined,
      total: undefined,
    } as unknown as OrderStats;

    renderPanel({ stats: malformed });

    // The bar still renders (labelled) but has no segments.
    const bar = getBar();
    expect(bar.children).toHaveLength(0);

    // Every one of the five bucket cards falls back to a "0" count + "0%".
    expect(screen.getAllByText('0')).toHaveLength(5);
    expect(screen.getAllByText('0%')).toHaveLength(5);

    // And the grid still shows all five canonical labels.
    const other = screen.getByText('Other');
    expect(within(other).queryByText(/undefined/i)).toBeNull();
  });
});
