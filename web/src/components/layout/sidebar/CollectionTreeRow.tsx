import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/runtime'
import { cn } from '@/lib/cn'
import { Icons } from '@/lib/icons'
import { PrefetchNavLink } from '../PrefetchLink'
import type { SectionGroup } from '../sectionGroups'
import { routeIconColor } from './iconColors'
import { SIDEBAR_COLLECTION_ICONS } from './sidebarCollectionIcons'

interface CollectionTreeRowProps {
  group: SectionGroup
  pathname: string
  flattened?: boolean
  onSelect?: () => void
  dataTour?: string
  statusCount?: number
  statusLabel?: string
  statusPath?: string
  pinnedPaths?: ReadonlySet<string>
  onPin?: (to: string) => void
  onUnpin?: (to: string) => void
}

export function CollectionTreeRow({
  group, pathname, flattened = false, onSelect, dataTour, statusCount, statusLabel, statusPath, pinnedPaths, onPin, onUnpin,
}: CollectionTreeRowProps) {
  const { t } = useTranslation()
  const active = group.pages.some(page => page.to === pathname)
  const [expanded, setExpanded] = useState(active)
  useEffect(() => {
    if (active) setExpanded(true)
  }, [active, pathname])

  const label = t(group.labelKey, group.label)
  const visiblePages = group.pages.filter(page => !pinnedPaths?.has(page.to))
  const GroupIcon = SIDEBAR_COLLECTION_ICONS[group.primary] ?? group.pages[0]?.icon ?? Icons.folderOpen
  const childrenId = `collection-${group.primary.slice(1).replace(/\W/g, '-')}`
  return (
    <div
      data-collection={group.primary}
      className={cn(
        flattened ? 'relative' : 'ms-2.5 border-s-2 ps-2',
        !flattened && (active ? 'border-[var(--theme-primary)]' : 'border-[var(--border-default)]'),
      )}
    >
      {!flattened && <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setExpanded(value => !value)}
        aria-expanded={expanded}
        aria-controls={childrenId}
        aria-label={t('nav.collections.toggle', '{{group}}, {{count}} views', { group: label, count: visiblePages.length })}
        data-tour={dataTour}
        className={cn(
          'flex min-h-10 w-full min-w-0 items-center justify-start gap-2 rounded-shape-md px-1.5 py-1.5 text-start text-sm hover:bg-[var(--surface-2)]',
          active ? 'font-semibold text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
        )}
      >
        <Icons.next className={cn('h-3 w-3 shrink-0 transition-transform', expanded && 'rotate-90')} aria-hidden />
        <GroupIcon className={cn('h-4 w-4 shrink-0', routeIconColor(group.pages[0]?.color))} aria-hidden />
        <span className="min-w-0 flex-1 break-words leading-snug" title={label}>{label}</span>
        {statusCount != null && statusCount > 0 && (
          <span className="shrink-0 rounded-shape-sm bg-[var(--surface-3)] px-1.5 text-xs tabular-nums" title={statusLabel}>
            {statusCount}
          </span>
        )}
        <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[var(--surface-2)] px-1.5 text-xs tabular-nums text-[var(--text-secondary)]" aria-hidden>
          {visiblePages.length}
        </span>
      </Button>}
      {(flattened || expanded) && (
        <div
          id={childrenId}
          role="group"
          aria-label={flattened ? undefined : label}
          className={cn('space-y-px', !flattened && 'ms-3 border-s border-[var(--border-default)] ps-1.5')}
        >
          {visiblePages.map(page => {
            const PageIcon = page.icon ?? Icons.fileText
            return (
            <div
              key={page.to}
              className={cn(
                'group/collection-page relative flex items-center before:absolute before:top-1/2 before:h-px',
                flattened ? 'before:-start-2 before:w-2' : 'before:-start-1.5 before:w-1.5',
                pathname === page.to ? 'before:bg-[var(--theme-primary)]' : 'before:bg-[var(--border-default)]',
              )}
            >
              <PrefetchNavLink
                to={page.to}
                end
                onClick={onSelect}
                aria-current={pathname === page.to ? 'page' : undefined}
                title={t(page.labelKey, page.label)}
                className={cn(
                  'flex min-h-11 min-w-0 flex-1 items-center gap-2 whitespace-normal break-words rounded-shape-md border-s-2 px-2 py-2 text-sm leading-snug transition-colors lg:min-h-9',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]',
                  pathname === page.to
                    ? 'border-[var(--theme-primary)] bg-[var(--surface-3)] font-semibold text-[var(--text-primary)]'
                    : 'border-transparent text-[var(--text-secondary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]',
                )}
              >
                <PageIcon className={cn('h-4 w-4 shrink-0', routeIconColor(page.color))} aria-hidden />
                <span className="min-w-0 break-words">{t(page.labelKey, page.label)}</span>
              </PrefetchNavLink>
              {flattened && page.to === (statusPath ?? group.primary) && statusCount != null && statusCount > 0 && (
                <span className="shrink-0 rounded-shape-sm bg-[var(--surface-3)] px-1.5 text-xs tabular-nums" title={statusLabel}>
                  {statusCount}
                </span>
              )}
              {onPin && onUnpin && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => pinnedPaths?.has(page.to) ? onUnpin(page.to) : onPin(page.to)}
                  aria-label={pinnedPaths?.has(page.to)
                    ? t('nav.unpinPage', { page: t(page.labelKey, page.label), defaultValue: 'Unpin {{page}}' })
                    : t('nav.pinPage', { page: t(page.labelKey, page.label), defaultValue: 'Pin {{page}} to favorites' })}
                  className="h-7 w-7 shrink-0 p-0 text-[var(--text-muted)] lg:opacity-0 lg:group-hover/collection-page:opacity-100 focus-visible:opacity-100"
                >
                  <Icons.star className={cn('h-3 w-3', pinnedPaths?.has(page.to) && 'fill-current')} aria-hidden />
                </Button>
              )}
            </div>
          )})}
        </div>
      )}
    </div>
  )
}
