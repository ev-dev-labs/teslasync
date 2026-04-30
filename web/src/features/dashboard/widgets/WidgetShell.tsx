import { type ReactNode, useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/cn';
import { Skeleton, QueryError } from '@/components/feedback';
import { DataFreshness } from '../components/DataFreshness';

interface WidgetShellProps {
  title?: string;
  icon?: ReactNode;
  loading?: boolean;
  error?: string | null;
  children: ReactNode;
  noPadding?: boolean;
  actions?: ReactNode;
  /** Freshness: ms timestamp from dataUpdatedAt (0 = never) */
  updatedAt?: number;
  /** Is TanStack Query currently fetching in the background? */
  isFetching?: boolean;
  /** Has the query data gone stale? */
  isStale?: boolean;
  /** Is the query in an error state? */
  isError?: boolean;
  /** Callback to manually refetch the widget data */
  onRefresh?: () => void;
}

export function WidgetShell({
  title, icon, loading, error, children, noPadding, actions,
  updatedAt, isFetching, isStale, isError, onRefresh,
}: WidgetShellProps) {
  // Pulse animation on data change
  const [justUpdated, setJustUpdated] = useState(false);
  const prevUpdatedAt = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (
      updatedAt &&
      updatedAt > 0 &&
      prevUpdatedAt.current !== undefined &&
      prevUpdatedAt.current !== updatedAt
    ) {
      setJustUpdated(true);
      const timer = setTimeout(() => setJustUpdated(false), 1500);
      prevUpdatedAt.current = updatedAt;
      return () => clearTimeout(timer);
    }
    prevUpdatedAt.current = updatedAt;
  }, [updatedAt]);

  if (loading) return <Skeleton className="h-full rounded-xl" />;
  if (error) return (
    <div className="h-full flex items-center justify-center p-4">
      <QueryError error={new Error(error)} />
    </div>
  );

  const showFreshness = updatedAt !== undefined;
  // Compact (dot-only) when widget has no title (typically 1×1 widgets)
  const freshnessCompact = !title;

  const freshnessEl = showFreshness ? (
    <DataFreshness
      updatedAt={updatedAt > 0 ? updatedAt : null}
      isFetching={isFetching ?? false}
      isStale={isStale ?? false}
      isError={isError ?? false}
      onRefresh={onRefresh}
      compact={freshnessCompact}
    />
  ) : null;

  return (
    <div
      className={cn(
        'relative h-full flex flex-col transition-shadow duration-500',
        justUpdated && 'shadow-[0_0_12px_rgba(34,197,94,0.15)]',
      )}
    >
      {title ? (
        <div className="flex-shrink-0 flex items-center justify-between px-4 pt-3 pb-1">
          <div className="flex items-center gap-1.5">
            {icon}
            <h3 className="text-[11px] font-medium text-white/40 uppercase tracking-wider">{title}</h3>
          </div>
          <div className="flex items-center gap-2">
            {freshnessEl}
            {actions}
          </div>
        </div>
      ) : (
        <>
          {/* Overlay freshness indicator for title-less widgets */}
          {freshnessEl && (
            <div className="absolute top-1.5 right-1.5 z-[5]">
              {freshnessEl}
            </div>
          )}
          {actions && (
            <div className="flex-shrink-0 flex justify-end px-4 pt-3 pb-1">
              {actions}
            </div>
          )}
        </>
      )}
      <div className={cn('flex-1 min-h-0', !noPadding ? 'px-4 pb-3 overflow-auto' : 'overflow-hidden')}>
        {children}
      </div>
    </div>
  );
}
