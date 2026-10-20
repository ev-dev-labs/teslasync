import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw } from 'lucide-react'
import { PageLayout } from '@/components/layout'
import { Button } from '@/components/ui'
import { StaleRefreshWarning } from '@/components/feedback'
import { FadeIn } from '@/components/motion'
import { AINLSearch } from '@/components/ai'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useDataState } from '@/hooks/useDataState'
import { useLoadAnnouncement } from '@/hooks/useStatusAnnouncer'
import { useUrlString, useUrlArray } from '@/hooks/useUrlState'
import { useGlobalSearch, isSearchQueryEnabled } from '@/api/hooks/useSearch'
import type { SearchHitType } from '@/api/types'
import { SearchToolbar } from '../components/search/SearchToolbar'
import { SearchSummary } from '../components/search/SearchSummary'
import { SearchCoverage } from '../components/search/SearchCoverage'
import { SearchResults } from '../components/search/SearchResults'
import { ALL_TYPES, groupSearchHits, searchTypeScopeLabel, type SearchHitGroup } from '../components/search/searchHelpers'

/**
 * URL-driven app-wide search. The page requests 25 hits per type rather than
 * the command palette's preview and keeps request scope separate from retained results.
 */
export default function SearchPage() {
  const { t } = useTranslation()
  const [query, setQuery] = useUrlString('q', '')
  const [activeTypes, setActiveTypes] = useUrlArray('types')
  usePageTitle(t('search.title', 'Search'))

  const trimmed = query.trim()
  const tooShort = trimmed.length > 0 && !isSearchQueryEnabled(trimmed)
  const typesFilter = useMemo<SearchHitType[]>(() =>
    [...new Set(activeTypes)].filter((type): type is SearchHitType =>
      (ALL_TYPES as string[]).includes(type)),
  [activeTypes])

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
  const failedTypes = data?.completeness?.failed_types ?? []
  const limited = (data?.completeness?.limit_reached_types ?? []).length > 0
    || data?.completeness?.total_limit_reached === true
  const groupedHits = useMemo(() => groupSearchHits(hits), [hits])
  const topGroup = useMemo(() =>
    groupedHits.reduce<SearchHitGroup | null>(
      (best, group) => group.hits.length > (best?.hits.length ?? 0) ? group : best, null),
  [groupedHits])

  const isIdle = trimmed.length === 0
  const isActiveSearch = !isIdle && !tooShort && !error
  // An empty response is still retained data; refreshing it keeps measured zeroes.
  const coldPaused = !state.hasData && state.isRefreshBlocked
  const initialLoading = searchQuery.isPending && !state.hasData && !coldPaused
  const displayedQuery = data?.query ?? trimmed
  const displayedTypes = searchQuery.isPlaceholderData
    ? responseScope.current?.query === displayedQuery ? responseScope.current.types : null
    : typesFilter
  const resultScope = t('search.brief.resultScope', 'for “{{query}}” · result types: {{types}}', {
    query: displayedQuery, types: searchTypeScopeLabel(displayedTypes, t),
  })
  const settled = searchQuery.isSuccess && !searchQuery.isPlaceholderData && !isFetching

  useLoadAnnouncement({
    label: t('search.brief.announcementScope', 'search results for “{{query}}” · types: {{types}}', {
      query: displayedQuery, types: searchTypeScopeLabel(displayedTypes, t),
    }),
    isLoading: searchQuery.isPending || isFetching || searchQuery.isPlaceholderData,
    isError: Boolean(error || state.refreshError),
    count: settled && state.hasData ? hits.length : undefined,
    enabled: !isIdle && !tooShort && !state.isRefreshBlocked
      && (settled && state.hasData || Boolean(error || state.refreshError)),
  })

  function toggleType(type: SearchHitType) {
    setActiveTypes(typesFilter.includes(type)
      ? typesFilter.filter(value => value !== type)
      : [...typesFilter, type])
  }

  return (
    <PageLayout
      title={t('search.title', 'Search')}
      subtitle={t('search.subtitle', 'Find vehicles, drives, charging, alerts and more across your fleet')}
      query={isActiveSearch ? searchQuery : undefined}
      announce={false}
      busy={!isIdle && !tooShort && isFetching}
      secondaryActions={isActiveSearch ? (
        <Button
          variant="ghost"
          onClick={() => refetch()}
          aria-label={t('search.refresh', 'Refresh results')}
          className="min-h-11 min-w-11"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
        </Button>
      ) : undefined}
    >
      {!isIdle && !tooShort && <StaleRefreshWarning state={state} />}
      <AINLSearch />
      <FadeIn delay={0.05}>
        <SearchToolbar
          query={query}
          types={typesFilter}
          showScope={!isIdle && !tooShort}
          isFetching={isFetching}
          onQueryChange={setQuery}
          onToggleType={toggleType}
          onClearFilters={() => setActiveTypes([])}
        />
      </FadeIn>
      {isActiveSearch && (
        <FadeIn delay={0.1}>
          <SearchSummary
            scope={resultScope}
            hasData={state.hasData}
            loading={initialLoading}
            retained={state.hasData && (state.status === 'stale' || searchQuery.isPlaceholderData)}
            coldPaused={coldPaused}
            hitCount={hits.length}
            categoryCount={groupedHits.length}
            filterCount={typesFilter.length}
            topGroup={topGroup}
          />
        </FadeIn>
      )}
      {isActiveSearch && state.hasData && (failedTypes.length > 0 || limited) && (
        <SearchCoverage scope={resultScope} failedTypes={failedTypes} limited={limited} />
      )}
      <FadeIn delay={0.15}>
        <SearchResults
          isIdle={isIdle}
          tooShort={tooShort}
          error={error}
          coldPaused={coldPaused}
          initialLoading={initialLoading}
          displayedQuery={displayedQuery}
          groups={groupedHits}
          onRetry={() => refetch()}
        />
      </FadeIn>
    </PageLayout>
  )
}
