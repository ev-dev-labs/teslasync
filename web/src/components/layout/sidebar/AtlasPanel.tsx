import { useEffect, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Input } from '@/components/ui/runtime'
import { IconButton } from '@/components/ui/IconButton'
import { Icons } from '@/lib/icons'
import type { SidebarSectionInput, SectionGroup } from '../sectionGroups'
import { PrefetchNavLink } from '../PrefetchLink'
import { isExclusiveActivePath } from './compactNav'
import { groupSidebarItems, flattenSidebarItems, type FlatSidebarEntry } from './collections'
import { matchesSidebarTokens, searchSidebarSections, tokenizeSidebarQuery } from './sidebarSearch'
import { NavSectionHeader } from './NavSectionHeader'
import { SidebarCountChip, SidebarNotificationDot, SidebarRow } from './SidebarRow'
import { SidebarDriveBadge } from './SidebarDriveBadge'
import type { SidebarSuggestion } from './sidebarSuggest'
import type { DeckSelection } from './CommandDeck'

export interface AtlasPanelProps {
  view: DeckSelection
  onHomeViewChange?: (view: DeckSelection | null) => void
  onClose?: () => void
  sections: SidebarSectionInput[]
  pinnedItems: SidebarSectionInput['items']
  recentItems?: SidebarSectionInput['items']
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
const GROUP_STORAGE = 'teslasync-sidenav-collapsed-groups'
function readCollapsed(): Record<string, boolean> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(GROUP_STORAGE) ?? '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, boolean> : {}
  } catch { return {} }
}

/** The same section content serves the desktop panel, tablet drawer and phone sheet. */
export function AtlasPanel({ view, onHomeViewChange, onClose, sections = [], pinnedItems = [], recentItems = [], suggestions = [], pathname,
  navLabel, navSectionTitle, onPin, onUnpin, pinSyncUnavailable = false, onItemSelect, alertCount = 0, vehicleCount = 0, staleCount = 0, vehicleId, collections = [] }: AtlasPanelProps) {
  const { t } = useTranslation()
  const id = useId()
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [query, setQuery] = useState('')
  const viewKey = view.kind === 'section' ? `section:${view.title}` : view.kind
  const section = view.kind === 'section' ? sections.find(candidate => candidate.title === view.title) : null
  const title = view.kind === 'suggested' ? t('nav.suggested', 'Suggested')
    : view.kind === 'favorites' ? t('nav.deck.saved', 'Saved') : section ? navSectionTitle(section) : t('nav.empty', 'No pages yet.')
  const allPaths = useMemo(() => sections.flatMap(candidate => flattenSidebarItems(candidate.items, collections).map(item => item.to)), [sections, collections])
  const isActive = (to: string) => isExclusiveActivePath(pathname, to, allPaths)
  const pinned = new Set(pinnedItems.map(item => item.to))
  const groups = section ? groupSidebarItems(section.items, collections) : []
  const sectionPaths = new Set(groups.flatMap(group => group.entries.map(item => item.to)))
  const filtering = query.trim().length > 0
  const matches = new Set(section && filtering ? searchSidebarSections([section], collections, query, navLabel, { matchSectionTitle: false }).flatMap(result => result.hits.map(item => item.to)) : [])
  const visibleGroups = groups.map(group => ({ ...group, entries: !filtering || (group.label && matchesSidebarTokens(`${group.label} ${group.labelKey ? t(group.labelKey, group.label) : ''}`.toLowerCase(), tokenizeSidebarQuery(query))) ? group.entries : group.entries.filter(item => matches.has(item.to)) })).filter(group => group.entries.length > 0)
  const pins = pinnedItems.filter(item => sectionPaths.has(item.to) && !isActive(item.to) && (!filtering || matches.has(item.to)))
  const recent = recentItems.filter(item => sectionPaths.has(item.to) && !pinned.has(item.to) && (!filtering || matches.has(item.to)))
  const isOpen = (key: string) => filtering || !collapsed[viewKey + ':' + key]
  const toggle = (key: string) => setCollapsed(previous => ({ ...previous, [viewKey + ':' + key]: !previous[viewKey + ':' + key] }))
  useEffect(() => { setQuery('') }, [viewKey])
  useEffect(() => {
    try { localStorage.setItem(GROUP_STORAGE, JSON.stringify(collapsed)) } catch { /* Navigation remains usable with storage disabled. */ }
  }, [collapsed])

  const row = (item: FlatSidebarEntry, key = item.to, quickPin = false, context?: string) => {
    const label = navLabel(item)
    const pinLabel = quickPin ? t('nav.deck.removeQuickPin', { page: label, defaultValue: 'Remove {{page}} from quick access' })
      : pinned.has(item.to) ? t('nav.unpinPage', { page: label, defaultValue: 'Unpin {{page}}' })
      : t('nav.pinPage', { page: label, defaultValue: 'Pin {{page}} to favorites' })
    const trailing = vehicleId && item.to === '/drives' ? <SidebarDriveBadge kind="today" vehicleId={vehicleId} />
      : vehicleId && item.to === '/drive-score' ? <SidebarDriveBadge kind="score" vehicleId={vehicleId} />
      : item.to === '/notifications/inbox' && alertCount > 0 ? <SidebarNotificationDot />
      : item.to === '/vehicles' && vehicleCount > 0 ? <SidebarCountChip value={vehicleCount} label={t('nav.vehicleCount', { count: vehicleCount, defaultValue: '{{count}} vehicles' })} />
      : item.to === '/data-repair' && staleCount > 0 ? <SidebarCountChip value={staleCount} label={t('nav.staleCount', { count: staleCount, defaultValue: '{{count}} stale rows' })} /> : null
    return <SidebarRow key={key} to={item.to} label={label} icon={item.icon} active={isActive(item.to)} context={context}
      ariaLabel={quickPin ? t('nav.deck.quickAccessLink', { page: label, defaultValue: 'Quick access: {{page}}' }) : undefined}
      onSelect={onItemSelect} onDoubleClick={() => { if (!pinned.has(item.to)) onPin(item.to) }} trailing={trailing} dataTour={item.dataTour}
      hoverAction={<IconButton icon={<Icons.pin className={pinned.has(item.to) ? 'h-4 w-4 fill-current' : 'h-4 w-4'} aria-hidden />}
        label={pinLabel} className="min-h-11 min-w-11" onClick={() => pinned.has(item.to) ? onUnpin(item.to) : onPin(item.to)}
        aria-describedby={pinSyncUnavailable ? `${id}-pin-offline` : undefined} data-testid={`atlas-pin-${item.to}`} />} />
  }
  const groupHeader = (key: string, label: string, count: number) => <Button type="button" variant="ghost" size="sm"
    aria-label={label} aria-expanded={isOpen(key)} aria-controls={`${id}-${key}`} onClick={() => toggle(key)}
    className="min-h-11 w-full justify-start gap-2 px-2 text-sm text-[var(--text-secondary)]">
    {isOpen(key) ? <Icons.expand className="h-4 w-4 shrink-0" aria-hidden /> : <Icons.next className="h-4 w-4 shrink-0 rtl:rotate-180" aria-hidden />}
    <span className="min-w-0 flex-1 truncate text-start">{label}</span>
    <span aria-hidden className="rounded-shape-sm bg-[var(--surface-3)] px-2 text-xs tabular-nums">{count}</span>
  </Button>
  const collectionKeys = groups.filter(group => group.label).map(group => group.entries[0].to)
  const anyClosed = collectionKeys.some(key => !isOpen(key))
  return <div role="navigation" aria-label={t('nav.sidebar', 'Sidebar navigation')} data-testid="atlas-panel-secondary"
    className="flex h-full min-h-0 w-full flex-col border-s border-e border-[var(--border-default)] bg-[var(--nav-context-bg)]">
    <div className="flex h-12 shrink-0 items-center gap-1 border-b border-[var(--border-default)] px-2">
      <p className="min-w-0 flex-1 truncate px-1 text-sm font-medium">{title}</p>
      {collectionKeys.length > 1 && <IconButton label={anyClosed ? t('nav.deck.expandAllGroups', 'Expand all groups') : t('nav.deck.collapseAllGroups', 'Collapse all groups')}
        icon={anyClosed ? <Icons.expandAll className="h-5 w-5" aria-hidden /> : <Icons.collapseAll className="h-5 w-5" aria-hidden />}
        onClick={() => setCollapsed(previous => ({ ...previous, ...Object.fromEntries(collectionKeys.map(key => [viewKey + ':' + key, !anyClosed])) }))} className="min-h-11 min-w-11" />}
      <IconButton label={t('nav.sidenav.hidePanel', 'Hide panel')} icon={<Icons.close className="h-4 w-4" aria-hidden />} onClick={onClose} className="min-h-11 min-w-11" />
    </div>
    {section && <div className="shrink-0 px-3 pt-3"><Input type="search" value={query} onChange={event => setQuery(event.target.value)}
      aria-label={t('nav.sidenav.filterLabel', { section: title, defaultValue: 'Filter {{section}} pages' })}
      placeholder={t('nav.sidenav.filter', { section: title, defaultValue: 'Filter {{section}}…' })} icon={<Icons.filter className="h-4 w-4" aria-hidden />}
      suffix={query ? <IconButton label={t('nav.deck.clearFilter', 'Clear filter')} icon={<Icons.close className="h-4 w-4" aria-hidden />} onClick={() => setQuery('')} /> : undefined} /></div>}
    {pinSyncUnavailable && <p id={`${id}-pin-offline`} className="sr-only">{t('nav.deck.pinOfflineHint', 'Saved here until navigation pins can sync')}</p>}
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 pb-8 pt-3 scrollbar-thin">
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
        {(!filtering || pins.length > 0) && <div>{groupHeader('pinned', t('nav.sidenav.pinned', 'Pinned'), pins.length)}
          <div id={`${id}-pinned`}>{isOpen('pinned') && (pins.length ? pins.map(item => row(item, `pinned-${item.to}`, true)) : <p className="px-2 py-2 text-xs text-[var(--text-muted)]">{t('nav.deck.noQuickPins', 'Pin a page below to keep it close.')}</p>)}</div>
        </div>}
        {recent.length > 0 && <div>{groupHeader('recent', t('nav.sidenav.recent', 'Recent'), recent.length)}<div id={`${id}-recent`}>{isOpen('recent') && recent.map(item => row(item, `recent-${item.to}`))}</div></div>}
        {filtering && visibleGroups.length === 0 && pins.length === 0 && recent.length === 0 && <p role="status" className="px-2 py-4 text-sm text-[var(--text-muted)]">{t('nav.sidenav.noMatches', { query: query.trim(), defaultValue: 'No pages match "{{query}}".' })}</p>}
        {visibleGroups.map(group => {
          const key = group.entries[0].to
          return <div key={key}>
            {group.label && groupHeader(key, group.labelKey ? t(group.labelKey, group.label) : group.label, group.entries.length)}
            <div id={group.label ? `${id}-${key}` : undefined}>{(!group.label || isOpen(key)) && group.entries.map(item => row(item))}</div>
          </div>
        })}
      </>}
    </div>
  </div>
}
export default AtlasPanel
