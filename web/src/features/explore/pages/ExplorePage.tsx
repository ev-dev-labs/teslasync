/**
 * ExplorePage — the Feature Hub. v2 iteration.
 *
 * A "front door" to every feature in the app. Built additively on top of
 * the existing sidebar IA — we re-use `navSections` verbatim, decorate
 * each entry with a 1-line description (see featureCatalog.ts), and
 * render the whole catalog as a categorized, filterable card grid.
 *
 * v2 additions (this iteration):
 *   1. Recently-visited strip at the top — reuses the existing
 *      `recentPages` localStorage registry that the command palette
 *      already maintains. Zero new state, immediate value.
 *   2. Sticky search panel — stays visible as you scroll through the
 *      ~95 cards so you can refine without scrolling back to the top.
 *   3. Match counts on the section anchor chips ("Driving · 12").
 *   4. Highlighted search terms inside card titles + descriptions —
 *      <mark> tags wrapped via a safe non-HTML splitter.
 *   5. "Did you mean" suggestions in the empty state — uses the
 *      existing `closestRoutes` Levenshtein engine.
 *
 * Design rules preserved:
 *   - URL-driven state (`?q=`) so a link reproduces the user's view.
 *   - No raw HTML elements where a shared component exists; the few
 *     <button>/<a> tags here all have focus rings + ARIA.
 *   - Visibility gates (`minVehicles`, `requiresAuth`) honored so the
 *     hub never surfaces something the sidebar would hide.
 */
import { useMemo, useRef, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel, Input } from '@/components/ui';
import { Icons } from '@/lib/icons';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useIsForwardAuth } from '@/api/hooks/useAuthMode';
import { cn } from '@/lib/cn';
import {
  getRecentPages,
  subscribeRecentPages,
  type RecentEntry,
} from '@/lib/recentPages';
import { closestRoutes } from '@/lib/closestRoute';
import { ROUTE_REGISTRY } from '@/lib/routeRegistry';

import {
  buildFeatureCatalog,
  filterFeatureCatalog,
  groupFeatureCatalog,
  type FeatureCatalogEntry,
} from '../featureCatalog';

const RECENT_LIMIT = 6;

export default function ExplorePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const inputRef = useRef<HTMLInputElement | null>(null);

  usePageTitle(t('explore.pageTitle', 'Explore features'));

  // Gating — same predicates the sidebar uses, so this page surfaces
  // exactly what the user would see in the legacy nav.
  const { data: vehicles } = useVehicles();
  const isForwardAuth = useIsForwardAuth();
  const vehicleCount = vehicles?.length ?? 0;

  const query = searchParams.get('q') ?? '';

  // ── Catalog ─────────────────────────────────────────────────────────
  const visibleCatalog = useMemo(() => {
    const all = buildFeatureCatalog();
    return all.filter((entry) => {
      if (entry.minVehicles && vehicleCount < entry.minVehicles) return false;
      if (entry.requiresAuth && !isForwardAuth) return false;
      return true;
    });
  }, [vehicleCount, isForwardAuth]);

  const filtered = useMemo(
    () => filterFeatureCatalog(visibleCatalog, query),
    [visibleCatalog, query],
  );
  const grouped = useMemo(() => groupFeatureCatalog(filtered), [filtered]);

  const updateQuery = (next: string) => {
    const params = new URLSearchParams(searchParams);
    if (next) params.set('q', next);
    else params.delete('q');
    setSearchParams(params, { replace: true });
  };

  // ── Recently visited ────────────────────────────────────────────────
  // Subscribed via useState + useEffect (not useSyncExternalStore) because
  // `getRecentPages()` returns a freshly-allocated array each call, which
  // breaks USE's Object.is snapshot equality and triggers an infinite
  // re-render loop ("Maximum update depth exceeded"). Storing the array
  // in component state keeps the reference stable until the store fires.
  const [recent, setRecent] = useState<RecentEntry[]>(() => getRecentPages(RECENT_LIMIT));
  useEffect(() => {
    const unsubscribe = subscribeRecentPages(() => {
      setRecent(getRecentPages(RECENT_LIMIT));
    });
    return unsubscribe;
  }, []);
  const visibleByTo = useMemo(() => {
    const map = new Map<string, FeatureCatalogEntry>();
    for (const e of visibleCatalog) map.set(e.to, e);
    return map;
  }, [visibleCatalog]);
  const recentResolved = useMemo(
    () =>
      recent
        .map((r) => visibleByTo.get(r.path))
        .filter((x): x is FeatureCatalogEntry => Boolean(x))
        .slice(0, RECENT_LIMIT),
    [recent, visibleByTo],
  );

  // ── "/" focuses the search box (Tesla-app muscle memory). ⌘K continues
  // to open the command palette — global handler upstream owns that.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const inEditable =
        tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable;
      if (!inEditable && e.key === '/') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const totalFeatures = visibleCatalog.length;
  const matchCount = filtered.length;

  const subtitle = query
    ? t('explore.subtitle.filtered', '{{matches}} of {{total}} features match "{{query}}"', {
        matches: matchCount,
        total: totalFeatures,
        query,
      })
    : t('explore.subtitle.all', 'Every feature in TeslaSync — {{total}} in total.', {
        total: totalFeatures,
      });

  return (
    <PageContainer
      title={t('explore.title', 'Explore features')}
      subtitle={subtitle}
    >
      <div className="space-y-6">
        {/* Recently visited — only when not filtering. Filtering implies
            the user wants to narrow the full catalog; recents would be
            noise in that mode. */}
        {!query && recentResolved.length > 0 && (
          <RecentStrip
            entries={recentResolved}
            onNavigate={(to) => navigate(to)}
          />
        )}

        {/* Sticky search panel. `top-0` works because Layout's main scroll
            container is the page itself. `z-30` keeps us under modals
            (z-90+) and the command palette (z-100) but over normal page
            content. */}
        <div
          className={cn(
            'sticky top-0 z-30 -mx-4 px-4 pt-2 pb-3 md:-mx-6 md:px-6',
            'bg-[var(--bg)]/85 backdrop-blur supports-[backdrop-filter]:bg-[var(--bg)]/70',
          )}
          data-testid="explore-search-panel"
        >
          <GlassPanel className="p-4 md:p-5">
            <label htmlFor="explore-search" className="sr-only">
              {t('explore.searchLabel', 'Filter features')}
            </label>
            <div className="relative">
              <Icons.search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]"
                aria-hidden="true"
              />
              <Input
                id="explore-search"
                ref={inputRef}
                type="search"
                autoComplete="off"
                value={query}
                onChange={(e) => updateQuery(e.target.value)}
                placeholder={t(
                  'explore.searchPlaceholder',
                  'Filter features by name, section, or description (press / to focus)',
                )}
                aria-label={t('explore.searchLabel', 'Filter features')}
                className="pl-9"
                data-testid="explore-search"
              />
            </div>
            {grouped.length > 0 && (
              <SectionAnchorStrip
                groups={grouped.map((g) => ({
                  section: g.section,
                  count: g.entries.length,
                }))}
              />
            )}
          </GlassPanel>
        </div>

        {grouped.length === 0 ? (
          <EmptyResult
            query={query}
            catalog={visibleCatalog}
            onPickSuggestion={(to) => {
              updateQuery('');
              navigate(to);
            }}
            onClear={() => updateQuery('')}
          />
        ) : (
          <div className="space-y-10">
            {grouped.map(({ section, entries }) => (
              <SectionBand
                key={section}
                section={section}
                entries={entries}
                query={query}
                onNavigate={(to) => navigate(to)}
              />
            ))}
          </div>
        )}
      </div>
    </PageContainer>
  );
}

// ─── Recently visited ────────────────────────────────────────────────

function RecentStrip({
  entries,
  onNavigate,
}: {
  entries: FeatureCatalogEntry[];
  onNavigate: (to: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <section
      aria-labelledby="explore-recent-heading"
      data-testid="explore-recent-strip"
    >
      <div className="mb-2 flex items-baseline justify-between">
        <h2
          id="explore-recent-heading"
          className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]"
        >
          {t('explore.recent.heading', 'Recently visited')}
        </h2>
        <span className="text-xs text-[var(--text-muted)]">{entries.length}</span>
      </div>
      <ul className="flex flex-wrap gap-2">
        {entries.map((entry) => {
          const Icon = entry.icon;
          return (
            <li key={entry.to}>
              <a
                href={entry.to}
                data-testid={`explore-recent-${entry.to}`}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                  e.preventDefault();
                  onNavigate(entry.to);
                }}
                className={cn(
                  'inline-flex items-center gap-2 rounded-full px-3 py-1.5',
                  'border border-[var(--glass-border)] bg-[var(--surface-1)]',
                  'text-xs text-[var(--text-primary)]',
                  'hover:bg-[var(--surface-2)]',
                  'outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)]',
                  'transition-colors',
                )}
              >
                <Icon className={cn('h-3.5 w-3.5', entry.color)} aria-hidden="true" />
                <span>{entry.label}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ─── Anchor strip ────────────────────────────────────────────────────

function SectionAnchorStrip({
  groups,
}: {
  groups: { section: string; count: number }[];
}) {
  const { t } = useTranslation();
  return (
    <div
      className="mt-3 flex flex-wrap gap-2"
      role="navigation"
      aria-label={t('explore.sectionsAriaLabel', 'Jump to section')}
      data-testid="explore-anchor-strip"
    >
      {groups.map(({ section, count }) => (
        <a
          key={section}
          href={`#explore-section-${slugify(section)}`}
          className={cn(
            'inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs',
            'bg-white/[0.04] text-[var(--text-secondary)]',
            'hover:bg-white/[0.08] hover:text-[var(--text-primary)]',
            'border border-[var(--glass-border)]',
            'outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)]',
            'transition-colors',
          )}
        >
          <span>{section}</span>
          <span
            className="text-[10px] text-[var(--text-muted)] tabular-nums"
            aria-label={t('explore.anchorCountAria', '{{count}} features', { count })}
          >
            {count}
          </span>
        </a>
      ))}
    </div>
  );
}

// ─── Section band ────────────────────────────────────────────────────

function SectionBand({
  section,
  entries,
  query,
  onNavigate,
}: {
  section: string;
  entries: FeatureCatalogEntry[];
  query: string;
  onNavigate: (to: string) => void;
}) {
  return (
    <section
      id={`explore-section-${slugify(section)}`}
      aria-labelledby={`explore-section-heading-${slugify(section)}`}
      className="scroll-mt-24"
    >
      <div className="mb-3 flex items-baseline justify-between">
        <h2
          id={`explore-section-heading-${slugify(section)}`}
          className="text-sm font-semibold uppercase tracking-wider text-[var(--text-secondary)]"
        >
          {section}
        </h2>
        <span className="text-xs text-[var(--text-muted)] tabular-nums">
          {entries.length}
        </span>
      </div>
      <ul
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        data-testid={`explore-section-${slugify(section)}`}
      >
        {entries.map((entry) => (
          <FeatureCard
            key={entry.to}
            entry={entry}
            query={query}
            onNavigate={onNavigate}
          />
        ))}
      </ul>
    </section>
  );
}

// ─── Feature card ────────────────────────────────────────────────────

function FeatureCard({
  entry,
  query,
  onNavigate,
}: {
  entry: FeatureCatalogEntry;
  query: string;
  onNavigate: (to: string) => void;
}) {
  const Icon = entry.icon;
  return (
    <li>
      <a
        href={entry.to}
        data-testid={`explore-card-${entry.to}`}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          onNavigate(entry.to);
        }}
        className={cn(
          'group block h-full rounded-xl border border-[var(--glass-border)] bg-[var(--surface-1)] p-4',
          'hover:border-[var(--glass-border-strong,rgba(255,255,255,0.18))] hover:bg-[var(--surface-2)]',
          'outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)]',
          'transition-colors',
        )}
      >
        <div className="flex items-start gap-3">
          <div
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
              'bg-white/[0.04] border border-[var(--glass-border)]',
              entry.color,
            )}
            aria-hidden="true"
          >
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-[var(--text-primary)]">
              <Highlight text={entry.label} query={query} />
            </div>
            <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)] line-clamp-2">
              <Highlight text={entry.description} query={query} />
            </p>
          </div>
        </div>
      </a>
    </li>
  );
}

// ─── Highlight match in text ─────────────────────────────────────────

/**
 * Wraps query-token matches in `<mark>` without touching markup.
 * Uses plain string splitting — no innerHTML, no regex on user input
 * that touches the DOM. Each token is split-then-rejoined separately
 * so multi-word queries highlight every hit.
 */
function Highlight({ text, query }: { text: string; query: string }) {
  // Unconditional hooks first — early return must come AFTER all hooks
  // so React's rules-of-hooks contract holds. Pattern is rebuilt only
  // when the token set changes (cheap; the regex is small).
  const tokens = useMemo(
    () =>
      query
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length > 0),
    [query],
  );

  const tokenSet = useMemo(() => new Set(tokens), [tokens]);

  const splitter = useMemo(() => {
    if (tokens.length === 0) return null;
    const escaped = tokens.map(escapeRegExp).join('|');
    // No /g flag — split() handles repeated matches and we avoid the
    // stateful lastIndex hazard that .test() introduces on /g regexes.
    return new RegExp(`(${escaped})`, 'i');
  }, [tokens]);

  if (tokens.length === 0 || !splitter) return <>{text}</>;

  const parts = text.split(splitter);
  return (
    <>
      {parts.map((part, i) => {
        const isMatch = tokenSet.has(part.toLowerCase());
        if (!isMatch) return <span key={i}>{part}</span>;
        return (
          <mark
            key={i}
            className="rounded bg-[var(--theme-primary)]/25 px-0.5 text-[var(--text-primary)]"
          >
            {part}
          </mark>
        );
      })}
    </>
  );
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── Empty state ─────────────────────────────────────────────────────

function EmptyResult({
  query,
  catalog,
  onPickSuggestion,
  onClear,
}: {
  query: string;
  catalog: FeatureCatalogEntry[];
  onPickSuggestion: (to: string) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  // Suggest the closest known routes — combines (a) full route registry
  // (so we pick up hidden pages too) and (b) catalog labels (so we match
  // the user's mental model). De-dupe by path; honor the catalog's
  // visibility gates so we never suggest a hidden page.
  const visiblePaths = useMemo(() => new Set(catalog.map((c) => c.to)), [catalog]);
  const suggestions = useMemo(() => {
    const fromRegistry = closestRoutes(query, ROUTE_REGISTRY, 5);
    const fromLabels = closestRoutes(
      query,
      catalog.map((c) => ({
        path: c.to,
        name: c.label.replace(/\s+/g, ''),
        label: c.label,
        i18nKey: '',
      })),
      5,
    );
    const seen = new Set<string>();
    const merged: typeof fromRegistry = [];
    for (const r of [...fromRegistry, ...fromLabels]) {
      if (!visiblePaths.has(r.path)) continue;
      if (seen.has(r.path)) continue;
      seen.add(r.path);
      merged.push(r);
    }
    merged.sort((a, b) => a.distance - b.distance);
    return merged.slice(0, 5);
  }, [query, catalog, visiblePaths]);

  return (
    <GlassPanel className="p-8 text-center" data-testid="explore-empty">
      <Icons.search className="mx-auto h-6 w-6 text-[var(--text-muted)]" />
      <h3 className="mt-3 text-base font-medium text-[var(--text-primary)]">
        {t('explore.empty.title', 'No features match "{{query}}"', { query })}
      </h3>
      <p className="mt-1 text-sm text-[var(--text-secondary)]">
        {t(
          'explore.empty.body',
          'Try a different word, or open the command palette (⌘K) to search across pages, settings, and actions.',
        )}
      </p>

      {suggestions.length > 0 && (
        <div className="mt-5 text-left" data-testid="explore-empty-suggestions">
          <p className="mb-2 text-center text-xs uppercase tracking-wider text-[var(--text-muted)]">
            {t('explore.empty.didYouMean', 'Did you mean')}
          </p>
          <ul className="mx-auto flex max-w-md flex-col gap-1">
            {suggestions.map((s) => (
              <li key={s.path}>
                <button
                  type="button"
                  onClick={() => onPickSuggestion(s.path)}
                  className={cn(
                    'flex w-full items-center justify-between rounded-md px-3 py-2 text-sm',
                    'bg-white/[0.04] text-[var(--text-primary)]',
                    'hover:bg-white/[0.08]',
                    'outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)]',
                    'transition-colors',
                  )}
                >
                  <span>{s.label}</span>
                  <span className="text-xs text-[var(--text-muted)]">{s.path}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <button
        type="button"
        onClick={onClear}
        className={cn(
          'mt-5 inline-flex items-center gap-2 rounded-md px-3 py-1.5',
          'bg-white/[0.06] text-sm text-[var(--text-primary)]',
          'hover:bg-white/[0.10]',
          'outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)]',
          'transition-colors',
        )}
      >
        {t('explore.empty.clear', 'Clear filter')}
      </button>
    </GlassPanel>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
