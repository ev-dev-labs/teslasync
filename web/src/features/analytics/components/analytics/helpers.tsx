import { GlassPanel } from '@/components/ui';
import { Skeleton } from '@/components/feedback';
import { cn } from '@/lib/cn';

/**
 * Single metric-card placeholder. Purely decorative shimmer, so it is
 * `aria-hidden` — the surrounding page owns the "loading" announcement and
 * assistive tech should skip the empty shell rather than read out two blank
 * rows for every card in the band.
 */
export function MetricSkeleton() {
  return (
    <GlassPanel className="p-3" aria-hidden="true">
      <Skeleton width="60%" height={12} />
      <Skeleton width="40%" height={24} className="mt-2" />
    </GlassPanel>
  );
}

/**
 * Skeleton grid standing in for a KPI/metric band while the fleet query loads.
 * Keeps the band's footprint stable so the layout doesn't jump when data lands.
 */
export function MetricBandSkeleton({
  count,
  className,
}: {
  count: number;
  className?: string;
}) {
  // Guard the render count. A non-finite `count` (e.g. Infinity leaking in from
  // a bad `total / 0` upstream) makes `Array.from({ length })` throw
  // RangeError, and a negative or fractional value is meaningless for a card
  // count — clamp to a whole, non-negative integer so the band degrades to
  // empty instead of crashing the whole analytics tab.
  const cardCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;

  return (
    <div
      aria-hidden="true"
      className={cn(
        'grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6',
        className,
      )}
    >
      {Array.from({ length: cardCount }).map((_, i) => (
        <MetricSkeleton key={i} />
      ))}
    </div>
  );
}
