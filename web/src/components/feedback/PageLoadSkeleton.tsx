import { GlassPanel } from '@/components/ui/GlassPanel';
import { cn } from '@/lib/cn';

interface PageLoadSkeletonProps {
  /** How many GlassPanel-shaped skeleton blocks to render below the header. Defaults to 3. */
  panels?: number;
  className?: string;
}

/**
 * Layout-shaped Suspense fallback used while a lazy-loaded route chunk is being
 * fetched. Mirrors the typical PageContainer layout (heading bar + a few panels)
 * so the UI doesn't reflow when the real page mounts. This is what the
 * performance budget (Phase 40 / Prompt 35) targets — keeping CLS low while
 * route chunks stream in.
 */
export function PageLoadSkeleton({ panels = 3, className }: PageLoadSkeletonProps) {
  return (
    <div
      className={cn('space-y-6 animate-pulse', className)}
      role="status"
      aria-busy="true"
      aria-label="Loading page"
      data-testid="page-load-skeleton"
    >
      {/* Header bar — matches PageContainer title + subtitle */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <div className="h-7 w-48 rounded bg-[var(--surface-2)]" />
          <div className="h-3 w-72 rounded bg-[var(--surface-2)]" />
        </div>
        <div className="h-9 w-32 rounded bg-[var(--surface-2)]" />
      </div>

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
