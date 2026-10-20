import { useTranslation } from 'react-i18next'
import { Search } from 'lucide-react'
import type { SearchHitType } from '@/api/types'
import { Button, GlassPanel, Input, Text } from '@/components/ui'
import { ALL_TYPES, searchHitIconSm, searchSectionLabel, searchTypeScopeLabel } from './searchHelpers'

interface SearchToolbarProps {
  query: string
  types: SearchHitType[]
  showScope: boolean
  isFetching: boolean
  onQueryChange: (query: string) => void
  onToggleType: (type: SearchHitType) => void
  onClearFilters: () => void
}

export function SearchToolbar({
  query, types, showScope, isFetching, onQueryChange, onToggleType, onClearFilters,
}: SearchToolbarProps) {
  const { t } = useTranslation()
  return (
    <GlassPanel className="p-4 sm:p-5">
      <Input
        type="search"
        size="lg"
        value={query}
        onChange={e => onQueryChange(e.target.value)}
        placeholder={t('search.placeholder', 'Search vehicles, drives, charging…')}
        label={t('search.input.label', 'Search query')}
        icon={<Search className="h-4 w-4" aria-hidden="true" />}
        aria-label={t('search.input.label', 'Search query')}
        autoFocus
      />
      <div
        role="group"
        aria-label={t('search.filters.label', 'Filter results by type')}
        className="mt-4 flex flex-wrap items-center gap-2"
      >
        {ALL_TYPES.map(type => (
          <Button
            key={type}
            type="button"
            size="sm"
            variant={types.includes(type) ? 'primary' : 'outline'}
            aria-pressed={types.includes(type)}
            onClick={() => onToggleType(type)}
            wrapLabel
            className="min-h-11 max-w-full rounded-full"
          >
            {searchHitIconSm(type)}
            {searchSectionLabel(type, t)}
          </Button>
        ))}
        {types.length > 0 && (
          <Button type="button" size="sm" variant="ghost" onClick={onClearFilters} className="min-h-11 rounded-full">
            {t('search.filters.clear', 'Clear filters')}
          </Button>
        )}
      </div>
      {showScope && (
        <Text variant="caption" className="mt-3 break-words">
          {t('search.brief.requestedScope', 'Requested: “{{query}}” · types: {{types}}', {
            query: query.trim(), types: searchTypeScopeLabel(types, t),
          })}
        </Text>
      )}
      {showScope && isFetching && (
        <Text variant="caption" className="mt-2">
          {t('freshness.updating', 'Updating…')}
        </Text>
      )}
    </GlassPanel>
  )
}
