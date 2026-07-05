import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { GlassPanel, PanelTitle, type GlassPanelProps } from '@/components/ui';
import { Skeleton, QueryError, EmptyState } from '@/components/feedback';
import { cn } from '@/lib/cn';

interface CostSectionProps {
  /** Localized panel heading (rendered as an h3 via PanelTitle). */
  title: string;
  /** Decorative leading icon — wrapped `aria-hidden` so it never leaks into the heading's accessible name. */
  icon?: ReactNode;
  /** Optional trailing header slot (toggles, legends, secondary actions). */
  action?: ReactNode;
  glow?: GlassPanelProps['glow'];
  /** True while the backing query is loading its first payload. */
  isLoading?: boolean;
  /** Raw TanStack Query error — rendered via <QueryError> when present. */
  error?: unknown;
  onRetry?: () => void;
  /** True when the query resolved but produced no rows. */
  isEmpty?: boolean;
  emptyIcon?: ReactNode;
  /** Empty-state copy. Falls back to a localized "No data available" so an empty section is never a blank panel. */
  emptyMessage?: string;
  /** Height of the loading skeleton block. */
  skeletonHeight?: number;
  className?: string;
  /** Applied to the content wrapper (not the loading/empty/error states). */
  bodyClassName?: string;
  children: ReactNode;
}

/**
 * Self-sufficient section shell for the Cost Analysis page. Every data-bound
 * band renders through this so loading / error / empty are handled per section
 * (never gated behind a single page-level guard) using only shared components.
 */
export function CostSection({
  title,
  icon,
  action,
  glow = 'none',
  isLoading,
  error,
  onRetry,
  isEmpty,
  emptyIcon,
  emptyMessage,
  skeletonHeight = 220,
  className,
  bodyClassName,
  children,
}: CostSectionProps) {
  const { t } = useTranslation();
  return (
    <GlassPanel glow={glow} className={cn('p-4 sm:p-5', className)}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <PanelTitle className="flex items-center gap-2">
          {icon ? (
            <span className="inline-flex" aria-hidden="true">
              {icon}
            </span>
          ) : null}
          {title}
        </PanelTitle>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>

      {isLoading ? (
        <Skeleton height={skeletonHeight} />
      ) : error ? (
        <QueryError error={error} onRetry={onRetry} />
      ) : isEmpty ? (
        <EmptyState
          /* no-action: transient empty state — surfaces when no charging rows match the filters */
          icon={emptyIcon}
          message={emptyMessage ?? t('common.noData', 'No data available')}
        />
      ) : (
        <div className={bodyClassName}>{children}</div>
      )}
    </GlassPanel>
  );
}
