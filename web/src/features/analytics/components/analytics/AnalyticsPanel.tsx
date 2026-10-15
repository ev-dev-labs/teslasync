import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutCard, SourceContent } from '@/components/layout';
import { Skeleton, EmptyState } from '@/components/feedback';
import { cn } from '@/lib/cn';

interface AnalyticsPanelProps {
  /** Panel heading (rendered as an h3 via PanelTitle). */
  title: string;
  /** Optional leading icon — wrapped as decorative (aria-hidden). */
  icon?: ReactNode;
  /** True while the backing query loads its first payload. */
  loading?: boolean;
  /** Non-null when the backing query failed — renders a retryable QueryError. */
  error?: unknown;
  /** Retry callback wired to the query's refetch. */
  onRetry?: () => void;
  /** True when the query succeeded but produced no rows for this section. */
  isEmpty?: boolean;
  emptyMessage?: string;
  emptyDescription?: string;
  emptyIcon?: ReactNode;
  /** Skeleton height while loading (defaults to a chart-sized block). */
  skeletonHeight?: number;
  /** Extra classes for the grid item (col-span, etc.). */
  className?: string;
  children: ReactNode;
}

/**
 * Self-sufficient analytics section surface. Every data-bound panel on the
 * Analytics page renders through this so each one owns its loading /
 * error / empty state independently instead of gating the whole page behind
 * a single `{data && …}`. Drops cleanly into a bento grid — pass `col-span-*`
 * via `className`.
 */
export function AnalyticsPanel({
  title,
  icon,
  loading,
  error,
  onRetry,
  isEmpty,
  emptyMessage,
  emptyDescription,
  emptyIcon,
  skeletonHeight = 260,
  className,
  children,
}: AnalyticsPanelProps) {
  const { t } = useTranslation();
  return (
    <div className={cn('min-w-0', className)} aria-busy={loading ? true : undefined}>
      <LayoutCard title={title} actions={
        icon && (
          <span className="inline-flex text-cyan-300" aria-hidden="true">
            {icon}
          </span>
        )
      }>
      <SourceContent
        state={loading ? 'loading' : error ? 'error' : isEmpty ? 'empty' : 'ready'}
        label={title}
        emptyMessage={emptyMessage ?? t('common.noAnalyticsRecords', 'No analytics records match the current selection.')}
        errorMessage={t('error.loadFailed', 'Failed to load data')}
        error={error}
        errorRecovery={{ onRetry }}
        loadingContent={<Skeleton height={skeletonHeight} />}
        emptyContent={
        // no-action: recovery uses the page-level vehicle and period filters that remain visible.
        <EmptyState
          icon={emptyIcon}
          message={emptyMessage ?? t(
            'common.noAnalyticsRecords',
            'No analytics records match the current selection.',
          )}
          description={emptyDescription ?? t(
            'common.noAnalyticsRecordsDescription',
            'Adjust the current filters or return after more fleet activity is recorded.',
          )}
        />
        }
      >
        {children}
      </SourceContent>
      </LayoutCard>
    </div>
  );
}
