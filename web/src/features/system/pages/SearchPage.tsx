import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import {
  ArrowRight,
  BatteryCharging,
  Bell,
  BellRing,
  Car,
  Compass,
  Filter,
  Layers,
  MapPin,
  MapPinned,
  RefreshCw,
  Route,
  Search as SearchIcon,
  Star,
  Workflow,
} from 'lucide-react'

import { PageContainer } from '@/components/layout'
import {
  Badge,
  Button,
  GlassPanel,
  Input,
  PanelTitle,
  SectionTitle,
  Text,
} from '@/components/ui'
import { MetricCard, TimeStamp } from '@/components/data-display'
import { EmptyState, QueryError, Skeleton } from '@/components/feedback'
import { FadeIn } from '@/components/motion'
import { AINLSearch } from '@/components/ai/AINLSearch'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUrlString, useUrlArray } from '@/hooks/useUrlState'
import { useGlobalSearch, SEARCH_MIN_QUERY_LENGTH } from '@/api/hooks/useSearch'
import type { SearchHit, SearchHitType } from '@/api/types'
import { neonColorMap, type NeonColor } from '@/lib/tokens'
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

// Per-type accent — drives the toned icon-chip on each result group + row.
// Neon hues live only on the chip surface (bg/ring); the glyph uses the
// toned 300-level `text`, never neon body text.
const TYPE_ACCENT: Record<SearchHitType, NeonColor> = {
  vehicle: 'cyan',
  drive: 'blue',
  charging: 'green',
  alert: 'red',
  notification: 'amber',
  geofence: 'purple',
  automation: 'purple',
  location: 'cyan',
  trip: 'blue',
}

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
  const navigate = useNavigate()
  const [query, setQuery] = useUrlString('q', '')
  const [activeTypes, setActiveTypes] = useUrlArray('types')

  usePageTitle(t('search.title', 'Search'))

  const trimmed = query.trim()
  const tooShort = trimmed.length > 0 && trimmed.length < SEARCH_MIN_QUERY_LENGTH

  // Preserve the original requested types ordering across the URL round-trip.
  const typesFilter = useMemo<SearchHitType[]>(() => {
    return activeTypes.filter((x): x is SearchHitType =>
      (ALL_TYPES as string[]).includes(x),
    )
  }, [activeTypes])

  const searchQuery = useGlobalSearch(trimmed, {
    types: typesFilter.length > 0 ? typesFilter : undefined,
    limit: 25,
    disabled: tooShort,
  })
  const { data, isFetching, error, refetch } = searchQuery

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
  const initialLoading = isFetching && hits.length === 0
  const hasResults = groupedHits.length > 0

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
    <PageContainer
      title={t('search.title', 'Search')}
      subtitle={t(
        'search.subtitle',
        'Find vehicles, drives, charging, alerts and more across your fleet',
      )}
      query={isActiveSearch ? searchQuery : undefined}
      actions={
        isActiveSearch ? (
          <Button
            variant="ghost"
            onClick={() => refetch()}
            aria-label={t('search.refresh', 'Refresh results')}
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
                  className="min-h-11 rounded-full"
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
        </GlassPanel>
      </FadeIn>

      {/* KPI summary band — derived from the active result set, full-width */}
      {isActiveSearch && (
        <FadeIn delay={0.1}>
          <section
            aria-label={t('search.kpis', 'Search summary')}
            className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
          >
            {initialLoading ? (
              [0, 1, 2, 3].map((i) => (
                <Skeleton key={i} height={92} className="w-full rounded-xl" />
              ))
            ) : (
              <>
                <MetricCard
                  label={t('search.kpi.totalResults', 'Total Results')}
                  value={hits.length}
                  icon={<SearchIcon className="h-5 w-5" />}
                  color="cyan"
                  subtitle={t('search.kpi.forQuery', 'for “{{query}}”', { query: trimmed })}
                />
                <MetricCard
                  label={t('search.kpi.categories', 'Categories')}
                  value={groupedHits.length}
                  icon={<Layers className="h-5 w-5" />}
                  color="blue"
                  subtitle={t('search.kpi.ofTypes', 'of {{n}} searchable', {
                    n: ALL_TYPES.length,
                  })}
                />
                <MetricCard
                  label={t('search.kpi.topMatch', 'Top Match')}
                  value={topGroup ? searchSectionLabel(topGroup.type, t) : '—'}
                  icon={<Star className="h-5 w-5" />}
                  color="green"
                  subtitle={
                    topGroup
                      ? t('search.kpi.topCount', '{{n}} results', { n: topGroup.hits.length })
                      : t('search.kpi.noMatches', 'No matches')
                  }
                />
                <MetricCard
                  label={t('search.kpi.activeFilters', 'Active Filters')}
                  value={typesFilter.length}
                  icon={<Filter className="h-5 w-5" />}
                  color="amber"
                  subtitle={
                    typesFilter.length > 0
                      ? t('search.kpi.filtered', 'of {{n}} types', { n: ALL_TYPES.length })
                      : t('search.kpi.allTypes', 'All types shown')
                  }
                />
              </>
            )}
          </section>
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
                query: trimmed,
                defaultValue: `No matches for "${trimmed}". Try fewer characters or open the command palette.`,
              })}
            />
          </GlassPanel>
        ) : (
          <section aria-label={t('search.results.region', 'Search results')} className="space-y-3">
            <SectionTitle>{t('search.results.heading', 'Results')}</SectionTitle>
            <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4">
              {groupedHits.map((group) => {
                const accent = neonColorMap[TYPE_ACCENT[group.type]]
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
                      <PanelTitle className="min-w-0 flex-1 truncate">
                        {searchSectionLabel(group.type, t)}
                      </PanelTitle>
                      <Badge variant="neutral" size="sm">
                        {group.hits.length}
                      </Badge>
                    </div>
                    <ul className="divide-y divide-[var(--glass-border)]">
                      {group.hits.map((hit) => (
                        <li key={`${hit.type}-${hit.id}`}>
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => navigate(hit.url)}
                            aria-label={t('search.result.open', 'Open {{title}}', {
                              title: hit.title,
                            })}
                            className="w-full justify-start gap-3 rounded-lg px-2 py-3 text-left font-normal"
                          >
                            <span className={cn('shrink-0', accent.text)}>
                              {searchHitIconSm(hit.type)}
                            </span>
                            <span className="min-w-0 flex-1">
                              <Text as="span" variant="body" className="block truncate">
                                {hit.title}
                              </Text>
                              {hit.subtitle && (
                                <Text as="span" variant="caption" className="block truncate">
                                  {hit.subtitle}
                                </Text>
                              )}
                            </span>
                            {hit.when && (
                              <TimeStamp
                                value={hit.when}
                                className="hidden shrink-0 text-xs text-[var(--text-muted)] sm:inline"
                              />
                            )}
                            <ArrowRight
                              className="h-4 w-4 shrink-0 text-[var(--text-muted)]"
                              aria-hidden="true"
                            />
                          </Button>
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
    </PageContainer>
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
