import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Breadcrumbs, type BreadcrumbItem } from './Breadcrumbs';
import { CopyLinkButton } from './CopyLinkButton';
import { Spinner } from '@/components/feedback/Spinner';
import { PageErrorBoundary } from '@/components/feedback/PageErrorBoundary';
import { useBreadcrumbs } from '@/hooks/useBreadcrumbs';
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
   * Explicit breadcrumb items. When provided they win over auto-detection
   * via `useBreadcrumbs` (kept as an escape hatch for pages that compose
   * a non-standard chain). Most pages should rely on auto-detection plus
   * `breadcrumbLabels` for friendly per-render labels.
   */
  breadcrumbs?: BreadcrumbItem[];
  /**
   * Per-render label overrides keyed by route pattern (e.g.
   * `{ '/drives/:id': 'Trip to office' }`). Forwarded to `useBreadcrumbs`
   * when `breadcrumbs` is not explicitly provided. Phase-40 / Prompt 61.
   */
  breadcrumbLabels?: Partial<Record<string, string>>;
  /**
   * Opt out of breadcrumb rendering entirely. Use for chrome-less surfaces
   * (kiosk, share, watch) where the surrounding `<PageContainer>` should
   * stay quiet. Phase-40 / Prompt 61.
   */
  noBreadcrumbs?: boolean;
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
  breadcrumbs, breadcrumbLabels, noBreadcrumbs,
  children, className, copyLink, query,
}: PageContainerProps) {
  // Auto-detect breadcrumbs from the route registry when the page hasn't
  // supplied an explicit list. The hook returns `[]` for unknown routes and
  // `<Breadcrumbs>` self-suppresses when items.length <= 1, so top-level
  // pages render nothing without per-page wiring.
  const autoBreadcrumbs = useBreadcrumbs(breadcrumbLabels);
  const resolvedBreadcrumbs = breadcrumbs ?? autoBreadcrumbs;
  const showBreadcrumbs = !noBreadcrumbs && resolvedBreadcrumbs.length > 1;

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
      {showBreadcrumbs && (
        <Breadcrumbs items={resolvedBreadcrumbs} className="mb-2" />
      )}
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
