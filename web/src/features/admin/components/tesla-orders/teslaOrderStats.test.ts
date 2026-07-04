// Behavioural contract for the Tesla Orders derivation module.
//
// teslaOrderStats.ts is the single tested home for the classification and
// aggregation logic every section of the Tesla Orders page reads from (KPI
// band, status breakdown, delivery outlook, board, table). These tests pin the
// facets that matter: the status→bucket mapping precedence (cancellation and
// "ready" win over the bare DELIVER substring), the canonical <Badge> variant
// derivation, SNAKE_CASE title-casing with its em-dash fallback, the stable
// bucket ordering + colour metadata, and — the crux — that computeOrderStats
// aggregates a single pass correctly, honours its "Always null-safe" docstring
// on null/undefined/hole-laden input, and picks the soonest *future* delivery
// while ignoring past and unparseable dates.
//
// Pure module: no DOM, no providers, no network. Date.now()-sensitive branches
// (nextDelivery) run under fake timers pinned to a fixed instant so the
// >= now boundary is deterministic.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  ORDER_BUCKET_ORDER,
  ORDER_BUCKET_META,
  bucketOfStatus,
  orderStatusVariant,
  formatOrderStatus,
  computeOrderStats,
} from './teslaOrderStats';
import type {
  OrderSectionStatus,
  OrderStatusBucket,
  OrderBucketCount,
  OrderStats,
} from './teslaOrderStats';
import type { TeslaOrder } from '@/api/hooks/useUser';

function makeOrder(overrides: Partial<TeslaOrder> = {}): TeslaOrder {
  return {
    id: 1,
    order_id: 'RN100000001',
    model: 'Model 3',
    status: 'BOOKED',
    delivery_date: null,
    vin: null,
    referral_code: null,
    is_upgradable: false,
    fetched_at: '2025-01-01T00:00:00Z',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('ORDER_BUCKET_ORDER + ORDER_BUCKET_META', () => {
  it('lists the five lifecycle buckets from early to terminal', () => {
    expect(ORDER_BUCKET_ORDER).toEqual([
      'inProgress',
      'ready',
      'delivered',
      'cancelled',
      'other',
    ]);
  });

  it('has complete, self-consistent metadata for every ordered bucket', () => {
    for (const bucket of ORDER_BUCKET_ORDER) {
      const meta = ORDER_BUCKET_META[bucket];
      expect(meta).toBeDefined();
      // i18n key is namespaced and carries a non-empty English fallback.
      expect(meta.key).toContain(`admin.teslaOrders.bucket.${bucket}`);
      expect(meta.fallback.length).toBeGreaterThan(0);
      // Every colour token is a real Tailwind bg-* utility.
      expect(meta.bar).toMatch(/^bg-/);
      expect(meta.dot).toMatch(/^bg-/);
    }
  });

  it('maps each bucket onto the expected canonical Badge variant', () => {
    expect(ORDER_BUCKET_META.inProgress.badge).toBe('warning');
    expect(ORDER_BUCKET_META.ready.badge).toBe('info');
    expect(ORDER_BUCKET_META.delivered.badge).toBe('success');
    expect(ORDER_BUCKET_META.cancelled.badge).toBe('danger');
    expect(ORDER_BUCKET_META.other.badge).toBe('neutral');
  });
});

describe('bucketOfStatus', () => {
  it('treats a missing status as "other"', () => {
    expect(bucketOfStatus(null)).toBe('other');
    expect(bucketOfStatus(undefined)).toBe('other');
    expect(bucketOfStatus('')).toBe('other');
  });

  it('classifies cancellation and rejection ahead of everything else', () => {
    expect(bucketOfStatus('CANCELLED')).toBe('cancelled');
    expect(bucketOfStatus('order_rejected')).toBe('cancelled');
    // Cancel wins even when the raw status also mentions delivery.
    expect(bucketOfStatus('DELIVERY_CANCELLED')).toBe('cancelled');
  });

  it('classifies ready / in-transit before the bare DELIVER substring', () => {
    expect(bucketOfStatus('READY_FOR_DELIVERY')).toBe('ready');
    expect(bucketOfStatus('IN_TRANSIT')).toBe('ready');
    expect(bucketOfStatus('TRANSPORT_SCHEDULED')).toBe('ready');
  });

  it('classifies a plain delivered status as "delivered"', () => {
    expect(bucketOfStatus('DELIVERED')).toBe('delivered');
    expect(bucketOfStatus('delivered')).toBe('delivered');
  });

  it('classifies the early-lifecycle keywords as "inProgress"', () => {
    for (const s of [
      'PENDING',
      'ORDER_PLACED',
      'BOOKED',
      'PREPARING',
      'IN_PRODUCTION',
      'BUILD_SCHEDULED',
    ]) {
      expect(bucketOfStatus(s)).toBe('inProgress');
    }
  });

  it('is case-insensitive and defaults unknown statuses to "other"', () => {
    expect(bucketOfStatus('cancelled')).toBe('cancelled');
    expect(bucketOfStatus('SOMETHING_WEIRD')).toBe('other');
  });
});

describe('orderStatusVariant', () => {
  it('derives the Badge variant through the status bucket', () => {
    expect(orderStatusVariant('DELIVERED')).toBe('success');
    expect(orderStatusVariant('READY_FOR_DELIVERY')).toBe('info');
    expect(orderStatusVariant('CANCELLED')).toBe('danger');
    expect(orderStatusVariant('IN_PRODUCTION')).toBe('warning');
  });

  it('falls back to the neutral variant for missing/unknown statuses', () => {
    expect(orderStatusVariant(null)).toBe('neutral');
    expect(orderStatusVariant('WAT')).toBe('neutral');
  });
});

describe('formatOrderStatus', () => {
  it('returns the em-dash placeholder for an absent status', () => {
    expect(formatOrderStatus(null)).toBe('—');
    expect(formatOrderStatus(undefined)).toBe('—');
    expect(formatOrderStatus('')).toBe('—');
  });

  it('title-cases a SNAKE_CASE status into a human label', () => {
    expect(formatOrderStatus('READY_FOR_DELIVERY')).toBe('Ready For Delivery');
    expect(formatOrderStatus('IN_PRODUCTION')).toBe('In Production');
    expect(formatOrderStatus('DELIVERED')).toBe('Delivered');
  });
});

describe('computeOrderStats', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a fully-zeroed, null-safe shape for an empty array', () => {
    const stats: OrderStats = computeOrderStats([]);
    expect(stats.total).toBe(0);
    expect(stats.buckets).toEqual([]);
    expect(stats.byBucket).toEqual({
      inProgress: 0,
      ready: 0,
      delivered: 0,
      cancelled: 0,
      other: 0,
    });
    expect(stats.models).toBe(0);
    expect(stats.withVin).toBe(0);
    expect(stats.upgradable).toBe(0);
    expect(stats.nextDelivery).toBeNull();
  });

  it('honours its "Always null-safe" contract on null/undefined input', () => {
    // Callers are typed to pass an array, but a runtime null/undefined must not
    // throw on `for…of` / `.length` — that would take the whole page down.
    expect(() => computeOrderStats(null)).not.toThrow();
    expect(() => computeOrderStats(undefined)).not.toThrow();
    expect(computeOrderStats(null).total).toBe(0);
    expect(computeOrderStats(undefined).buckets).toEqual([]);
  });

  it('is null-safe against holes inside the orders array', () => {
    const withHoles = [
      makeOrder({ status: 'DELIVERED' }),
      null,
      undefined,
      makeOrder({ status: 'BOOKED' }),
    ] as unknown as TeslaOrder[];
    const stats = computeOrderStats(withHoles);
    // Holes are dropped from both the pass and the total.
    expect(stats.total).toBe(2);
    expect(stats.delivered).toBe(1);
    expect(stats.inProgress).toBe(1);
  });

  it('aggregates buckets, models, VINs and upgrades in a single pass', () => {
    const orders = [
      makeOrder({ id: 1, status: 'IN_PRODUCTION', model: 'Model 3', vin: null }),
      makeOrder({ id: 2, status: 'BOOKED', model: 'Model 3', is_upgradable: true }),
      makeOrder({ id: 3, status: 'READY_FOR_DELIVERY', model: 'Model Y', vin: '5YJ...' }),
      makeOrder({ id: 4, status: 'DELIVERED', model: 'Model S', vin: '5YJS...' }),
      makeOrder({ id: 5, status: 'CANCELLED', model: '', is_upgradable: true }),
    ];

    const stats = computeOrderStats(orders);

    expect(stats.total).toBe(5);
    expect(stats.inProgress).toBe(2);
    expect(stats.ready).toBe(1);
    expect(stats.delivered).toBe(1);
    expect(stats.cancelled).toBe(1);
    // Distinct, non-empty models only (Model 3 counted once; '' ignored).
    expect(stats.models).toBe(3);
    expect(stats.withVin).toBe(2);
    expect(stats.upgradable).toBe(2);
  });

  it('emits only non-empty buckets, in the canonical lifecycle order', () => {
    const orders = [
      makeOrder({ id: 1, status: 'DELIVERED' }),
      makeOrder({ id: 2, status: 'IN_PRODUCTION' }),
      makeOrder({ id: 3, status: 'DELIVERED' }),
    ];

    const buckets: OrderBucketCount[] = computeOrderStats(orders).buckets;

    // inProgress precedes delivered per ORDER_BUCKET_ORDER; ready/cancelled/other
    // are absent because their counts are zero.
    expect(buckets).toEqual([
      { bucket: 'inProgress', count: 1 },
      { bucket: 'delivered', count: 2 },
    ]);
  });

  it('picks the soonest future delivery and ignores past / unparseable dates', () => {
    const orders = [
      makeOrder({ id: 1, delivery_date: '2024-06-15T00:00:00Z' }), // past — ignored
      makeOrder({ id: 2, delivery_date: '2025-09-01T00:00:00Z' }), // future
      makeOrder({ id: 3, delivery_date: '2025-06-15T00:00:00Z' }), // sooner future
      makeOrder({ id: 4, delivery_date: 'not-a-date' }), // NaN — ignored
      makeOrder({ id: 5, delivery_date: null }), // absent — ignored
    ];

    const stats = computeOrderStats(orders);
    expect(stats.nextDelivery).toBe('2025-06-15T00:00:00Z');
  });

  it('reports no next delivery when every delivery date is in the past', () => {
    const orders = [
      makeOrder({ id: 1, delivery_date: '2020-01-01T00:00:00Z' }),
      makeOrder({ id: 2, delivery_date: '2019-05-05T00:00:00Z' }),
    ];
    expect(computeOrderStats(orders).nextDelivery).toBeNull();
  });
});

describe('exported types', () => {
  it('surface the section-status and bucket discriminators to consumers', () => {
    const status: OrderSectionStatus = 'ready';
    const bucket: OrderStatusBucket = 'delivered';
    const count: OrderBucketCount = { bucket, count: 3 };

    expect(status).toBe('ready');
    expect(ORDER_BUCKET_ORDER).toContain(bucket);
    expect(count.count).toBe(3);
  });
});
