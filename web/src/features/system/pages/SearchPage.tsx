import { useEffect, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import {
  ArrowRight,
  BatteryCharging,
  Bell,
  BellRing,
  Car,
  Compass,
  MapPin,
  MapPinned,
  RefreshCw,
  Route,
  Search as SearchIcon,
  Workflow,
} from 'lucide-react'

import { PageLayout } from '@/components/layout'
import {
  Badge,
  Button,
  BUTTON_BASE,
  BUTTON_VARIANTS,
  GlassPanel,
  Input,
  PanelTitle,
  SectionTitle,
  Text,
} from '@/components/ui'
import { TimeStamp } from '@/components/data-display'
import { SystemSummaryBrief } from '../components/operationalbrief-all/SystemSummaryBrief'
import { AlertBanner, EmptyState, QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback'
import { FadeIn } from '@/components/motion'
import { AINLSearch } from '@/components/ai'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useDataState } from '@/hooks/useDataState'
import { useLoadAnnouncement } from '@/hooks/useStatusAnnouncer'
import { useUrlString, useUrlArray } from '@/hooks/useUrlState'
import { useGlobalSearch, SEARCH_MIN_QUERY_LENGTH } from '@/api/hooks/useSearch'
import type { SearchHit, SearchHitType } from '@/api/types'
import { neonColorMap, typography } from '@/lib/tokens'
import { cn } from '@/lib/cn'

// All entity types the backend can return — kept in display order so the
// facet chip rail and grouped results render predictably.
const ALL_TYPES: SearchHitType[] = [
  'vehicle',
  'drive',
  'charging',
  'alert',
  'notification',
  'geofence',
  'automation',
  'location',
  'trip',
]

// Entity identity is carried by the icon and translated label, not status hues.
// Reuse the existing neutral, theme-aware token rather than a local palette.
const RESULT_ACCENT = neonColorMap.neutral

/**
 * Dedicated app-wide search page.
 *
 * Reads `?q=` and `?types=` from the URL so links from the command palette
 * (and shared URLs) restore the same view. Per-type LIMIT is bumped to 25
 * here so the page can display materially more results than the palette's
 * 5-per-type preview. The redesign lays results out as a full-width bento
 * grid so wide monitors gain more columns instead of dead side margins.
 */
export default function SearchPage() {
  const { t } = useTranslation()
  const [query, setQuery] = useUrlString('q', '')
  const [activeTypes, setActiveTypes] = useUrlArray('types')

  usePageTitle(t('search.title', 'Search'))

  const trimmed = query.trim()
  const tooShort = trimmed.length > 0 && trimmed.length < SEARCH_MIN_QUERY_LENGTH

  // Preserve the original requested types ordering across the URL round-trip.
  const typesFilter = useMemo<SearchHitType[]>(() => {
    return [...new Set(activeTypes)].filter((x): x is SearchHitType =>
      (ALL_TYPES as string[]).includes(x),
    )
  }, [activeTypes])

  const searchQuery = useGlobalSearch(trimmed, {
    types: typesFilter.length > 0 ? typesFilter : undefined,
    limit: 25,
    disabled: tooShort,
  })
  const { data, isFetching, refetch } = searchQuery
  const state = useDataState(searchQuery)
  const error = state.fatalError
  const responseScope = useRef<{ query: string; types: SearchHitType[] } | null>(null)

  // Placeholder rows belong to the last resolved request, not the new chips.
  useEffect(() => {
    if (data && searchQuery.isSuccess && !searchQuery.isPlaceholderData) {
      responseScope.current = { query: data.query, types: typesFilter }
    }
  }, [data, searchQuery.isSuccess, searchQuery.isPlaceholderData, typesFilter])

  const hits = data?.hits ?? []

  const groupedHits = useMemo(() => {
    const groups = new Map<SearchHitType, SearchHit[]>()
    for (const type of ALL_TYPES) groups.set(type, [])
    for (const hit of hits) {
      if (!groups.has(hit.type)) continue
      groups.get(hit.type)!.push(hit)
    }
    return ALL_TYPES.map((type) => ({ type, hits: groups.get(type) ?? [] })).filter(
      (g) => g.hits.length > 0,
    )
  }, [hits])

  // Largest group — surfaced in the KPI band as the dominant category.
  const topGroup = useMemo(
    () =>
      groupedHits.reduce<{ type: SearchHitType; hits: SearchHit[] } | null>(
        (best, g) => (g.hits.length > (best?.hits.length ?? 0) ? g : best),
        null,
      ),
    [groupedHits],
  )

  const isIdle = trimmed.length === 0
  const isActiveSearch = !isIdle && !tooShort && !error
  // An empty response is still retained data; refreshing it keeps measured zeroes.
  const coldPaused = !state.hasData && state.isRefreshBlocked
  const initialLoading = searchQuery.isPending && !state.hasData && !coldPaused
  const hasResults = groupedHits.length > 0
  const displayedQuery = data?.query ?? trimmed
  const displayedTypes = searchQuery.isPlaceholderData
    ? responseScope.current?.query === displayedQuery ? responseScope.current.types : null
    : typesFilter
  const typeScopeLabel = (types: SearchHitType[] | null) => types == null
    ? t('common.unknown', 'Unknown')
    : types.length > 0
      ? types.map(type => searchSectionLabel(type, t)).join(', ')
      : t('search.kpi.allTypes', 'All types shown')
  const resultScope = t('search.brief.resultScope', 'for “{{query}}” · result types: {{types}}', {
    query: displayedQuery, types: typeScopeLabel(displayedTypes),
  })
  const settled = searchQuery.isSuccess && !searchQuery.isPlaceholderData && !isFetching

  useLoadAnnouncement({
    label: t('search.brief.announcementScope', 'search results for “{{query}}” · types: {{types}}', {
      query: displayedQuery, types: typeScopeLabel(displayedTypes),
    }),
    isLoading: searchQuery.isPending || isFetching || searchQuery.isPlaceholderData,
    isError: Boolean(error || state.refreshError),
    count: settled && state.hasData ? hits.length : undefined,
    enabled: !isIdle && !tooShort && !state.isRefreshBlocked
      && (settled && state.hasData || Boolean(error || state.refreshError)),
  })

  function toggleType(type: SearchHitType) {
    if (typesFilter.includes(type)) {
      setActiveTypes(typesFilter.filter((x) => x !== type))
    } else {
      setActiveTypes([...typesFilter, type])
    }
  }

  function clearFilters() {
    setActiveTypes([])
  }

  return (
    <PageLayout
      title={t('search.title', 'Search')}
      subtitle={t(
        'search.subtitle',
        'Find vehicles, drives, charging, alerts and more across your fleet',
      )}
      query={isActiveSearch ? searchQuery : undefined}
      announce={false}
      busy={!isIdle && !tooShort && isFetching}
      secondaryActions={
        isActiveSearch ? (
          <Button
            variant="ghost"
            onClick={() => refetch()}
            aria-label={t('search.refresh', 'Refresh results')}
            className="min-h-11 min-w-11"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          </Button>
        ) : undefined
      }
    >
      {/*
        Natural-language search across drives, charges, and alerts. Rendered
        above the typed-filter panel so the AI affordance is discoverable but
        never replaces the canonical typed search baseline. Returns null when
        ai_mode is 'off' or the nl-search feature toggle is off, so users on the
        default install never see this surface — kept unwrapped so the null
        render leaves no empty spacer.
      */}
      {!isIdle && !tooShort && <StaleRefreshWarning state={state} />}
      <AINLSearch />

      {/* Query + facet toolbar — full-width hero */}
      <FadeIn delay={0.05}>
        <GlassPanel className="p-4 sm:p-5">
          <Input
            type="search"
            size="lg"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('search.placeholder', 'Search vehicles, drives, charging…')}
            label={t('search.input.label', 'Search query')}
            icon={<SearchIcon className="h-4 w-4" aria-hidden="true" />}
            aria-label={t('search.input.label', 'Search query')}
            autoFocus
          />

          <div
            role="group"
            aria-label={t('search.filters.label', 'Filter results by type')}
            className="mt-4 flex flex-wrap items-center gap-2"
          >
            {ALL_TYPES.map((type) => {
              const active = typesFilter.includes(type)
              return (
                <Button
                  key={type}
                  type="button"
                  size="sm"
                  variant={active ? 'primary' : 'outline'}
                  aria-pressed={active}
                  onClick={() => toggleType(type)}
                  wrapLabel
                  className="min-h-11 max-w-full rounded-full"
                >
                  {searchHitIconSm(type)}
                  {searchSectionLabel(type, t)}
                </Button>
              )
            })}
            {typesFilter.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={clearFilters}
                className="min-h-11 rounded-full"
              >
                {t('search.filters.clear', 'Clear filters')}
              </Button>
            )}
          </div>
          {!isIdle && !tooShort && (
            <Text variant="caption" className="mt-3 break-words">
              {t('search.brief.requestedScope', 'Requested: “{{query}}” · types: {{types}}', {
                query: trimmed, types: typeScopeLabel(typesFilter),
              })}
            </Text>
          )}
          {!isIdle && !tooShort && isFetching && (
            <Text variant="caption" className="mt-2">
              {t('freshness.updating', 'Updating…')}
            </Text>
          )}
        </GlassPanel>
      </FadeIn>

      {/* KPI summary band — derived from the active result set, full-width */}
      {isActiveSearch && (
        <FadeIn delay={0.1}>
          <SystemSummaryBrief
            title={t('search.kpis', 'Search summary')}
            description={t('search.brief.responseDescription', 'Result counts and category coverage for the displayed search response.')}
            scope={resultScope}
            available={state.hasData} loading={initialLoading} retained={state.hasData && (state.status === 'stale' || searchQuery.isPlaceholderData)}
            statusLabel={coldPaused ? t('search.paused.title', 'Search request paused') : undefined}
            metrics={[
              { metricId: 'count', occurrenceId: 'results', rawValue: state.hasData ? hits.length : null, label: t('search.kpi.totalResults', 'Total results'),
                context: t('search.brief.scope', 'Returned search hits, not an unbounded server total.') },
              { metricId: 'count', occurrenceId: 'categories', rawValue: state.hasData ? groupedHits.length : null, label: t('search.kpi.categories', 'Categories'),
                context: t('search.kpi.ofTypes', 'of {{n}} searchable', { n: ALL_TYPES.length }) },
              { metricId: 'count', occurrenceId: 'filters', rawValue: typesFilter.length, label: t('search.kpi.activeFilters', 'Active filters'),
                context: typesFilter.length > 0 ? t('search.kpi.filtered', 'of {{n}} types', { n: ALL_TYPES.length }) : t('search.kpi.allTypes', 'All types shown') },
            ]}
            textMetrics={[{
              key: 'top-match', label: t('search.kpi.topMatch', 'Top match'),
              value: topGroup ? searchSectionLabel(topGroup.type, t) : '—',
              valueState: topGroup ? 'value' : 'missing',
              detail: topGroup ? t('search.kpi.topCount', '{{n}} results', { n: topGroup.hits.length })
                : state.hasData ? t('search.kpi.noMatches', 'No matches') : t('common.unknown', 'Unknown'),
            }]}
          />
        </FadeIn>
      )}

      {/* Results region — each state is self-sufficient */}
      <FadeIn delay={0.15}>
        {isIdle ? (
          <GlassPanel className="p-6">
            <EmptyState
              icon={<SearchIcon className="h-8 w-8" aria-hidden="true" />}
              title={t('search.empty.title', 'Start typing to search')}
              message={t(
                'search.empty.message',
                'Search across vehicles, drives, charging sessions, alerts, geofences, automations and more.',
              )}
            />
          </GlassPanel>
        ) : tooShort ? (
          <GlassPanel className="p-6">
            <EmptyState /* no-action: transient guidance until the query reaches the minimum length */
              icon={<SearchIcon className="h-8 w-8" aria-hidden="true" />}
              title={t('search.tooShort.title', 'Type at least 2 characters')}
              message={t(
                'search.tooShort.message',
                'Search across vehicles, drives, charging sessions, alerts, geofences, automations and more.',
              )}
            />
          </GlassPanel>
        ) : error ? (
          <GlassPanel className="p-6">
            <QueryError error={error} onRetry={() => refetch()} />
          </GlassPanel>
        ) : coldPaused ? (
          <GlassPanel className="p-4 sm:p-5">
            <AlertBanner variant="info" role="status" title={t('search.paused.title', 'Search request paused')}>
              {t('search.paused.message', 'The search request is paused. No response has been received, so result counts are unknown. Retry when the request can resume.')}
            </AlertBanner>
            <Button type="button" variant="secondary" wrapLabel className="mt-3 min-h-11" onClick={() => refetch()}>
              {t('error.retry', 'Retry')}
            </Button>
          </GlassPanel>
        ) : initialLoading ? (
          <GlassPanel className="p-4 sm:p-5">
            <Skeleton className="h-4 w-1/3" />
            <div className="mt-4 space-y-2">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} height={48} className="w-full" />
              ))}
            </div>
          </GlassPanel>
        ) : !hasResults ? (
          <GlassPanel className="p-6">
            <EmptyState /* no-action: transient empty state — no entities matched the query */
              icon={<SearchIcon className="h-8 w-8" aria-hidden="true" />}
              title={t('search.noResults.title', 'No results')}
              message={t('search.noResults.message', {
                query: displayedQuery,
                defaultValue: 'No matches for "{{query}}". Try fewer characters or open the command palette.',
              })}
            />
          </GlassPanel>
        ) : (
          <section aria-label={t('search.results.region', 'Search results')} className="space-y-3">
            <SectionTitle>{t('search.results.heading', 'Results')}</SectionTitle>
            <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4">
              {groupedHits.map((group) => {
                const accent = RESULT_ACCENT
                return (
                  <GlassPanel key={group.type} className="p-4 sm:p-5">
                    <div className="mb-3 flex items-center gap-2">
                      <span
                        className={cn(
                          'flex items-center justify-center rounded-lg p-1.5 ring-1',
                          accent.bg,
                          accent.ring,
                          accent.text,
                        )}
                      >
                        {searchHitIconSm(group.type)}
                      </span>
                      <PanelTitle className="min-w-0 flex-1 break-words">
                        {searchSectionLabel(group.type, t)}
                      </PanelTitle>
                      <Badge variant="neutral" size="sm">
                        {group.hits.length}
                      </Badge>
                    </div>
                    <ul className="divide-y divide-[var(--glass-border)]">
                      {group.hits.map((hit) => (
                        <li key={`${hit.type}-${hit.id}`}>
                          <Link
                            to={hit.url}
                            aria-label={t('search.result.open', 'Open {{title}}', {
                              title: hit.title,
                            })}
                            className={cn(
                              BUTTON_BASE,
                              BUTTON_VARIANTS.ghost,
                              'min-h-11 w-full flex-wrap justify-start gap-3 rounded-lg px-2 py-3 text-start whitespace-normal',
                              typography.weight.regular,
                            )}
                          >
                            <span className={cn('shrink-0', accent.text)}>
                              {searchHitIconSm(hit.type)}
                            </span>
                            <span className="min-w-0 flex-1">
                              <Text as="span" variant="body" className="block break-words">
                                {hit.title}
                              </Text>
                              {hit.subtitle && (
                                <Text as="span" variant="caption" className="block break-words">
                                  {hit.subtitle}
                                </Text>
                              )}
                            </span>
                            {hit.when && (
                              <TimeStamp
                                value={hit.when}
                                className={cn('max-w-full basis-full break-words sm:basis-auto sm:shrink-0', typography.role.caption)}
                              />
                            )}
                            <ArrowRight
                              className="h-4 w-4 shrink-0 text-[var(--text-muted)]"
                              aria-hidden="true"
                            />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </GlassPanel>
                )
              })}
            </div>
          </section>
        )}
      </FadeIn>
    </PageLayout>
  )
}

// Compact icon variant used in chips, KPI cards, and rows. Module-scope so the
// page component is not re-creating <Icon /> elements every render. Marked
// decorative — the surrounding label/aria-label carries the meaning.
function searchHitIconSm(type: SearchHitType): JSX.Element {
  const cls = 'h-4 w-4'
  switch (type) {
    case 'vehicle': return <Car className={cls} aria-hidden="true" />
    case 'drive': return <Route className={cls} aria-hidden="true" />
    case 'charging': return <BatteryCharging className={cls} aria-hidden="true" />
    case 'alert': return <BellRing className={cls} aria-hidden="true" />
    case 'notification': return <Bell className={cls} aria-hidden="true" />
    case 'geofence': return <MapPinned className={cls} aria-hidden="true" />
    case 'automation': return <Workflow className={cls} aria-hidden="true" />
    case 'location': return <MapPin className={cls} aria-hidden="true" />
    case 'trip': return <Compass className={cls} aria-hidden="true" />
    default: return <SearchIcon className={cls} aria-hidden="true" />
  }
}

function searchSectionLabel(type: SearchHitType, t: TFunction): string {
  switch (type) {
    case 'vehicle': return t('search.section.vehicle', 'Vehicles')
    case 'drive': return t('search.section.drive', 'Drives')
    case 'charging': return t('search.section.charging', 'Charging')
    case 'alert': return t('search.section.alert', 'Alerts')
    case 'notification': return t('search.section.notification', 'Notifications')
    case 'geofence': return t('search.section.geofence', 'Geofences')
    case 'automation': return t('search.section.automation', 'Automations')
    case 'location': return t('search.section.location', 'Locations')
    case 'trip': return t('search.section.trip', 'Trips')
    default: return t('search.section.results', 'Results')
  }
}
