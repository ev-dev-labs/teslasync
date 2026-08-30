/**
 * ExplorePage — the Feature Hub. Modern-UI full-width redesign.
 *
 * A full-bleed "front door" to every feature in the app. Built additively on
 * top of the existing sidebar IA — we re-use `navSections` verbatim, decorate
 * each entry with a 1-line description (see featureCatalog.ts), and render the
 * whole catalog as a categorized, filterable, full-width bento of cards that
 * reflows into more columns on wide monitors without compressing descriptions.
 *
 * Page anatomy (top → bottom):
 *   1. KPI overview band — derived, at-a-glance counts (features / categories /
 *      showing / vehicles). No new API; computed from the same catalog.
 *   2. Sticky search panel — stays pinned as you scroll the catalog, with
 *      section-anchor chips (with match counts) for quick jumping.
 *   3. Results — per-section card bands, or a helpful empty state with
 *      "did you mean" suggestions from the Levenshtein route engine.
 *
 * Design rules preserved:
 *   - URL-driven state (`?q=`) so a link reproduces the user's view.
 *   - Shared components + design tokens only (Button / Input / GlassPanel /
 *     MetricCard / typography). The few `<a>` tags are internal navigation and
 *     keep focus rings + ARIA.
 *   - Visibility gates (`minVehicles`, `requiresAuth`) honored so the hub never
 *     surfaces something the sidebar would hide.
 *   - Every result region owns its own empty state; nothing is gated behind a
 *     single `{data && …}`.
 */
import { useMemo, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { PageContainer } from '@/components/layout/PageContainer';
import {
  GlassPanel,
  Input,
  Badge,
  Button,
  SectionTitle,
  Text,
  Caption,
} from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import { VisuallyHidden } from '@/components/a11y';
import { Icons } from '@/lib/icons';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useIsForwardAuth } from '@/api/hooks/useAuthMode';
import { cn } from '@/lib/cn';
import { closestRoutes } from '@/lib/closestRoute';
import { ROUTE_REGISTRY } from '@/lib/routeRegistry';

import {
  buildFeatureCatalog,
  filterFeatureCatalog,
  groupFeatureCatalog,
  type FeatureCatalogEntry,
} from '../featureCatalog';

/** Full-width card-grid reflow with a readable minimum card width. */
const CARD_GRID =
  'grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 2xl:grid-cols-4 3xl:grid-cols-5';

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

  // Stable count of distinct categories across the whole visible catalog —
  // drives the KPI band and stays constant while the user filters.
  const categoriesCount = useMemo(
    () => new Set(visibleCatalog.map((e) => e.section)).size,
    [visibleCatalog],
  );

  const updateQuery = (next: string) => {
    const params = new URLSearchParams(searchParams);
    if (next) params.set('q', next);
    else params.delete('q');
    setSearchParams(params, { replace: true });
  };

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
        {/* 1 — KPI overview band: full-width metric grid, derived from the
            catalog (no extra API). "Showing" tracks the live filter. */}
        <FadeIn>
          <section
            aria-label={t('explore.overview', 'Feature overview')}
            className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
          >
            <MetricCard
              label={t('explore.kpi.features', 'Features')}
              value={totalFeatures}
              icon={<Icons.layoutGrid className="h-5 w-5" aria-hidden="true" />}
              color="cyan"
            />
            <MetricCard
              label={t('explore.kpi.categories', 'Categories')}
              value={categoriesCount}
              icon={<Icons.folderOpen className="h-5 w-5" aria-hidden="true" />}
              color="purple"
            />
            <MetricCard
              label={t('explore.kpi.showing', 'Showing')}
              value={matchCount}
              icon={<Icons.filter className="h-5 w-5" aria-hidden="true" />}
              color="green"
              subtitle={
                query
                  ? t('explore.kpi.filtered', 'matching filter')
                  : t('explore.kpi.all', 'all features')
              }
            />
            <MetricCard
              label={t('explore.kpi.vehicles', 'Vehicles')}
              value={vehicleCount}
              icon={<Icons.vehicle className="h-5 w-5" aria-hidden="true" />}
              color="blue"
            />
          </section>
        </FadeIn>

        {/* 2 — Sticky search panel. Left un-wrapped by FadeIn on purpose: a
            motion transform on an ancestor breaks `position: sticky`. `top-0`
            works because Layout's main scroll container is the page itself.
            `z-30` keeps us under modals (z-90+) and the command palette
            (z-100) but over normal page content. */}
        <div
          className={cn(
            'sticky top-0 z-30 -mx-4 px-4 pt-2 pb-3 md:-mx-6 md:px-6',
            'bg-[var(--bg)]/85 backdrop-blur supports-[backdrop-filter]:bg-[var(--bg)]/70',
          )}
          data-testid="explore-search-panel"
        >
          <GlassPanel className="p-4 sm:p-5">
            <VisuallyHidden as="label" htmlFor="explore-search">
              {t('explore.searchLabel', 'Filter features')}
            </VisuallyHidden>
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
              icon={<Icons.search className="h-4 w-4" aria-hidden="true" />}
              data-testid="explore-search"
            />
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

        {/* 4 — Results: full-width bento of section bands, or a self-contained
            empty state. The results region owns its own empty handling. */}
        <FadeIn delay={0.1}>
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
            <div className="space-y-8">
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
        </FadeIn>
      </div>
    </PageContainer>
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
    <nav
      className="mt-3 flex flex-wrap gap-2"
      aria-label={t('explore.sectionsAriaLabel', 'Jump to section')}
      data-testid="explore-anchor-strip"
    >
      {groups.map(({ section, count }) => (
        <a
          key={section}
          href={`#explore-section-${slugify(section)}`}
          className={cn(
            'inline-flex min-h-11 items-center gap-2 rounded-full px-3 py-1.5',
            'bg-white/[0.04] text-[var(--text-secondary)]',
            'hover:bg-white/[0.08] hover:text-[var(--text-primary)]',
            'border border-[var(--glass-border)]',
            'outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)]',
            'transition-colors',
          )}
        >
          <Text as="span" size="sm">{section}</Text>
          <Caption
            className="tabular-nums"
            aria-label={t('explore.anchorCountAria', '{{count}} features', { count })}
          >
            {count}
          </Caption>
        </a>
      ))}
    </nav>
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
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <SectionTitle id={`explore-section-heading-${slugify(section)}`} className="truncate">
          {section}
        </SectionTitle>
        <Badge variant="neutral" size="sm" className="shrink-0 tabular-nums">
          {entries.length}
        </Badge>
      </div>
      <ul className={CARD_GRID} data-testid={`explore-section-${slugify(section)}`}>
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
              'border border-[var(--glass-border)] bg-white/[0.04]',
              entry.color,
            )}
            aria-hidden="true"
          >
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <Text as="div" size="sm" weight="medium" color="primary">
              <Highlight text={entry.label} query={query} />
            </Text>
            <Text
              as="p"
              variant="bodySm"
              className="mt-1 line-clamp-2 leading-relaxed"
            >
              <Highlight text={entry.description} query={query} />
            </Text>
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
        .filter((tok) => tok.length > 0),
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
    <GlassPanel className="p-6 text-center sm:p-8" data-testid="explore-empty">
      <Icons.search className="mx-auto h-6 w-6 text-[var(--text-muted)]" aria-hidden="true" />
      <SectionTitle className="mt-3">
        {t('explore.empty.title', 'No features match "{{query}}"', { query })}
      </SectionTitle>
      <Text as="p" variant="bodySm" className="mx-auto mt-1 max-w-md">
        {t(
          'explore.empty.body',
          'Try a different word, or open the command palette (⌘K) to search across pages, settings, and actions.',
        )}
      </Text>

      {suggestions.length > 0 && (
        <div className="mt-5 text-left" data-testid="explore-empty-suggestions">
          <Text as="p" variant="label" className="mb-2 text-center">
            {t('explore.empty.didYouMean', 'Did you mean')}
          </Text>
          <ul className="mx-auto flex max-w-md flex-col gap-1">
            {suggestions.map((s) => (
              <li key={s.path}>
                <Button
                  variant="ghost"
                  onClick={() => onPickSuggestion(s.path)}
                  className="w-full justify-between border border-[var(--glass-border)] bg-[var(--surface-1)] text-[var(--text-primary)] hover:bg-[var(--surface-2)]"
                >
                  <span>{s.label}</span>
                  <Caption>{s.path}</Caption>
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Button
        variant="secondary"
        size="sm"
        onClick={onClear}
        className="mt-5"
      >
        {t('explore.empty.clear', 'Clear filter')}
      </Button>
    </GlassPanel>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
