import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRight } from 'lucide-react'
import { Badge, BUTTON_BASE, BUTTON_VARIANTS, GlassPanel, PanelTitle, Text } from '@/components/ui'
import { TimeStamp } from '@/components/data-display'
import { neonColorMap, typography } from '@/lib/tokens'
import { cn } from '@/lib/cn'
import { searchHitIconSm, searchSectionLabel, type SearchHitGroup } from './searchHelpers'

export function SearchResultGroup({ group }: { group: SearchHitGroup }) {
  const { t } = useTranslation()
  const accent = neonColorMap.neutral
  return (
    <GlassPanel className="p-4 sm:p-5">
      <div className="mb-3 flex items-center gap-2">
        <span className={cn('flex items-center justify-center rounded-lg p-1.5 ring-1', accent.bg, accent.ring, accent.text)}>
          {searchHitIconSm(group.type)}
        </span>
        <PanelTitle className="min-w-0 flex-1 break-words">
          {searchSectionLabel(group.type, t)}
        </PanelTitle>
        <Badge variant="neutral" size="sm">{group.hits.length}</Badge>
      </div>
      <ul className="divide-y divide-[var(--glass-border)]">
        {group.hits.map(hit => (
          <li key={`${hit.type}-${hit.id}`}>
            <Link
              to={hit.url}
              aria-label={t('search.result.open', 'Open {{title}}', { title: hit.title })}
              className={cn(
                BUTTON_BASE, BUTTON_VARIANTS.ghost,
                'min-h-11 w-full flex-wrap justify-start gap-3 rounded-lg px-2 py-3 text-start whitespace-normal',
                typography.weight.regular,
              )}
            >
              <span className={cn('shrink-0', accent.text)}>{searchHitIconSm(hit.type)}</span>
              <span className="min-w-0 flex-1">
                <Text as="span" variant="body" className="block break-words">{hit.title}</Text>
                {hit.subtitle && (
                  <Text as="span" variant="caption" className="block break-words">{hit.subtitle}</Text>
                )}
              </span>
              {hit.when && (
                <TimeStamp
                  value={hit.when}
                  className={cn('max-w-full basis-full break-words sm:basis-auto sm:shrink-0', typography.role.caption)}
                />
              )}
              <ArrowRight className="h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </GlassPanel>
  )
}
