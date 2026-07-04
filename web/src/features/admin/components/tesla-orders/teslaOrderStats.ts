/**
 * Pure, null-safe derivations for the Tesla Orders page.
 *
 * The backend `GET /tesla/user/orders` handler returns the vehicle orders
 * pulled from the owner's Tesla account (`{ orders, fetched_at }`). Every
 * consumer on the page (KPI band, status breakdown, delivery outlook, board,
 * table) reads from the aggregates + normalised buckets produced here so the
 * classification logic lives in exactly one tested place.
 */
import type { TeslaOrder } from '@/api/hooks/useUser';

/** Discriminates the render state of each self-sufficient page section. */
export type OrderSectionStatus = 'loading' | 'error' | 'empty' | 'ready';

/** High-level lifecycle buckets an order status maps onto. */
export type OrderStatusBucket =
  | 'inProgress'
  | 'ready'
  | 'delivered'
  | 'cancelled'
  | 'other';

/** Stable display order for the breakdown (early lifecycle → terminal). */
export const ORDER_BUCKET_ORDER: readonly OrderStatusBucket[] = [
  'inProgress',
  'ready',
  'delivered',
  'cancelled',
  'other',
];

type BadgeVariant = 'info' | 'success' | 'warning' | 'danger' | 'neutral';

interface OrderBucketMeta {
  /** i18n key + fallback shared by the breakdown, board and table. */
  key: string;
  fallback: string;
  /** Solid Tailwind background for the proportion bar segment. */
  bar: string;
  /** Toned dot colour for the breakdown legend. */
  dot: string;
  /** Canonical `<Badge>` variant so colour language stays consistent. */
  badge: BadgeVariant;
}

export const ORDER_BUCKET_META: Record<OrderStatusBucket, OrderBucketMeta> = {
  inProgress: {
    key: 'admin.teslaOrders.bucket.inProgress',
    fallback: 'In Progress',
    bar: 'bg-amber-500',
    dot: 'bg-amber-400',
    badge: 'warning',
  },
  ready: {
    key: 'admin.teslaOrders.bucket.ready',
    fallback: 'Ready · In Transit',
    bar: 'bg-sky-500',
    dot: 'bg-sky-400',
    badge: 'info',
  },
  delivered: {
    key: 'admin.teslaOrders.bucket.delivered',
    fallback: 'Delivered',
    bar: 'bg-emerald-500',
    dot: 'bg-emerald-400',
    badge: 'success',
  },
  cancelled: {
    key: 'admin.teslaOrders.bucket.cancelled',
    fallback: 'Cancelled',
    bar: 'bg-rose-500',
    dot: 'bg-rose-400',
    badge: 'danger',
  },
  other: {
    key: 'admin.teslaOrders.bucket.other',
    fallback: 'Other',
    bar: 'bg-slate-500',
    dot: 'bg-slate-400',
    badge: 'neutral',
  },
};

/**
 * Map any raw Tesla order status onto a lifecycle bucket. Cancellation and
 * "ready for delivery" are checked before the bare `DELIVER` substring so a
 * `READY_FOR_DELIVERY` order is classified as *ready*, not *delivered*.
 */
export function bucketOfStatus(
  status: string | null | undefined,
): OrderStatusBucket {
  if (!status) return 'other';
  const s = status.toUpperCase();
  if (s.includes('CANCEL') || s.includes('REJECT')) return 'cancelled';
  if (s.includes('READY') || s.includes('TRANSPORT') || s.includes('TRANSIT')) {
    return 'ready';
  }
  if (s.includes('DELIVER')) return 'delivered';
  if (
    s.includes('PENDING') ||
    s.includes('ORDER') ||
    s.includes('BOOK') ||
    s.includes('PREP') ||
    s.includes('PRODUCTION') ||
    s.includes('BUILD')
  ) {
    return 'inProgress';
  }
  return 'other';
}

/** Canonical `<Badge>` variant for a raw status, derived via its bucket. */
export function orderStatusVariant(
  status: string | null | undefined,
): BadgeVariant {
  return ORDER_BUCKET_META[bucketOfStatus(status)].badge;
}

/** Human-friendly title-case rendering of a raw `SNAKE_CASE` status. */
export function formatOrderStatus(status: string | null | undefined): string {
  if (!status) return '—';
  return status
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export interface OrderBucketCount {
  bucket: OrderStatusBucket;
  count: number;
}

export interface OrderStats {
  total: number;
  byBucket: Record<OrderStatusBucket, number>;
  /** Ordered, non-empty bucket counts for the proportion bar + legend. */
  buckets: OrderBucketCount[];
  delivered: number;
  ready: number;
  inProgress: number;
  cancelled: number;
  upgradable: number;
  /** Distinct vehicle models across all orders. */
  models: number;
  /** Orders that already have a VIN assigned. */
  withVin: number;
  /** ISO date of the soonest upcoming delivery, or null when none. */
  nextDelivery: string | null;
}

const emptyBuckets = (): Record<OrderStatusBucket, number> => ({
  inProgress: 0,
  ready: 0,
  delivered: 0,
  cancelled: 0,
  other: 0,
});

/** Compute every page-level aggregate in a single pass. Always null-safe. */
export function computeOrderStats(
  orders: TeslaOrder[] | null | undefined,
): OrderStats {
  const list = (orders ?? []).filter(Boolean);
  const byBucket = emptyBuckets();
  const modelSet = new Set<string>();
  let upgradable = 0;
  let withVin = 0;
  let nextDelivery: string | null = null;
  let nextMs = Number.POSITIVE_INFINITY;
  const now = Date.now();

  for (const order of list) {
    byBucket[bucketOfStatus(order.status)] += 1;
    if (order.model) modelSet.add(order.model);
    if (order.is_upgradable) upgradable += 1;
    if (order.vin) withVin += 1;
    if (order.delivery_date) {
      const ms = Date.parse(order.delivery_date);
      if (!Number.isNaN(ms) && ms >= now && ms < nextMs) {
        nextMs = ms;
        nextDelivery = order.delivery_date;
      }
    }
  }

  const buckets = ORDER_BUCKET_ORDER.map((bucket) => ({
    bucket,
    count: byBucket[bucket],
  })).filter((b) => b.count > 0);

  return {
    total: list.length,
    byBucket,
    buckets,
    delivered: byBucket.delivered,
    ready: byBucket.ready,
    inProgress: byBucket.inProgress,
    cancelled: byBucket.cancelled,
    upgradable,
    models: modelSet.size,
    withVin,
    nextDelivery,
  };
}
