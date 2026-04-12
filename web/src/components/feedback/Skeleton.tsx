import { cn } from '@/lib/cn';

interface SkeletonProps {
  width?: string;
  height?: number | string;
  rounded?: boolean;
  lines?: number;
  className?: string;
}

export function Skeleton({ width, height = 16, rounded, lines = 1, className }: SkeletonProps) {
  if (lines > 1) {
    return (
      <div className={cn('space-y-2', className)}>
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className="animate-pulse rounded bg-gray-200 dark:bg-gray-700"
            style={{ width: i === lines - 1 ? '60%' : width ?? '100%', height }}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'animate-pulse bg-gray-200 dark:bg-gray-700',
        rounded ? 'rounded-full' : 'rounded',
        className,
      )}
      style={{ width: width ?? '100%', height }}
    />
  );
}
