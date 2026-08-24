import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { CopyLinkButton } from './CopyLinkButton';
import { EmptyState } from '@/components/feedback/EmptyState';
import { ErrorDisplay } from '@/components/feedback/ErrorDisplay';
import { PageErrorBoundary } from '@/components/feedback/PageErrorBoundary';
import { PageLoadSkeleton } from '@/components/feedback/PageLoadSkeleton';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Heading, Text } from '@/components/ui/Typography';
import { useSetBreadcrumbOverrides } from './BreadcrumbOverridesContext';
import {
  DataFreshnessAuto,
  type FreshnessQuery,
} from '@/components/data-display/DataFreshness';

/**
 * Pick the most-degraded query in a list so the single page-tier badge
 * reflects the worst data state on the page.
 *
 * Priority: `error` > `stale` (incl. `forceStaleAfterMs`) > `fetching` >
 * `fresh`. A page that fans out into a hero query + a long-tail of cagg
 * queries can pass them all in and the chip will surface the one that
 * actually warrants attention.
 */
function pickWorstQuery(queries: readonly FreshnessQuery[]): FreshnessQuery {
  // queries.length is guaranteed >= 1 by the caller — we never invoke this
  // with an empty list, so non-null assertion on the fallback is safe.
  let worst = queries[0]!;
  let worstRank = -1;
  for (const q of queries) {
    const rank = q.isError ? 3 : q.isStale ? 2 : q.isFetching ? 1 : 0;
    if (rank > worstRank) {
      worst = q;
      worstRank = rank;
    }
  }
  return worst;
}

interface PageContainerProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  loading?: boolean;
  error?: Error | null;
  empty?: boolean;
  emptyMessage?: string;
  /**
   * Per-render label overrides keyed by route pattern (e.g.
   * `{ '/drives/:id': 'Trip to office' }`). Pushed up to the global
   * Layout breadcrumb via `BreadcrumbOverridesContext` so the single
   * top-of-page breadcrumb slot can show rich, friendly labels without
   * each page rendering its own duplicate breadcrumb row.
   */
  breadcrumbLabels?: Partial<Record<string, string>>;
  children: ReactNode;
  className?: string;
  /**
   * Show a "Copy link" button next to actions that copies the current URL
   * (with all query params) to the clipboard. Use on pages where users would
   * reasonably share a filtered view.
   */
  copyLink?: boolean;
  /**
   * When provided, renders `<DataFreshnessAuto>` in the header next to
   * `actions`. Pass either a single `useQuery()` result
   * or an array; arrays surface the most-degraded state via
   * `pickWorstQuery` so a single chip can stand in for the whole page.
   *
   * Pages that need finer control (e.g. `forceStaleAfterMs` for cagg-driven
   * data) should keep mounting `<DataFreshnessAuto>` directly via the
   * `actions` prop instead of using this convenience.
   */
  query?: FreshnessQuery | readonly FreshnessQuery[];
}

export function PageContainer({
  title, subtitle, actions, loading, error, empty, emptyMessage,
  breadcrumbLabels,
  children, className, copyLink, query,
}: PageContainerProps) {
  // Push per-page breadcrumb label overrides up to the global Layout
  // breadcrumb. The Layout itself reads from BreadcrumbOverridesContext +
  // `useBreadcrumbs(...)` and renders the single canonical breadcrumb row
  // at the top of every page, so PageContainer no longer renders its own.
  useSetBreadcrumbOverrides(breadcrumbLabels);

  // Resolve the query prop into a single representative result. An empty
  // array is treated the same as `undefined` so callers can pass conditional
  // arrays without guarding at the call site.
  const resolvedQuery: FreshnessQuery | null = (() => {
    if (!query) return null;
    if (Array.isArray(query)) {
      return query.length > 0 ? pickWorstQuery(query) : null;
    }
    return query as FreshnessQuery;
  })();

  return (
    <div
      className={cn('min-w-0 space-y-7', className)}
      data-role="page-container"
      aria-busy={loading || undefined}
    >
      <header className="flex flex-col gap-4 border-b border-[var(--border-subtle)] pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 sm:flex-1">
          <Heading level="page" className="font-semibold tracking-[-0.025em]">
            {title}
          </Heading>
          {subtitle && (
            <Text as="p" size="sm" color="secondary" className="mt-1.5 max-w-3xl leading-relaxed">
              {subtitle}
            </Text>
          )}
        </div>
        {(actions || copyLink || resolvedQuery) && (
          <div className="flex min-w-0 max-w-full flex-wrap items-center justify-start gap-2.5 sm:justify-end">
            {resolvedQuery && <DataFreshnessAuto query={resolvedQuery} />}
            {copyLink && <CopyLinkButton />}
            {actions}
          </div>
        )}
      </header>

      {loading ? (
        <PageLoadSkeleton panels={2} showHeader={false} />
      ) : error ? (
        <ErrorDisplay error={error} />
      ) : empty ? (
        <GlassPanel>
          <EmptyState message={emptyMessage ?? `No ${title.toLowerCase()} found.`} />
        </GlassPanel>
      ) : (
        <PageErrorBoundary pageName={title}>{children}</PageErrorBoundary>
      )}
    </div>
  );
}
