import { useEffect, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Input } from '@/components/ui/runtime'
import { IconButton } from '@/components/ui/IconButton'
import { VisuallyHidden } from '@/components/a11y'
import { Icons } from '@/lib/icons'
import type { SidebarSectionInput, SectionGroup } from '../sectionGroups'
import { PrefetchNavLink } from '../PrefetchLink'
import { isExclusiveActivePath } from './compactNav'
import { flattenSidebarItems, type FlatSidebarEntry } from './collections'
import { NavSectionHeader } from './NavSectionHeader'
import { SidebarRow } from './SidebarRow'
import { deriveNavGroups, PINNED } from '../horizontal-nav/navGroups'
import { NavPageBadge } from '../horizontal-nav/NavPageBadge'
import { inlineKeys } from '../horizontal-nav/navKeyboard'
import type { SidebarSuggestion } from './sidebarSuggest'
import { resolveSectionIcon } from './sidebarIcons'
import type { DeckSelection } from './CommandDeck'

export interface AtlasPanelProps {
  view: DeckSelection
  onHomeViewChange?: (view: DeckSelection | null) => void
  onClose?: () => void
  sections: SidebarSectionInput[]
  pinnedItems: SidebarSectionInput['items']
  suggestions?: SidebarSuggestion[]
  pathname: string
  navLabel: (item: { label: string; labelKey: string }) => string
  navSectionTitle: (section: { title: string; titleKey?: string }) => string
  onPin: (to: string) => void
  onUnpin: (to: string) => void
  pinSyncUnavailable?: boolean
  onItemSelect?: () => void
  alertCount?: number
  vehicleCount?: number
  staleCount?: number
  vehicleId?: string
  collections?: readonly SectionGroup[]
}
const GROUP_STORAGE = 'teslasync-sidenav-collapsed-groups-v2'
function readCollapsed(): Record<string, boolean> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(GROUP_STORAGE) ?? '{}')
    return value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).filter(([key, closed]) => !key.endsWith(':recent') && typeof closed === 'boolean'))
      : {}
  } catch { return {} }
}

/** Vertical section content for the docked panel and tablet drawer. */
export function AtlasPanel({ view, onHomeViewChange, onClose, sections = [], pinnedItems = [], suggestions = [], pathname,
  navLabel, navSectionTitle, onPin, onUnpin, pinSyncUnavailable = false, onItemSelect, alertCount = 0, vehicleCount = 0, staleCount = 0, vehicleId, collections = [] }: AtlasPanelProps) {
  const { t } = useTranslation()
  const id = useId()
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [query, setQuery] = useState('')
  const [filterClosed, setFilterClosed] = useState<Set<string>>(() => new Set())
  const viewKey = view.kind === 'section' ? `section:${view.title}` : view.kind
  const section = view.kind === 'section' ? sections.find(candidate => candidate.title === view.title) : undefined
  const title = view.kind === 'suggested' ? t('nav.suggested', 'Suggested')
    : view.kind === 'favorites' ? t('nav.deck.saved', 'Saved') : section ? navSectionTitle(section) : t('nav.empty', 'No pages yet.')
  const allPaths = useMemo(() => sections.flatMap(candidate => flattenSidebarItems(candidate.items, collections).map(item => item.to)), [sections, collections])
  const isActive = (to: string) => isExclusiveActivePath(pathname, to, allPaths)
  const pinned = new Set(pinnedItems.map(item => item.to))
  const filtering = query.trim().length > 0
  const { groups, collectionIds } = deriveNavGroups(section, { collections, pinnedPaths: pinned }, query, t)
  const activeGroup = groups.find(group => group.id !== PINNED && group.pages.some(item => isActive(item.to)))?.id
  const [activeGroupOverride, setActiveGroupOverride] = useState<{ route: string; closed: boolean }>()
  const activeClosed = activeGroupOverride?.route === pathname && activeGroupOverride.closed
  const isOpen = (key: string) => filtering ? !filterClosed.has(key) : key === activeGroup ? !activeClosed : !collapsed[viewKey + ':' + key]
  const SectionIcon = resolveSectionIcon(section?.title ?? 'Home')
  const toggle = (key: string) => {
    if (filtering) setFilterClosed(previous => { const next = new Set(previous); if (next.has(key)) next.delete(key); else next.add(key); return next })
    else {
      if (key === activeGroup) setActiveGroupOverride({ route: pathname, closed: isOpen(key) })
      setCollapsed(previous => ({ ...previous, [viewKey + ':' + key]: isOpen(key) }))
    }
  }
  useEffect(() => { setQuery('') }, [viewKey])
  useEffect(() => {
    try { localStorage.setItem(GROUP_STORAGE, JSON.stringify(collapsed)) } catch { /* Navigation remains usable with storage disabled. */ }
  }, [collapsed])

  const row = (item: FlatSidebarEntry, key = item.to, quickPin = false, context?: string) => {
    const label = navLabel(item)
    const pinLabel = pinned.has(item.to) ? t('nav.unpinPage', { page: label, defaultValue: 'Unpin {{page}}' })
      : t('nav.pinPage', { page: label, defaultValue: 'Pin {{page}} to favorites' })
    const trailing = item.badge ? <NavPageBadge badge={item.badge} model={{ vehicleId, unreadCount: alertCount, vehicleCount, staleCount }} /> : null
    return <SidebarRow key={key} to={item.to} label={label} icon={item.icon} active={isActive(item.to)} context={context}
      ariaLabel={quickPin ? t('nav.deck.quickAccessLink', { page: label, defaultValue: 'Quick access: {{page}}' }) : undefined}
      onSelect={onItemSelect} onDoubleClick={() => { if (!pinned.has(item.to)) onPin(item.to) }} trailing={trailing} dataTour={item.dataTour}
      hoverAction={<IconButton icon={<Icons.pin className={pinned.has(item.to) ? 'h-4 w-4 fill-current' : 'h-4 w-4'} aria-hidden />}
        label={pinLabel} className="sidenav-pin min-h-11 min-w-11" onClick={() => pinned.has(item.to) ? onUnpin(item.to) : onPin(item.to)}
        aria-describedby={pinSyncUnavailable ? `${id}-pin-offline` : undefined} data-testid={`atlas-pin-${item.to}`} />} />
  }
  const groupHeader = (key: string, label: string, count: number) => <Button type="button" variant="ghost" size="sm"
    data-nav-choice aria-label={label} aria-expanded={isOpen(key)} aria-controls={`${id}-${key}`} onClick={() => toggle(key)}
    onKeyDown={event => {
      if (event.key !== inlineKeys(event.currentTarget).forward) return
      event.preventDefault()
      if (isOpen(key)) event.currentTarget.nextElementSibling?.querySelector<HTMLElement>('[data-nav-choice]')?.focus()
      else toggle(key)
    }}
    className="sidenav-group-header min-h-11 w-full justify-start gap-2 px-2 text-sm text-[var(--text-secondary)]">
    {isOpen(key) ? <Icons.expand className="h-4 w-4 shrink-0" aria-hidden /> : <Icons.next className="h-4 w-4 shrink-0 rtl:rotate-180" aria-hidden />}
    <span className="min-w-0 flex-1 truncate text-start">{label}</span>
    <span aria-hidden className="rounded-shape-sm bg-[var(--surface-3)] px-2 text-xs tabular-nums">{count}</span>
  </Button>
  const collectionKeys = collectionIds
  const anyClosed = collectionKeys.some(key => !isOpen(key))
  return <div role="navigation" data-app-part="navigation" aria-label={t('nav.sidebar', 'Sidebar navigation')} data-testid="atlas-panel-secondary"
    className="sidenav-panel flex h-full min-h-0 w-full flex-col border-s border-e border-[var(--border-default)] bg-[var(--nav-context-bg)]">
    <div data-app-nav-slot="heading" className="flex h-12 shrink-0 items-center gap-1 border-b border-[var(--border-default)] px-2">
      <SectionIcon className="ms-1 h-5 w-5 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1 truncate px-1 text-sm font-medium">{title}</p>
      {collectionKeys.length > 1 && <IconButton label={anyClosed ? t('nav.deck.expandAllGroups', 'Expand all groups') : t('nav.deck.collapseAllGroups', 'Collapse all groups')}
        icon={anyClosed ? <Icons.expandAll className="h-5 w-5" aria-hidden /> : <Icons.collapseAll className="h-5 w-5" aria-hidden />}
        onClick={() => {
          if (filtering) setFilterClosed(new Set(anyClosed ? [] : collectionKeys))
          else {
            if (activeGroup) setActiveGroupOverride({ route: pathname, closed: !anyClosed })
            setCollapsed(previous => ({ ...previous, ...Object.fromEntries(collectionKeys.map(key => [viewKey + ':' + key, !anyClosed])) }))
          }
        }} className="min-h-11 min-w-11" />}
      <IconButton label={t('nav.sidenav.hidePanel', 'Hide panel')} icon={<Icons.close className="h-4 w-4" aria-hidden />} onClick={onClose} className="min-h-11 min-w-11" />
    </div>
    {section && <div data-app-nav-slot="filter" className="shrink-0 px-3 pt-3"><Input className="sidenav-filter" type="search" value={query} onChange={event => { setQuery(event.target.value); setFilterClosed(new Set()) }}
      aria-label={t('nav.sidenav.filterLabel', { section: title, defaultValue: 'Filter {{section}} pages' })}
      placeholder={t('nav.sidenav.filter', { section: title, defaultValue: 'Filter {{section}}…' })} icon={<Icons.filter className="h-4 w-4" aria-hidden />}
      suffix={query ?
        /* not-destructive: clears transient section-filter text only; saved groups, pins and page data are unchanged */
        <IconButton label={t('nav.deck.clearFilter', 'Clear filter')} icon={<Icons.close className="h-4 w-4" aria-hidden />} onClick={() => setQuery('')} />
      : undefined} /></div>}
    {pinSyncUnavailable && <VisuallyHidden as="p" id={`${id}-pin-offline`}>{t('nav.deck.pinOfflineHint', 'Saved here until navigation pins can sync')}</VisuallyHidden>}
    <div data-app-nav-slot="pages" className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 pb-8 pt-3 scrollbar-thin">
      {(section?.title === 'Home' || view.kind !== 'section') && <div className="space-y-1 border-b border-[var(--border-default)] pb-3">
        {view.kind !== 'section' && <Button variant="ghost" className="w-full justify-start" onClick={() => onHomeViewChange?.(null)}>{t('nav.groups.home', 'Home')}</Button>}
        <Button variant="ghost" className="w-full justify-between" onClick={() => onHomeViewChange?.({ kind: 'suggested' })}><span>{t('nav.deck.suggested', 'Suggested')}</span><span>{suggestions.length}</span></Button>
        <Button variant="ghost" className="w-full justify-between" onClick={() => onHomeViewChange?.({ kind: 'favorites' })}><span>{t('nav.deck.saved', 'Saved')}</span><span>{pinnedItems.length}</span></Button>
        <PrefetchNavLink to="/explore" onClick={onItemSelect} className="flex min-h-11 items-center justify-between px-3 text-sm"><span>{t('nav.deck.allPages', 'All pages')}</span><span>{new Set(allPaths).size}</span></PrefetchNavLink>
      </div>}
      {view.kind === 'suggested' && <>
        {suggestions.length === 0 && <p className="px-2 py-4 text-xs text-[var(--text-muted)]">{t('nav.deck.allCaughtUp', 'All caught up — nothing needs you right now.')}</p>}
        {(['now', 'related'] as const).map(kind => <div key={kind}>{suggestions.some(item => (item.kind === 'now') === (kind === 'now')) && <>
          <NavSectionHeader label={kind === 'now' ? t('nav.deck.now', 'Now') : t('nav.deck.upNext', 'Up next')} />
          {suggestions.filter(item => (item.kind === 'now') === (kind === 'now')).map(item => row(item, `suggested-${item.to}`, false, item.reason))}
        </>}</div>)}
      </>}
      {view.kind === 'favorites' && <>{pinnedItems.length ? pinnedItems.map(item => row(item)) : <p className="px-2 py-4 text-xs text-[var(--text-muted)]">{t('nav.deck.noFavorites', 'Pin pages from any row and they will live here.')}</p>}</>}
      {section && <>
        {filtering && groups.length === 0 && <p role="status" className="px-2 py-4 text-sm text-[var(--text-muted)]">{t('nav.sidenav.noMatches', { query: query.trim(), defaultValue: 'No pages match "{{query}}".' })}</p>}
        {groups.map(group => {
          const quickPin = group.id === PINNED
          const pages = quickPin ? group.pages.filter(item => !isActive(item.to)) : group.pages
          if (!pages.length) return null
          return <div key={group.id}>
            {!group.ungrouped && groupHeader(group.id, group.label, pages.length)}
            <div id={group.ungrouped ? undefined : `${id}-${group.id}`}>{(group.ungrouped || isOpen(group.id)) &&
              pages.map(item => row(item, quickPin ? `pinned-${item.to}` : item.to, quickPin))}</div>
          </div>
        })}
      </>}
    </div>
  </div>
}
export default AtlasPanel
