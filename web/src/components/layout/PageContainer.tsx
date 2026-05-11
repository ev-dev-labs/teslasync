import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { CopyLinkButton } from './CopyLinkButton';
import { Spinner } from '@/components/feedback/Spinner';
import { PageErrorBoundary } from '@/components/feedback/PageErrorBoundary';
import { useSetBreadcrumbOverrides } from './BreadcrumbOverridesContext';
import {
  DataFreshnessAuto,
  type FreshnessQuery,
} from '@/components/data-display/DataFreshness';

/**
 * Phase-45 / Prompt 19 — pick the most-degraded query in a list so the
 * single page-tier badge reflects the worst data state on the page.
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
   * reasonably share a filtered view. Phase 40 / Prompt 33.
   */
  copyLink?: boolean;
  /**
   * Phase-45 / Prompt 19 — when provided, renders `<DataFreshnessAuto>` in
   * the header next to `actions`. Pass either a single `useQuery()` result
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
    <div className={cn('space-y-6', className)}>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="min-w-0 sm:flex-1">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-[var(--text-muted)] dark:text-[var(--text-muted)]">{subtitle}</p>}
        </div>
        {(actions || copyLink || resolvedQuery) && (
          <div className="flex items-center gap-2 flex-wrap min-w-0 max-w-full justify-start sm:justify-end">
            {resolvedQuery && <DataFreshnessAuto query={resolvedQuery} />}
            {copyLink && <CopyLinkButton />}
            {actions}
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <Spinner size="lg" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
          <p className="text-sm text-red-700 dark:text-red-300">{error.message}</p>
        </div>
      ) : empty ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-sm text-[var(--text-muted)]">{emptyMessage ?? `No ${title.toLowerCase()} found.`}</p>
        </div>
      ) : (
        <PageErrorBoundary pageName={title}>{children}</PageErrorBoundary>
      )}
    </div>
  );
}
