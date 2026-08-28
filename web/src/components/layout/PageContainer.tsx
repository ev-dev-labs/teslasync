import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { CopyLinkButton } from './CopyLinkButton';
import { PageActions } from './PageActions';
import { EmptyState } from '@/components/feedback/EmptyState';
import { ErrorDisplay } from '@/components/feedback/ErrorDisplay';
import { PageErrorBoundary } from '@/components/feedback/PageErrorBoundary';
import { PageLoadSkeleton } from '@/components/feedback/PageLoadSkeleton';
import {
  DataSourceNotice,
  type DataSourceDescriptor,
} from '@/components/feedback/DataSourceNotice';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Heading, Text } from '@/components/ui/Typography';
import { useSetBreadcrumbOverrides } from './BreadcrumbOverridesContext';
import {
  DataFreshnessAuto,
  type FreshnessQuery,
} from '@/components/data-display/DataFreshness';
import { OperationalModeBadge } from '@/components/data-display/OperationalModeBadge';
import { useOperationalMode } from '@/hooks/useOperationalMode';
import { useLoadAnnouncement } from '@/hooks/useStatusAnnouncer';

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

export interface PageContainerProps {
  title: string;
  subtitle?: string;
  /** @deprecated Use the semantic action slots below for new or touched pages. */
  actions?: ReactNode;
  /** Vehicle, time-range, and other scope controls. */
  contextActions?: ReactNode;
  /** Freshness or source metadata that precedes scope controls. */
  metadataActions?: ReactNode;
  /** Repeatable utility commands such as refresh or compare. */
  secondaryActions?: ReactNode;
  /** Rare visible destructive commands; prefer overflow for infrequent actions. */
  destructiveActions?: ReactNode;
  /** Saved views, print, share, export, and other low-frequency commands. */
  overflowActions?: ReactNode;
  /** The single dominant page command. Rendered at the far right. */
  primaryAction?: ReactNode;
  loading?: boolean;
  /** Announces background loading without replacing progressively rendered content. */
  busy?: boolean;
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
   * When provided, renders `<DataFreshnessAuto>` in the header metadata zone.
   * Pass either a single `useQuery()` result
   * or an array; arrays surface the most-degraded state via
   * `pickWorstQuery` so a single chip can stand in for the whole page.
   *
   * Pages that need finer control (e.g. `forceStaleAfterMs` for cagg-driven
   * data) should mount `<DataFreshnessAuto>` via `metadataActions`.
   */
  query?: FreshnessQuery | readonly FreshnessQuery[];
  /**
   * Named independent sources used by this page. When some sources are
   * delayed or unavailable, a non-fatal notice is rendered while successful
   * sections remain on screen.
   */
  dataSources?: readonly DataSourceDescriptor[];
  /**
   * Set false to suppress the automatic "loaded" / "could not refresh"
   * live-region announcement. Use for pages that announce their own,
   * richer result (e.g. a search page that reports a match count), so
   * the user does not hear the same event twice.
   */
  announce?: boolean;
}

export function PageContainer({
  title, subtitle, actions, contextActions, metadataActions, secondaryActions,
  destructiveActions, overflowActions, primaryAction,
  loading, busy, error, empty, emptyMessage,
  breadcrumbLabels,
  children, className, copyLink, query, dataSources,
  announce = true,
}: PageContainerProps) {
  const operationalMode = useOperationalMode();
  // A11Y-06: every page funnels through here, so the "your data finished
  // loading" / "the refresh failed" announcements can be centralised
  // instead of asking 140 pages to remember a hook. Fires only on the
  // loading → settled edge, so background refetches stay silent, and it
  // is governed (deduped + rate-limited) by `useStatusAnnouncer`.
  useLoadAnnouncement({
    label: title,
    isLoading: Boolean(loading),
    isError: Boolean(error),
    count: empty ? 0 : undefined,
    enabled: announce,
  });

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
      className={cn('min-w-0 space-y-6', className)}
      data-role="page-container"
      aria-busy={loading || busy || undefined}
    >
      <header
        className="relative flex flex-col gap-5 overflow-hidden rounded-panel border border-[var(--border-default)] bg-[var(--surface-1)] px-5 py-5 shadow-e1 sm:px-6 xl:flex-row xl:items-center xl:justify-between"
        data-role="page-header"
      >
        <div className="flex min-w-0 max-w-4xl gap-4 xl:flex-1">
          <span
            className="w-1 shrink-0 self-stretch rounded-pill bg-[var(--theme-primary)]"
            aria-hidden="true"
          />
          <div className="min-w-0 py-0.5">
            {/* Route-focus target (A11Y-03). `tabIndex={-1}` makes the
                heading programmatically focusable without adding it to
                the tab order, so `RouteFocusManager` can park focus at
                the start of the new page's content after a client-side
                navigation. The attribute name is asserted against
                `ROUTE_FOCUS_TARGET_ATTR` by the PageContainer test. */}
            <Heading
              level="page"
              className="font-bold tracking-[-0.025em] outline-none"
              tabIndex={-1}
              data-route-focus-target="true"
            >
              {title}
            </Heading>
            {subtitle && (
              <Text as="p" variant="bodySm" className="mt-2 max-w-3xl leading-relaxed">
                {subtitle}
              </Text>
            )}
          </div>
        </div>
        <PageActions
          metadata={
            resolvedQuery || metadataActions || operationalMode.isReadOnly
              ? <>
                  {operationalMode.isReadOnly && <OperationalModeBadge />}
                  {resolvedQuery && <DataFreshnessAuto query={resolvedQuery} />}
                  {metadataActions}
                </>
              : undefined
          }
          context={contextActions}
          secondary={
            actions || secondaryActions
              ? <>{actions}{secondaryActions}</>
              : undefined
          }
          destructive={destructiveActions}
          overflow={
            copyLink || overflowActions
              ? <>{overflowActions}{copyLink && <CopyLinkButton />}</>
              : undefined
          }
          primary={primaryAction}
        />
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
        <PageErrorBoundary pageName={title}>
          {dataSources && <DataSourceNotice sources={dataSources} />}
          {children}
        </PageErrorBoundary>
      )}
    </div>
  );
}
