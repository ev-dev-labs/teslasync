import { useTranslation } from 'react-i18next';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { cn } from '@/lib/cn';

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
      className={cn('space-y-5 animate-pulse', className)}
      role="status"
      aria-busy="true"
      aria-label={loadingLabel}
      data-testid="page-load-skeleton"
    >
      {showHeader && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="h-7 w-48 rounded bg-[var(--surface-2)]" />
            <div className="h-3 w-72 max-w-full rounded bg-[var(--surface-2)]" />
          </div>
          <div className="h-9 w-32 rounded bg-[var(--surface-2)]" />
        </div>
      )}

      {/* Body panels */}
      {Array.from({ length: panels }).map((_, i) => (
        <GlassPanel key={i} className="p-6">
          <div className="space-y-4">
            <div className="h-5 w-40 rounded bg-[var(--surface-2)]" />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="h-20 rounded bg-[var(--surface-2)]" />
              <div className="h-20 rounded bg-[var(--surface-2)]" />
              <div className="h-20 rounded bg-[var(--surface-2)]" />
            </div>
            <div className="h-32 rounded bg-[var(--surface-2)]" />
          </div>
        </GlassPanel>
      ))}
    </div>
  );
}
