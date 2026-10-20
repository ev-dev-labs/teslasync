import { useTranslation } from 'react-i18next'
import { Search } from 'lucide-react'
import { Button, GlassPanel, SectionTitle } from '@/components/ui'
import { AlertBanner, EmptyState, QueryError, Skeleton } from '@/components/feedback'
import { SearchResultGroup } from './SearchResultGroup'
import type { SearchHitGroup } from './searchHelpers'

interface SearchResultsProps {
  isIdle: boolean
  tooShort: boolean
  error: Error | null
  coldPaused: boolean
  initialLoading: boolean
  displayedQuery: string
  groups: SearchHitGroup[]
  onRetry: () => void
}

export function SearchResults({
  isIdle, tooShort, error, coldPaused, initialLoading, displayedQuery, groups, onRetry,
}: SearchResultsProps) {
  const { t } = useTranslation()
  if (isIdle || tooShort) {
    return (
      <GlassPanel className="p-6">
        <EmptyState /* no-action: transient guidance until a searchable query is entered */
          icon={<Search className="h-8 w-8" aria-hidden="true" />}
          title={isIdle ? t('search.empty.title', 'Start typing to search') : t('search.tooShort.title', 'Type at least 2 characters')}
          message={isIdle
            ? t('search.empty.message', 'Search across vehicles, drives, charging sessions, alerts, geofences, automations and more.')
            : t('search.tooShort.message', 'Search across vehicles, drives, charging sessions, alerts, geofences, automations and more.')}
        />
      </GlassPanel>
    )
  }
  if (error) {
    return <GlassPanel className="p-6"><QueryError error={error} onRetry={onRetry} /></GlassPanel>
  }
  if (coldPaused) {
    return (
      <GlassPanel className="p-4 sm:p-5">
        <AlertBanner variant="info" role="status" title={t('search.paused.title', 'Search request paused')}>
          {t('search.paused.message', 'The search request is paused. No response has been received, so result counts are unknown. Retry when the request can resume.')}
        </AlertBanner>
        <Button type="button" variant="secondary" wrapLabel className="mt-3 min-h-11" onClick={onRetry}>
          {t('error.retry', 'Retry')}
        </Button>
      </GlassPanel>
    )
  }
  if (initialLoading) {
    return (
      <GlassPanel className="p-4 sm:p-5">
        <Skeleton className="h-4 w-1/3" />
        <div className="mt-4 space-y-2">
          {[0, 1, 2, 3, 4].map(i => <Skeleton key={i} height={48} className="w-full" />)}
        </div>
      </GlassPanel>
    )
  }
  if (groups.length === 0) {
    return (
      <GlassPanel className="p-6">
        <EmptyState /* no-action: transient empty state — no entities matched the query */
          icon={<Search className="h-8 w-8" aria-hidden="true" />}
          title={t('search.noResults.title', 'No results')}
          message={t('search.noResults.message', {
            query: displayedQuery,
            defaultValue: 'No matches for "{{query}}". Try fewer characters or open the command palette.',
          })}
        />
      </GlassPanel>
    )
  }
  return (
    <section aria-label={t('search.results.region', 'Search results')} className="space-y-3">
      <SectionTitle>{t('search.results.heading', 'Results')}</SectionTitle>
      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4">
        {groups.map(group => <SearchResultGroup key={group.type} group={group} />)}
      </div>
    </section>
  )
}
