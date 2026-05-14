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
  MapPin,
  MapPinned,
  Route,
  Search as SearchIcon,
  Workflow,
} from 'lucide-react'

import { PageContainer } from '@/components/layout'
import { GlassPanel, Input } from '@/components/ui'
import { TimeStamp } from '@/components/data-display'
import { EmptyState, Skeleton } from '@/components/feedback'
import { AINLSearch } from '@/components/ai/AINLSearch'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useUrlString, useUrlArray } from '@/hooks/useUrlState'
import { useGlobalSearch, SEARCH_MIN_QUERY_LENGTH } from '@/api/hooks/useSearch'
import type { SearchHit, SearchHitType } from '@/api/types'
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

/**
 * Phase-40 / Prompt 41 — dedicated app-wide search page.
 *
 * Reads `?q=` and `?types=` from the URL so links from the command palette
 * (and shared URLs) restore the same view. Per-type LIMIT is bumped to 25
 * here so the page can display materially more results than the palette's
 * 5-per-type preview.
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
    return activeTypes.filter((t): t is SearchHitType =>
      (ALL_TYPES as string[]).includes(t),
    )
  }, [activeTypes])

  const { data, isFetching, error } = useGlobalSearch(trimmed, {
    types: typesFilter.length > 0 ? typesFilter : undefined,
    limit: 25,
    disabled: tooShort,
  })

  const hits = data?.hits ?? []

  const groupedHits = useMemo(() => {
    const groups = new Map<SearchHitType, SearchHit[]>()
    for (const t of ALL_TYPES) groups.set(t, [])
    for (const hit of hits) {
      if (!groups.has(hit.type)) continue
      groups.get(hit.type)!.push(hit)
    }
    return ALL_TYPES.map((type) => ({ type, hits: groups.get(type) ?? [] })).filter(
      (g) => g.hits.length > 0,
    )
  }, [hits])

  function toggleType(type: SearchHitType) {
    if (typesFilter.includes(type)) {
      setActiveTypes(typesFilter.filter((t) => t !== type))
    } else {
      setActiveTypes([...typesFilter, type])
    }
  }

  function clearFilters() {
    setActiveTypes([])
  }

  return (
    <PageContainer title={t('search.title', 'Search')}>
      {/*
        Phase-50 / 0017 — N3 Natural-language search across drives,
        charges, and alerts. Rendered above the typed-filter panel
        so the AI affordance is discoverable but never replaces the
        canonical typed search baseline. Returns null when ai_mode is
        'off' OR the nl-search feature toggle is off (ADR-015 §I5),
        so users on the default install never see this surface.
      */}
      <AINLSearch />
      <GlassPanel className="p-4 sm:p-6">
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('search.placeholder', 'Search vehicles, drives, charging…')}
          icon={<SearchIcon className="h-4 w-4" />}
          aria-label={t('search.input.label', 'Search query')}
          autoFocus
        />

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {ALL_TYPES.map((type) => {
            const active = typesFilter.includes(type)
            return (
              <button
                key={type}
                type="button"
                onClick={() => toggleType(type)}
                aria-pressed={active}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors',
                  active
                    ? 'border-[var(--theme-primary)] bg-[rgba(var(--theme-primary-rgb),0.12)] text-[var(--text-primary)]'
                    : 'border-[var(--glass-border)] bg-[var(--surface-1)] text-[var(--text-secondary)] hover:border-[var(--theme-primary)] hover:text-[var(--text-primary)]',
                )}
              >
                {searchHitIconSm(type)}
                {searchSectionLabel(type, t)}
              </button>
            )
          })}
          {typesFilter.length > 0 && (
            <button
              type="button"
              onClick={clearFilters}
              className="rounded-full border border-[var(--glass-border)] bg-[var(--surface-1)] px-3 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              {t('search.filters.clear', 'Clear filters')}
            </button>
          )}
        </div>
      </GlassPanel>

      <div className="mt-6">
        {tooShort ? (
          <GlassPanel className="p-6">
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
              icon={<SearchIcon className="h-8 w-8" />}
              title={t('search.tooShort.title', 'Type at least 2 characters')}
              message={t('search.tooShort.message', 'Search across vehicles, drives, charging sessions, alerts, geofences, automations and more.')}
            />
          </GlassPanel>
        ) : trimmed.length === 0 ? (
          <GlassPanel className="p-6">
            <EmptyState
              icon={<SearchIcon className="h-8 w-8" />}
              title={t('search.empty.title', 'Start typing to search')}
              message={t('search.empty.message', 'Search across vehicles, drives, charging sessions, alerts, geofences, automations and more.')}
            />
          </GlassPanel>
        ) : error ? (
          <GlassPanel className="p-6">
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
              icon={<SearchIcon className="h-8 w-8" />}
              title={t('search.error.title', 'Search failed')}
              message={t('search.error.message', 'The search service did not respond. Try again or refine your query.')}
            />
          </GlassPanel>
        ) : isFetching && groupedHits.length === 0 ? (
          <GlassPanel className="p-6">
            <Skeleton className="h-4 w-1/3" />
            <div className="mt-4 space-y-2">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          </GlassPanel>
        ) : groupedHits.length === 0 ? (
          <GlassPanel className="p-6">
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
              icon={<SearchIcon className="h-8 w-8" />}
              title={t('search.noResults.title', 'No results')}
              message={t('search.noResults.message', { query: trimmed, defaultValue: `No matches for "${trimmed}". Try fewer characters or open the command palette.` })}
            />
          </GlassPanel>
        ) : (
          <div className="space-y-4">
            {groupedHits.map((group) => (
              <GlassPanel key={group.type} className="p-4">
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                  {searchHitIconSm(group.type)}
                  {searchSectionLabel(group.type, t)}
                  <span className="ml-1 rounded-full border border-[var(--glass-border)] bg-[var(--surface-2)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">
                    {group.hits.length}
                  </span>
                </h2>
                <ul className="divide-y divide-[var(--glass-border)]">
                  {group.hits.map((hit) => (
                    <li key={`${hit.type}-${hit.id}`}>
                      <button
                        type="button"
                        onClick={() => navigate(hit.url)}
                        className="flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left transition-colors hover:bg-[var(--surface-2)]"
                      >
                        <span className="text-[var(--text-muted)]">
                          {searchHitIconSm(hit.type)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-[var(--text-primary)]">{hit.title}</span>
                          {hit.subtitle && (
                            <span className="block truncate text-xs text-[var(--text-muted)]">{hit.subtitle}</span>
                          )}
                        </span>
                        {hit.when && (
                          <span className="hidden flex-shrink-0 sm:inline">
                            <TimeStamp value={hit.when} className="text-xs text-[var(--text-muted)]" />
                          </span>
                        )}
                        <ArrowRight className="h-4 w-4 flex-shrink-0 text-[var(--text-muted)]" />
                      </button>
                    </li>
                  ))}
                </ul>
              </GlassPanel>
            ))}
          </div>
        )}
      </div>
    </PageContainer>
  )
}

// Compact icon variant used in chips and rows. Module-scope so the page
// component is not re-creating <Icon /> elements every render.
function searchHitIconSm(type: SearchHitType): JSX.Element {
  switch (type) {
    case 'vehicle': return <Car className="h-4 w-4" />
    case 'drive': return <Route className="h-4 w-4" />
    case 'charging': return <BatteryCharging className="h-4 w-4" />
    case 'alert': return <BellRing className="h-4 w-4" />
    case 'notification': return <Bell className="h-4 w-4" />
    case 'geofence': return <MapPinned className="h-4 w-4" />
    case 'automation': return <Workflow className="h-4 w-4" />
    case 'location': return <MapPin className="h-4 w-4" />
    case 'trip': return <Compass className="h-4 w-4" />
    default: return <SearchIcon className="h-4 w-4" />
  }
}

function searchSectionLabel(
  type: SearchHitType,
  t: TFunction,
): string {
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
