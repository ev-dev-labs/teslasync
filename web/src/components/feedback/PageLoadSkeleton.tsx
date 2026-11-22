import { useTranslation } from 'react-i18next';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { cn } from '@/lib/cn';
import { Skeleton } from './Skeleton';

interface PageLoadSkeletonProps {
  /** How many GlassPanel-shaped skeleton blocks to render below the header. Defaults to 3. */
  panels?: number;
  className?: string;
  /** Hide the placeholder title when the real page header is already visible. */
  showHeader?: boolean;
  /** Accessible loading label. Defaults to the shared translated loading copy. */
  label?: string;
}

/**
 * Layout-shaped Suspense fallback used while a lazy-loaded route chunk is being
 * fetched. Mirrors the typical PageContainer layout (heading bar + a few panels)
 * so the UI doesn't reflow when the real page mounts, keeping CLS low while
 * route chunks stream in.
 */
export function PageLoadSkeleton({
  panels = 3,
  className,
  showHeader = true,
  label,
}: PageLoadSkeletonProps) {
  const { t } = useTranslation();
  const loadingLabel = label?.trim() || t('common.loading', 'Loading…');

  return (
    <div
      className={cn('min-w-0 space-y-5', className)}
      role="status"
      aria-busy="true"
      aria-label={loadingLabel}
      data-testid="page-load-skeleton"
      data-app-part="loading"
    >
      {showHeader && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-2">
            <div data-app-part="skeleton" className="h-7 w-48 max-w-full rounded bg-[var(--surface-2)]" />
            <div data-app-part="skeleton" className="h-3 w-72 max-w-full rounded bg-[var(--surface-2)]" />
          </div>
          <div data-app-part="skeleton" className="h-9 w-32 max-w-full rounded bg-[var(--surface-2)]" />
        </div>
      )}

      {/* Body panels */}
      {Array.from({ length: panels }).map((_, i) => (
        <GlassPanel data-app-part="panel" key={i} className="p-6">
          <div className="space-y-4">
            <div data-app-part="skeleton" className="h-5 w-40 rounded bg-[var(--surface-2)]" />
            <div data-app-part="metric-grid" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div data-app-part="skeleton" className="h-20 rounded bg-[var(--surface-2)]" />
              <div data-app-part="skeleton" className="h-20 rounded bg-[var(--surface-2)]" />
              <div data-app-part="skeleton" className="h-20 rounded bg-[var(--surface-2)]" />
            </div>
            <div data-app-part="skeleton" aria-hidden="true" className="grid h-32 grid-rows-3 gap-2 rounded border border-[var(--border-subtle)] p-3">
              {['w-3/4', 'w-2/3', 'w-4/5'].map(width => (
                <div key={width} className="grid grid-cols-[3fr_1fr] gap-3 border-b border-[var(--border-subtle)] last:border-b-0">
                  <Skeleton className={cn('h-2.5', width)} />
                  <Skeleton className="h-2.5" />
                </div>
              ))}
            </div>
          </div>
        </GlassPanel>
      ))}
    </div>
  );
}
