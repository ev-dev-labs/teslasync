import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { Skeleton } from './Skeleton';

export interface ListSkeletonProps {
  rows?: number;
  label?: string;
  className?: string;
  testId?: string;
}

/** Layout-preserving placeholder for feeds, drawers, and compact record lists. */
export function ListSkeleton({
  rows = 4,
  label,
  className,
  testId = 'list-skeleton',
}: ListSkeletonProps) {
  const { t } = useTranslation();
  const rowCount = Number.isFinite(rows) ? Math.max(0, Math.trunc(rows)) : 4;
  const loadingLabel = label?.trim() || t('common.loading', 'Loading…');

  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={loadingLabel}
      className={cn('space-y-3', className)}
      data-testid={testId}
    >
      {Array.from({ length: rowCount }).map((_, index) => (
        <div
          key={index}
          aria-hidden="true"
          className="flex min-h-16 items-center gap-3 rounded-shape-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
        >
          <Skeleton rounded className="h-9 w-9 shrink-0" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-5/6" />
          </div>
          <Skeleton className="h-8 w-16 shrink-0" />
        </div>
      ))}
    </div>
  );
}
