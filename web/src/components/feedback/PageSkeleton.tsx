import { type CSSProperties } from 'react';
import { Skeleton } from './Skeleton';
import { cn } from '@/lib/cn';

/**
 * Shaped page-skeleton building blocks.
 *
 * These primitives mirror the *structure* of common page sections so the
 * loading UI claims the same vertical/horizontal space as the real content.
 * That keeps Cumulative Layout Shift (CLS) close to zero and turns the
 * perceived load from "empty → suddenly full" into "loading → ready".
 *
 * Each block is announced as `role="status" aria-busy="true"` so screen
 * readers can identify the loading region. Visual styling re-uses the
 * existing `<Skeleton>` primitive (animate-pulse + token-driven background).
 */

interface BlockProps {
  className?: string;
}

/** Mirrors `<PageContainer>`'s title + subtitle row. */
export function PageHeaderSkeleton({ className }: BlockProps) {
  return (
    <div
      className={cn('space-y-2', className)}
      role="status"
      aria-busy="true"
      aria-label="Loading page header"
      data-testid="page-header-skeleton"
    >
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-4 w-96 max-w-full" />
    </div>
  );
}

interface StatGridSkeletonProps extends BlockProps {
  /** How many stat cards to render. Defaults to 4. */
  cards?: number;
}

/**
 * 2-column on mobile, 4-column on md+. Matches the typical
 * `<div className="grid grid-cols-2 md:grid-cols-4">` stat-card row used
 * across detail and analytics pages.
 */
export function StatGridSkeleton({ cards = 4, className }: StatGridSkeletonProps) {
  return (
    <div
      className={cn('grid grid-cols-2 md:grid-cols-4 gap-4', className)}
      role="status"
      aria-busy="true"
      aria-label="Loading stat cards"
      data-testid="stat-grid-skeleton"
    >
      {Array.from({ length: cards }).map((_, i) => (
        <Skeleton key={i} className="h-24 rounded-xl" />
      ))}
    </div>
  );
}

interface ChartBlockSkeletonProps extends BlockProps {
  /** Pixel height of the chart placeholder. Defaults to 320. */
  height?: number;
}

/**
 * Single rectangular placeholder sized to a chart container. Use for any
 * `<ChartContainer>` / `<ResponsiveContainer>` panel. Distinct from the
 * existing `<ChartSkeleton>` (which renders animated bars suitable for
 * dashboard widgets) — this one is a layout-preserving box.
 */
export function ChartBlockSkeleton({ height = 320, className }: ChartBlockSkeletonProps) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading chart"
      data-testid="chart-block-skeleton"
      className={cn('w-full', className)}
    >
      <Skeleton className="rounded-xl" height={height} />
    </div>
  );
}

interface TableSkeletonProps extends BlockProps {
  /** Number of body rows to render. Defaults to 8. */
  rows?: number;
  /** Number of columns. Defaults to 4. */
  cols?: number;
}

/** Table-shaped skeleton: header row + N body rows × M columns. */
export function TableSkeleton({ rows = 8, cols = 4, className }: TableSkeletonProps) {
  const gridStyle: CSSProperties = { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` };
  return (
    <div
      className={cn('space-y-2', className)}
      role="status"
      aria-busy="true"
      aria-label="Loading table"
      data-testid="table-skeleton"
    >
      <Skeleton className="h-10 rounded-t-xl" />
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="grid gap-3" style={gridStyle}>
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className="h-8 rounded" />
          ))}
        </div>
      ))}
    </div>
  );
}
