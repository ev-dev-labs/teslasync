import { cn } from '@/lib/cn';

interface SkeletonProps {
  width?: string;
  height?: number | string;
  rounded?: boolean;
  lines?: number;
  className?: string;
}

export function Skeleton({ width, height = 16, rounded, lines = 1, className }: SkeletonProps) {
  // Normalise `lines` to a safe positive integer. Guards against callers
  // passing a fractional value (which would leave the "last line is 60% wide"
  // branch below unreachable) or a non-finite value like Infinity (which would
  // make `Array.from({ length })` throw a RangeError and crash the tree).
  const lineCount = Math.max(1, Number.isFinite(lines) ? Math.floor(lines) : 1);

  if (lineCount > 1) {
    return (
      // Decorative placeholder — hidden from assistive tech. The surrounding
      // loading region (PageContainer / *Skeleton wrappers) owns the
      // role="status"/aria-busy announcement, so the pulsing boxes must not be
      // traversed individually by screen readers.
      <div className={cn('space-y-2', className)} aria-hidden="true">
        {Array.from({ length: lineCount }).map((_, i) => (
          <div
            key={i}
            className="animate-pulse rounded bg-[var(--skeleton-bg)]"
            style={{ width: i === lineCount - 1 ? '60%' : width ?? '100%', height }}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      aria-hidden="true"
      className={cn(
        'animate-pulse bg-[var(--skeleton-bg)]',
        rounded ? 'rounded-full' : 'rounded',
        className,
      )}
      style={{ width: width ?? '100%', height }}
    />
  );
}
