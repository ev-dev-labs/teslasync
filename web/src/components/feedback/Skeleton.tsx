import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  width?: string;
  height?: number | string;
  rounded?: boolean;
  lines?: number;
}

export function Skeleton({ width, height, rounded, lines = 1, className, style, ...props }: SkeletonProps) {
  // Normalise `lines` to a safe positive integer. Guards against callers
  // passing a fractional value (which would leave the "last line is 60% wide"
  // branch below unreachable) or a non-finite value like Infinity (which would
  // make `Array.from({ length })` throw a RangeError and crash the tree).
  const lineCount = Math.max(1, Number.isFinite(lines) ? Math.floor(lines) : 1);

  if (lineCount > 1) {
    return (
      // Decorative placeholder — hidden from assistive tech. The surrounding
      // loading region (PageContainer / *Skeleton wrappers) owns the
      // role="status"/aria-busy announcement. Static source-shaped boxes remain
      // distinct from real content without an ambient pulse, including in
      // reduced-motion and low-bandwidth modes.
      <div {...props} className={cn('space-y-2', className)} style={style} aria-hidden="true">
        {Array.from({ length: lineCount }).map((_, i) => (
          <div
            key={i}
            className="h-4 rounded bg-[var(--skeleton-bg)]"
            style={{
              width: i === lineCount - 1 ? '60%' : width ?? '100%',
              ...(height !== undefined ? { height } : {}),
            }}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      {...props}
      aria-hidden="true"
      className={cn(
        'h-4 w-full bg-[var(--skeleton-bg)]',
        rounded ? 'rounded-full' : 'rounded',
        className,
      )}
      style={{
        ...style,
        ...(width !== undefined ? { width } : {}),
        ...(height !== undefined ? { height } : {}),
      }}
    />
  );
}
