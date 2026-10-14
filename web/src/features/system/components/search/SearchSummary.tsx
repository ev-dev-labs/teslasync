import { useTranslation } from 'react-i18next'
import { SystemSummaryBrief } from '../operationalbrief-all/SystemSummaryBrief'
import { ALL_TYPES, searchSectionLabel, type SearchHitGroup } from './searchHelpers'

interface SearchSummaryProps {
  scope: string
  hasData: boolean
  loading: boolean
  retained: boolean
  coldPaused: boolean
  hitCount: number
  categoryCount: number
  filterCount: number
  topGroup: SearchHitGroup | null
}

export function SearchSummary({
  scope, hasData, loading, retained, coldPaused, hitCount, categoryCount, filterCount, topGroup,
}: SearchSummaryProps) {
  const { t } = useTranslation()
  return (
    <SystemSummaryBrief
      title={t('search.kpis', 'Search summary')}
      description={t('search.brief.responseDescription', 'Result counts and category coverage for the displayed search response.')}
      scope={scope}
      available={hasData}
      loading={loading}
      retained={retained}
      statusLabel={coldPaused ? t('search.paused.title', 'Search request paused') : undefined}
      metrics={[
        { metricId: 'count', occurrenceId: 'results', rawValue: hasData ? hitCount : null, label: t('search.kpi.totalResults', 'Total results'),
          context: t('search.brief.scope', 'Returned search hits, not an unbounded server total.') },
        { metricId: 'count', occurrenceId: 'categories', rawValue: hasData ? categoryCount : null, label: t('search.kpi.categories', 'Categories'),
          context: t('search.kpi.ofTypes', 'of {{n}} searchable', { n: ALL_TYPES.length }) },
        { metricId: 'count', occurrenceId: 'filters', rawValue: filterCount, label: t('search.kpi.activeFilters', 'Active filters'),
          context: filterCount > 0 ? t('search.kpi.filtered', 'of {{n}} types', { n: ALL_TYPES.length }) : t('search.kpi.allTypes', 'All types shown') },
      ]}
      textMetrics={[{
        key: 'top-match', label: t('search.kpi.topMatch', 'Top match'),
        value: topGroup ? searchSectionLabel(topGroup.type, t) : '—',
        valueState: topGroup ? 'value' : 'missing',
        detail: topGroup ? t('search.kpi.topCount', '{{n}} results', { n: topGroup.hits.length })
          : hasData ? t('search.kpi.noMatches', 'No matches') : t('common.unknown', 'Unknown'),
      }]}
    />
  )
}
