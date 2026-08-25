import { cn } from '@/lib/cn';
import { PageLoadSkeleton } from './PageLoadSkeleton';

export interface PageLoaderProps {
  /**
   * Accessible loading label for the page skeleton. Defaults to the shared,
   * translated “Loading…” copy. Blank values fall back to the default.
   */
  label?: string;
  /**
   * Extra classes merged onto the wrapper — e.g. `min-h-screen` for a true
   * full-viewport fallback.
   */
  className?: string;
}

/**
 * Backward-compatible route fallback that now delegates to the layout-shaped
 * page skeleton used by the application router.
 */
export function PageLoader({ label, className }: PageLoaderProps) {
  return (
    <div
      className={cn('py-8', className)}
      data-testid="page-loader"
    >
      <PageLoadSkeleton label={label} />
    </div>
  );
}
